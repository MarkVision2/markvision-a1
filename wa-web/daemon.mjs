#!/usr/bin/env node
/**
 * Free WhatsApp Web daemon (Baileys multi-device).
 * Scans QR in MarkVision Settings → messages land in CRM chats.
 * Green API stays for automations/broadcasts.
 *
 *   cd wa-web && npm i
 *   # in repo root .env:
 *   #   VITE_SUPABASE_URL=...
 *   #   VITE_SUPABASE_PUBLISHABLE_KEY=...
 *   #   WA_WEB_WORKER_KEY=...   (same as Supabase secret)
 *   node wa-web/daemon.mjs
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const AUTH_ROOT = resolve(HERE, "sessions");

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = {
  ...loadEnv(resolve(ROOT, ".env")),
  ...loadEnv(resolve(HERE, ".env.local")),
  ...process.env,
};
const SUPABASE_URL = (env.VITE_SUPABASE_URL || env.VITE_CLIENT_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "";
const WORKER_KEY = env.WA_WEB_WORKER_KEY || "";

if (!SUPABASE_URL || !ANON_KEY || !WORKER_KEY) {
  console.error("Need VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, WA_WEB_WORKER_KEY in .env");
  process.exit(1);
}

const BRIDGE = `${SUPABASE_URL}/functions/v1/wa-web-bridge`;
const log = pino({ level: env.WA_WEB_LOG || "info" });

async function bridge(action, body = {}) {
  const r = await fetch(BRIDGE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wa-web-key": WORKER_KEY,
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function jidToPhone(jid) {
  if (!jid) return "";
  const s = String(jid).trim();
  // Never treat @lid / @g.us / status as a phone number.
  if (s.endsWith("@lid") || s.endsWith("@g.us") || s === "status@broadcast") return "";
  let user = s;
  if (s.includes("@")) {
    if (!s.endsWith("@s.whatsapp.net") && !s.endsWith("@c.us")) return "";
    user = s.split("@")[0] || "";
  }
  // Multi-device: "77472842595:57@s.whatsapp.net" → strip device id after ":"
  const phonePart = String(user).split(":")[0] || "";
  const d = phonePart.replace(/\D/g, "");
  // Dialable length; 13+ opaque ids are WhatsApp LIDs, not phones.
  if (d.length < 8 || d.length > 12) return "";
  if (d.startsWith("80")) return ""; // calling code 80 does not exist
  return `+${d}`;
}

function lidLocal(jid) {
  if (!jid || !String(jid).includes("@lid")) return "";
  return String(jid).split("@")[0].split(":")[0] || "";
}

/** projectId → (lid localpart → +phone) — also persisted under sessions/<id>/lid-map.json */
const lidPhoneByProject = new Map();

function lidMapPath(projectId) {
  return resolve(AUTH_ROOT, projectId, "lid-map.json");
}

function loadLidMap(projectId) {
  let m = lidPhoneByProject.get(projectId);
  if (m) return m;
  m = new Map();
  try {
    const p = lidMapPath(projectId);
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      for (const [lid, phone] of Object.entries(raw || {})) {
        if (lid && phone) m.set(String(lid), String(phone));
      }
    }
  } catch {
    /* ignore */
  }
  lidPhoneByProject.set(projectId, m);
  return m;
}

function persistLidMap(projectId) {
  const m = lidPhoneByProject.get(projectId);
  if (!m) return;
  try {
    mkdirSync(resolve(AUTH_ROOT, projectId), { recursive: true });
    writeFileSync(lidMapPath(projectId), JSON.stringify(Object.fromEntries(m), null, 0));
  } catch (e) {
    log.warn({ err: e, projectId }, "lid-map persist failed");
  }
}

function rememberLidMap(projectId, lidJid, phoneJidOrPhone) {
  const lid = lidLocal(lidJid);
  if (!lid) return;
  const phone = String(phoneJidOrPhone).startsWith("+")
    ? (jidToPhone(phoneJidOrPhone) || String(phoneJidOrPhone))
    : jidToPhone(phoneJidOrPhone);
  if (!phone) return;
  const m = loadLidMap(projectId);
  if (m.get(lid) === phone) return;
  m.set(lid, phone);
  persistLidMap(projectId);
  log.info({ projectId, lid, phone }, "lid→phone mapped");
}

/** Prefer real PN jid over WhatsApp LID (linked id). */
function resolveMessagePhone(projectId, msg) {
  const key = msg?.key || {};
  const candidates = [
    key.remoteJidAlt,
    key.participantAlt,
    key.senderPn,
    key.participantPn,
    key.remoteJid,
    key.participant,
  ];
  let lid = lidLocal(key.remoteJid) || lidLocal(key.participant) || lidLocal(key.senderLid) || "";
  for (const jid of candidates) {
    const phone = jidToPhone(jid);
    if (phone) {
      if (lid) rememberLidMap(projectId, `${lid}@lid`, phone);
      // Learn when Alt is LID and primary is PN (or vice versa).
      if (String(key.remoteJid || "").endsWith("@lid")) rememberLidMap(projectId, key.remoteJid, phone);
      if (String(key.remoteJidAlt || "").endsWith("@lid")) rememberLidMap(projectId, key.remoteJidAlt, phone);
      if (key.senderLid) rememberLidMap(projectId, key.senderLid, phone);
      return { phone, jid: String(jid), lid };
    }
  }
  if (lid) {
    const mapped = loadLidMap(projectId).get(lid);
    if (mapped) return { phone: mapped, jid: `${lid}@lid`, lid };
  }
  return { phone: "", jid: String(key.remoteJid || ""), lid };
}

async function extractText(msg) {
  const m = msg.message || {};
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return m.imageMessage.caption || "[Изображение]";
  if (m.videoMessage) return m.videoMessage.caption || "[Видео]";
  if (m.audioMessage) return "[Аудио]";
  if (m.documentMessage) {
    return m.documentMessage.caption
      || m.documentMessage.fileName
      || "[Файл]";
  }
  if (m.stickerMessage) return "[Стикер]";
  if (m.contactMessage) return "[Контакт]";
  if (m.locationMessage || m.liveLocationMessage) return "[Геолокация]";
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return m.buttonsResponseMessage.selectedDisplayText;
  }
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  if (m.templateButtonReplyMessage?.selectedDisplayText) {
    return m.templateButtonReplyMessage.selectedDisplayText;
  }
  if (m.reactionMessage) return ""; // skip reactions
  return "[Сообщение]";
}

function detectMedia(msg) {
  const m = msg.message || {};
  if (m.imageMessage) {
    return {
      kind: "image",
      mime: m.imageMessage.mimetype || "image/jpeg",
      filename: null,
      caption: m.imageMessage.caption || "",
    };
  }
  if (m.videoMessage) {
    return {
      kind: "video",
      mime: m.videoMessage.mimetype || "video/mp4",
      filename: null,
      caption: m.videoMessage.caption || "",
    };
  }
  if (m.audioMessage) {
    return {
      kind: "audio",
      mime: m.audioMessage.mimetype || "audio/ogg",
      filename: null,
      caption: "",
    };
  }
  if (m.documentMessage) {
    return {
      kind: "document",
      mime: m.documentMessage.mimetype || "application/octet-stream",
      filename: m.documentMessage.fileName || "file",
      caption: m.documentMessage.caption || "",
    };
  }
  if (m.stickerMessage) {
    return {
      kind: "sticker",
      mime: m.stickerMessage.mimetype || "image/webp",
      filename: null,
      caption: "",
    };
  }
  return null;
}

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

/** Safari/iOS can't play WhatsApp Opus-in-Ogg — convert to AAC/M4A for CRM playback. */
function convertAudioToM4a(buf) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inPath = join(tmpdir(), `wa-in-${id}.ogg`);
  const outPath = join(tmpdir(), `wa-out-${id}.m4a`);
  try {
    writeFileSync(inPath, buf);
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-i", inPath, "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", outPath],
      { encoding: "utf8", timeout: 60_000 },
    );
    if (r.status !== 0 || !existsSync(outPath)) {
      log.warn({ stderr: (r.stderr || "").slice(0, 400) }, "ffmpeg audio convert failed");
      return null;
    }
    return readFileSync(outPath);
  } catch (e) {
    log.warn({ err: e }, "ffmpeg audio convert error");
    return null;
  } finally {
    try { unlinkSync(inPath); } catch { /* ignore */ }
    try { unlinkSync(outPath); } catch { /* ignore */ }
  }
}

async function downloadWaMedia(sock, msg) {
  const info = detectMedia(msg);
  if (!info) return null;
  try {
    const buf = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      {
        logger: log,
        reuploadRequest: sock.updateMediaMessage.bind(sock),
      },
    );
    if (!buf || !buf.length) return { ...info, base64: null };
    if (buf.length > MAX_MEDIA_BYTES) {
      log.warn({ size: buf.length, kind: info.kind }, "media too large — skip upload");
      return { ...info, base64: null };
    }

    let outBuf = Buffer.from(buf);
    let mime = info.mime;
    let filename = info.filename;
    if (info.kind === "audio") {
      const converted = convertAudioToM4a(outBuf);
      if (converted && converted.length > 0) {
        outBuf = converted;
        mime = "audio/mp4";
        filename = "voice.m4a";
        log.info({ fromBytes: buf.length, toBytes: outBuf.length }, "audio converted to m4a");
      }
    }

    return {
      ...info,
      mime,
      filename,
      base64: outBuf.toString("base64"),
    };
  } catch (e) {
    log.warn({ err: e, kind: info.kind }, "media download failed");
    return { ...info, base64: null };
  }
}

function messageTimestampMs(msg) {
  const raw = msg?.messageTimestamp;
  if (raw == null) return null;
  let n;
  if (typeof raw === "object" && raw !== null && "toNumber" in raw) {
    n = Number(raw.toNumber());
  } else {
    n = Number(raw);
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

/** Pull Meta CTWA / externalAdReply fields from a Baileys message for CRM attribution. */
function extractCtwaAttribution(msg) {
  const out = {
    meta_ad_id: null,
    meta_adset_id: null,
    meta_campaign_id: null,
    click_id: null,
    headline: null,
  };
  const m = msg?.message;
  if (!m || typeof m !== "object") return out;

  const candidates = [];
  const push = (v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) candidates.push(v);
  };

  push(m);
  push(m.extendedTextMessage);
  push(m.imageMessage);
  push(m.videoMessage);
  push(m.buttonsMessage);
  push(m.templateMessage);
  push(m.interactiveMessage);

  for (const node of [...candidates]) {
    push(node.contextInfo);
    push(node.contextInfo?.externalAdReply);
    push(node.contextInfo?.external_ad_reply);
    push(node.contextInfo?.entryPointConversionSource);
    push(node.externalAdReply);
    push(node.external_ad_reply);
    push(node.referral);
  }

  // Some CTWA payloads sit on message Stub / hydrated template
  push(m.messageContextInfo);
  push(m.messageContextInfo?.deviceListMetadata);

  const adFromUrl = (u) => {
    if (!u || typeof u !== "string") return null;
    const m1 = u.match(/[?&](?:ad_id|adId|content)=([0-9]{6,})/);
    if (m1) return m1[1];
    const m2 = u.match(/fb\.me\/([0-9]{6,})/);
    if (m2) return m2[1];
    return null;
  };

  for (const c of candidates) {
    const sourceId = c.sourceId ?? c.source_id ?? c.adId ?? c.ad_id;
    if (sourceId && !out.meta_ad_id) out.meta_ad_id = String(sourceId);
    const ctwa = c.ctwaClid ?? c.ctwa_clid ?? c.clickId ?? c.click_id;
    if (ctwa && !out.click_id) out.click_id = String(ctwa);
    const camp = c.campaignId ?? c.campaign_id;
    if (camp && !out.meta_campaign_id) out.meta_campaign_id = String(camp);
    const adset = c.adsetId ?? c.adset_id;
    if (adset && !out.meta_adset_id) out.meta_adset_id = String(adset);
    const headline = c.headline ?? c.title;
    if (headline && !out.headline) out.headline = String(headline);
    if (!out.meta_ad_id) {
      const fromUrl = adFromUrl(c.sourceUrl ?? c.source_url ?? c.url ?? c.originalUrl);
      if (fromUrl) out.meta_ad_id = fromUrl;
    }
  }

  if (!out.meta_ad_id && !out.click_id && !out.meta_campaign_id) return null;
  return out;
}

async function ingestWaMessage(projectId, msg, source = "upsert", sock = null) {
  if (!msg?.message || msg.message.protocolMessage || msg.message.reactionMessage) {
    return { skipped: "protocol" };
  }
  // Never turn WhatsApp history / catch-up dumps into CRM leads.
  // Baileys: type "append" = historical sync; "notify" = live after connect.
  if (
    source === "history"
    || source === "upsert:append"
    || source.startsWith("upsert:append")
  ) {
    return { skipped: "history" };
  }

  const afterMs = ingestAfterMs.get(projectId);
  const tsMs = messageTimestampMs(msg);
  // 90s skew: clock / pair race right after QR.
  if (afterMs && tsMs != null && tsMs < afterMs - 90_000) {
    return { skipped: "before_pair", tsMs, afterMs };
  }

  const { phone, jid, lid } = resolveMessagePhone(projectId, msg);
  if (!phone && !lid) {
    log.warn({
      projectId,
      jid,
      source,
      key: {
        remoteJid: msg.key?.remoteJid,
        remoteJidAlt: msg.key?.remoteJidAlt,
        senderPn: msg.key?.senderPn,
        participantPn: msg.key?.participantPn,
        senderLid: msg.key?.senderLid,
      },
    }, "skip message: no phone/lid");
    return { skipped: "no_phone", jid };
  }
  const text = await extractText(msg);
  if (!text) return { skipped: "empty" };
  const direction = msg.key?.fromMe ? "out" : "in";
  const externalId = msg.key?.id || null;
  const name = msg.pushName || "";
  const attribution = direction === "in" ? extractCtwaAttribution(msg) : null;

  let mediaPayload = {};
  if (sock && detectMedia(msg)) {
    const media = await downloadWaMedia(sock, msg);
    if (media) {
      mediaPayload = {
        media_kind: media.kind,
        media_mime: media.mime,
        media_filename: media.filename,
        ...(media.base64 ? { media_base64: media.base64 } : {}),
      };
      if (media.caption && text.startsWith("[")) {
        // prefer real caption when extractText fell back to placeholder
      }
    }
  }

  const res = await bridge("ingest", {
    project_id: projectId,
    phone: phone || "",
    whatsapp_lid: lid || null,
    name,
    direction,
    text,
    external_id: externalId,
    source,
    message_ts: tsMs != null ? Math.floor(tsMs / 1000) : null,
    ...(attribution ? { attribution } : {}),
    ...mediaPayload,
  });
  if (res?.skipped) {
    log.info({ projectId, source, skipped: res.skipped }, "ingest skipped by bridge");
    return res;
  }
  log.info({
    projectId,
    phone: phone || null,
    lid: lid || null,
    direction,
    source,
    externalId,
    leadId: res.leadId,
    deduped: res.deduped,
    mediaKind: mediaPayload.media_kind || null,
    mediaUrl: res.mediaUrl || null,
    metaAdId: res.attribution?.meta_ad_id || attribution?.meta_ad_id || null,
  }, "ingested");
  return res;
}

/** Per-project: ignore WA messages older than connect time (ms epoch). */
const ingestAfterMs = new Map();

/** @type {Map<string, { sock: any, connecting: boolean }>} */
const sockets = new Map();

async function setState(projectId, status, extra = {}) {
  await bridge("set_state", { project_id: projectId, status, ...extra });
}

async function openSocket(projectId, { forcePair = false } = {}) {
  const existing = sockets.get(projectId);
  if (existing?.sock && !forcePair) return existing.sock;
  if (existing?.connecting) return null;

  const authDir = resolve(AUTH_ROOT, projectId);
  mkdirSync(authDir, { recursive: true });
  if (forcePair && existsSync(authDir)) {
    rmSync(authDir, { recursive: true, force: true });
    mkdirSync(authDir, { recursive: true });
  }

  sockets.set(projectId, { sock: null, connecting: true });
  if (forcePair) ingestAfterMs.delete(projectId);
  loadLidMap(projectId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    // Do NOT pull the whole chat archive into CRM on QR link.
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        await bridge("push_qr", { project_id: projectId, qr_data: dataUrl });
        log.info({ projectId }, "QR pushed");
      }
      if (connection === "open") {
        const me = sock.user;
        const phone = jidToPhone(me?.id);
        // Gate: only messages at/after this connect become CRM leads.
        if (!ingestAfterMs.has(projectId)) {
          ingestAfterMs.set(projectId, Date.now());
        }
        await setState(projectId, "connected", {
          phone: phone || null,
          display_name: me?.name || me?.verifiedName || null,
        });
        const entry = sockets.get(projectId) || {};
        sockets.set(projectId, { ...entry, sock, connecting: false });
        log.info({ projectId, phone, ingestAfterMs: ingestAfterMs.get(projectId) }, "connected");
      }
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        // 515 = restartRequired — normal right after QR scan / pairing.
        const restartRequired = code === DisconnectReason.restartRequired || code === 515;
        sockets.delete(projectId);
        if (loggedOut) {
          ingestAfterMs.delete(projectId);
          await setState(projectId, "disconnected");
          log.warn({ projectId }, "logged out");
        } else if (restartRequired) {
          // Keep pairing/connected UX clean — no scary "reconnect 515".
          log.info({ projectId, code }, "restart required — reconnecting");
          setTimeout(() => {
            openSocket(projectId).catch((e) => log.error(e));
          }, 1500);
        } else {
          // Transient drop: stay in pairing if we were pairing, else reconnect quietly.
          log.warn({ projectId, code }, "connection closed — retry soon");
          setTimeout(() => {
            openSocket(projectId).catch((e) => log.error(e));
          }, 4000);
        }
      }
    } catch (e) {
      log.error({ err: e, projectId }, "connection.update handler");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    const t = String(type || "unknown");
    // Live traffic only. "append" is historical catch-up from the phone.
    if (t === "append") {
      log.info({ projectId, type: t, count: messages?.length || 0 }, "skip history upsert");
      return;
    }
    log.info({ projectId, type: t, count: messages?.length || 0 }, "messages.upsert");
    for (const msg of messages || []) {
      try {
        await ingestWaMessage(projectId, msg, `upsert:${t}`, sock);
      } catch (e) {
        log.error({ err: e, projectId }, "ingest failed");
      }
    }
  });

  sock.ev.on("contacts.upsert", (contacts) => {
    for (const c of contacts || []) {
      try {
        const id = c.id || c.lid;
        // phoneNumber is the PN jid/number; notify is a display name — never use as phone.
        const pn = c.phoneNumber || "";
        if (id && String(id).includes("@lid") && pn) {
          rememberLidMap(projectId, id, pn);
        }
        if (c.id && c.lid) rememberLidMap(projectId, c.lid, c.id);
      } catch {
        /* ignore */
      }
    }
  });

  sock.ev.on("contacts.update", (updates) => {
    for (const c of updates || []) {
      try {
        if (c.id && c.lid) rememberLidMap(projectId, c.lid, c.id);
        if (c.lid && c.phoneNumber) rememberLidMap(projectId, c.lid, c.phoneNumber);
      } catch {
        /* ignore */
      }
    }
  });

  sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
    try {
      rememberLidMap(projectId, lid, jid);
    } catch {
      /* ignore */
    }
  });

  // History sync must NOT create CRM leads. Keep lid↔phone maps only.
  sock.ev.on("messaging-history.set", async (payload) => {
    const messages = payload?.messages || [];
    log.info(
      { projectId, count: messages.length },
      "messaging-history.set ignored for CRM (live-only ingest)",
    );
    for (const c of payload?.contacts || []) {
      try {
        if (c.id && c.lid) rememberLidMap(projectId, c.lid, c.id);
        if (c.lid && c.phoneNumber) rememberLidMap(projectId, c.lid, c.phoneNumber);
      } catch {
        /* ignore */
      }
    }
  });

  const entry = sockets.get(projectId) || {};
  sockets.set(projectId, { ...entry, sock, connecting: false });
  return sock;
}

async function handleCommand(cmd) {
  const projectId = cmd.project_id;
  const action = cmd.action;
  try {
    if (action === "pair") {
      const existing = sockets.get(projectId);
      // Already live — don't wipe session / spam new QR.
      if (existing?.sock?.user) {
        const me = existing.sock.user;
        const phone = jidToPhone(me?.id);
        await setState(projectId, "connected", {
          phone: phone || null,
          display_name: me?.name || me?.verifiedName || null,
        });
        await bridge("ack", { id: cmd.id, status: "done", result: { ok: true, already: true } });
        return;
      }
      const authDir = resolve(AUTH_ROOT, projectId);
      const hasCreds = existsSync(resolve(authDir, "creds.json"));
      // Only wipe when user asks for a fresh QR and there is no working session.
      await openSocket(projectId, { forcePair: !hasCreds || !!cmd.payload?.force });
      await bridge("ack", { id: cmd.id, status: "done", result: { ok: true } });
      return;
    }
    if (action === "logout") {
      const entry = sockets.get(projectId);
      try {
        await entry?.sock?.logout?.();
      } catch {
        /* ignore */
      }
      sockets.delete(projectId);
      ingestAfterMs.delete(projectId);
      const authDir = resolve(AUTH_ROOT, projectId);
      if (existsSync(authDir)) rmSync(authDir, { recursive: true, force: true });
      await setState(projectId, "disconnected");
      await bridge("ack", { id: cmd.id, status: "done", result: { ok: true } });
      return;
    }
    if (action === "send") {
      let sock = sockets.get(projectId)?.sock;
      if (!sock) sock = await openSocket(projectId);
      if (!sock) throw new Error("socket not ready");
      const phone = String(cmd.payload?.phone || "").replace(/\D/g, "");
      const message = String(cmd.payload?.message || "");
      if (!phone || !message) throw new Error("phone/message missing");
      const jid = `${phone}@s.whatsapp.net`;
      const sent = await sock.sendMessage(jid, { text: message });
      const idMessage = sent?.key?.id || null;
      await bridge("ingest", {
        project_id: projectId,
        phone: `+${phone}`,
        direction: "out",
        text: message,
        external_id: idMessage,
      });
      await bridge("ack", {
        id: cmd.id,
        status: "done",
        result: { ok: true, idMessage },
      });
      return;
    }
    await bridge("ack", { id: cmd.id, status: "failed", result: { error: `unknown ${action}` } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: e, cmd: cmd.id }, "command failed");
    await bridge("ack", { id: cmd.id, status: "failed", result: { error: msg } });
  }
}

async function tick() {
  await bridge("heartbeat", {});
  const listed = await bridge("list_sessions", {});
  for (const s of listed.sessions || []) {
    if (s.status === "connected" || s.status === "pairing") {
      if (!sockets.has(s.project_id)) {
        openSocket(s.project_id).catch((e) => log.error(e));
      } else {
        await bridge("heartbeat", { project_id: s.project_id });
      }
    }
  }
  const claimed = await bridge("claim", {});
  for (const cmd of claimed.commands || []) {
    await handleCommand(cmd);
  }
}

async function main() {
  mkdirSync(AUTH_ROOT, { recursive: true });
  // Ensure local deps
  if (!existsSync(resolve(HERE, "node_modules/@whiskeysockets/baileys"))) {
    console.log("Installing wa-web dependencies…");
    const r = spawnSync("npm", ["install", "--omit=dev"], { cwd: HERE, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status || 1);
  }
  log.info("wa-web-daemon started");
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log.error({ err: e }, "tick failed");
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
