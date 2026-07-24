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
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, {
  DisconnectReason,
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
  const s = String(jid);
  // Never treat @lid / @g.us / status as a phone number.
  if (s.endsWith("@lid") || s.endsWith("@g.us") || s === "status@broadcast") return "";
  if (!s.endsWith("@s.whatsapp.net") && !s.endsWith("@c.us")) return "";
  // Multi-device: "77472842595:57@s.whatsapp.net" → device id after ":"
  const user = s.split("@")[0] || "";
  const phonePart = user.split(":")[0] || "";
  const d = phonePart.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return "";
  return `+${d}`;
}

/** lid localpart → +phone */
const lidPhone = new Map();

function rememberLidMap(lidJid, phoneJidOrPhone) {
  if (!lidJid || !String(lidJid).includes("@lid")) return;
  const lid = String(lidJid).split("@")[0];
  const phone = String(phoneJidOrPhone).startsWith("+")
    ? String(phoneJidOrPhone)
    : jidToPhone(phoneJidOrPhone);
  if (lid && phone) lidPhone.set(lid, phone);
}

/** Prefer real PN jid over WhatsApp LID (linked id). */
function resolveMessagePhone(msg) {
  const key = msg?.key || {};
  const candidates = [
    key.remoteJidAlt,
    key.participantAlt,
    key.remoteJid,
    key.participant,
  ];
  for (const jid of candidates) {
    const phone = jidToPhone(jid);
    if (phone) {
      // Learn lid↔phone when both present.
      if (String(key.remoteJid || "").endsWith("@lid") && phone) {
        rememberLidMap(key.remoteJid, phone);
      }
      if (String(key.remoteJidAlt || "").endsWith("@lid") && phone) {
        rememberLidMap(key.remoteJidAlt, phone);
      }
      return { phone, jid: String(jid) };
    }
  }
  const rid = String(key.remoteJid || "");
  if (rid.endsWith("@lid")) {
    const mapped = lidPhone.get(rid.split("@")[0]);
    if (mapped) return { phone: mapped, jid: rid };
  }
  return { phone: "", jid: rid };
}

async function extractText(msg) {
  const m = msg.message || {};
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return m.imageMessage.caption || "[Изображение]";
  if (m.videoMessage) return m.videoMessage.caption || "[Видео]";
  if (m.audioMessage) return "[Аудио]";
  if (m.documentMessage) return m.documentMessage.fileName || "[Файл]";
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

async function ingestWaMessage(projectId, msg, source = "upsert") {
  if (!msg?.message || msg.message.protocolMessage || msg.message.reactionMessage) {
    return { skipped: "protocol" };
  }
  const { phone, jid } = resolveMessagePhone(msg);
  if (!phone) {
    log.warn({ projectId, jid, source }, "skip message: no phone jid (lid?)");
    return { skipped: "no_phone", jid };
  }
  const text = await extractText(msg);
  if (!text) return { skipped: "empty" };
  const direction = msg.key?.fromMe ? "out" : "in";
  const externalId = msg.key?.id || null;
  const name = msg.pushName || "";
  const res = await bridge("ingest", {
    project_id: projectId,
    phone,
    name,
    direction,
    text,
    external_id: externalId,
  });
  log.info({
    projectId,
    phone,
    direction,
    source,
    externalId,
    leadId: res.leadId,
    deduped: res.deduped,
  }, "ingested");
  return res;
}

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
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    syncFullHistory: true,
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
        await setState(projectId, "connected", {
          phone: phone || null,
          display_name: me?.name || me?.verifiedName || null,
        });
        const entry = sockets.get(projectId) || {};
        sockets.set(projectId, { ...entry, sock, connecting: false });
        log.info({ projectId, phone }, "connected");
      }
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        // 515 = restartRequired — normal right after QR scan / pairing.
        const restartRequired = code === DisconnectReason.restartRequired || code === 515;
        sockets.delete(projectId);
        if (loggedOut) {
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
    log.info({ projectId, type, count: messages?.length || 0 }, "messages.upsert");
    for (const msg of messages || []) {
      try {
        await ingestWaMessage(projectId, msg, `upsert:${type || "unknown"}`);
      } catch (e) {
        log.error({ err: e, projectId }, "ingest failed");
      }
    }
  });

  sock.ev.on("contacts.upsert", (contacts) => {
    for (const c of contacts || []) {
      try {
        const id = c.id || c.lid;
        const pn = c.phoneNumber || c.notify || "";
        if (id && String(id).includes("@lid") && pn) {
          const digits = String(pn).replace(/\D/g, "");
          if (digits.length >= 8) rememberLidMap(id, `+${digits}`);
        }
        if (c.id && c.lid) rememberLidMap(c.lid, c.id);
      } catch {
        /* ignore */
      }
    }
  });

  sock.ev.on("contacts.update", (updates) => {
    for (const c of updates || []) {
      try {
        if (c.id && c.lid) rememberLidMap(c.lid, c.id);
        if (c.lid && c.phoneNumber) {
          const digits = String(c.phoneNumber).replace(/\D/g, "");
          if (digits.length >= 8) rememberLidMap(c.lid, `+${digits}`);
        }
      } catch {
        /* ignore */
      }
    }
  });

  // Initial / catch-up history after linking the device.
  sock.ev.on("messaging-history.set", async (payload) => {
    const messages = payload?.messages || [];
    log.info({ projectId, count: messages.length }, "messaging-history.set");
    // Cap to avoid flooding CRM on first sync.
    const recent = messages.slice(-200);
    for (const msg of recent) {
      try {
        await ingestWaMessage(projectId, msg, "history");
      } catch (e) {
        log.error({ err: e, projectId }, "history ingest failed");
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
