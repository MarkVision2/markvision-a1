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

const env = { ...loadEnv(resolve(ROOT, ".env")), ...process.env };
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
  if (!jid || jid.endsWith("@g.us")) return "";
  const user = String(jid).split("@")[0] || "";
  const d = user.replace(/\D/g, "");
  return d ? `+${d}` : "";
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
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return m.buttonsResponseMessage.selectedDisplayText;
  }
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  if (m.templateButtonReplyMessage?.selectedDisplayText) {
    return m.templateButtonReplyMessage.selectedDisplayText;
  }
  return "";
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
    syncFullHistory: false,
    markOnlineOnConnect: false,
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
        const phone = jidToPhone(me?.id) || (me?.id ? `+${String(me.id).split(":")[0]}` : null);
        await setState(projectId, "connected", {
          phone,
          display_name: me?.name || me?.verifiedName || null,
        });
        const entry = sockets.get(projectId) || {};
        sockets.set(projectId, { ...entry, sock, connecting: false });
        log.info({ projectId, phone }, "connected");
      }
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        sockets.delete(projectId);
        if (loggedOut) {
          await setState(projectId, "disconnected");
          log.warn({ projectId }, "logged out");
        } else {
          await setState(projectId, "error", {
            error: `reconnect ${code ?? "unknown"}`,
          });
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
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      try {
        if (!msg.message || msg.message.protocolMessage) continue;
        const remote = msg.key.remoteJid;
        if (!remote || remote.endsWith("@g.us") || remote === "status@broadcast") continue;
        const phone = jidToPhone(remote);
        if (!phone) continue;
        const text = await extractText(msg);
        const direction = msg.key.fromMe ? "out" : "in";
        const externalId = msg.key.id || null;
        const name = msg.pushName || "";
        await bridge("ingest", {
          project_id: projectId,
          phone,
          name,
          direction,
          text,
          external_id: externalId,
        });
      } catch (e) {
        log.error({ err: e, projectId }, "ingest failed");
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
      await openSocket(projectId, { forcePair: true });
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
