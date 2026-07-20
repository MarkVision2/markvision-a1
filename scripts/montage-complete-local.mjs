#!/usr/bin/env node
/**
 * Дожать complete для уже отрендеренных файлов.
 * Большие файлы (>45 МБ) → Cloudflare R2 (лимит Supabase Storage Free ~50 МБ).
 *
 *   node scripts/montage-complete-local.mjs <jobId> <main.mp4> [title] [--short path.mp4 ...]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnv(resolve(".env")), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KEY = env.MONTAGE_WORKER_KEY;
const FN = `${SUPABASE_URL}/functions/v1/montage-worker`;
const SUPABASE_DIRECT_MAX_BYTES = 45 * 1024 * 1024;

const args = process.argv.slice(2);
const id = args[0];
const video = resolve(args[1] || "");
const shorts = [];
let title = basename(video, ".mp4");
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--short" && args[i + 1]) {
    shorts.push(resolve(args[++i]));
  } else if (!args[i].startsWith("--")) {
    title = args[i];
  }
}
if (!id || !existsSync(video)) {
  console.error("Usage: node scripts/montage-complete-local.mjs <jobId> <video.mp4> [title] [--short s.mp4 ...]");
  process.exit(1);
}

async function call(body) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(FN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-montage-key": KEY,
          apikey: ANON,
          Authorization: `Bearer ${ANON}`,
        },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    } catch (e) {
      last = e;
      console.error(`call attempt ${attempt}:`, e.message);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw last;
}

function probeDurationSec(path) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { encoding: "utf8" },
    );
    return Math.round(parseFloat(out.trim())) || null;
  } catch {
    return null;
  }
}

async function uploadToR2(localPath) {
  const size = statSync(localPath).size;
  const filename = basename(localPath);
  const r2Url = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/r2-presign-upload`;
  const res = await fetch(r2Url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-key": ANON,
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify({ filename, contentType: "video/mp4", size }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error || !j.uploadUrl || !j.publicUrl) {
    throw new Error(j.error || `r2-presign HTTP ${res.status}`);
  }
  const put = await fetch(j.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: readFileSync(localPath),
  });
  if (!put.ok) throw new Error(`r2 PUT HTTP ${put.status}`);
  console.log(`✓ R2 ${(size / 1024 / 1024).toFixed(1)} MB → ${j.publicUrl}`);
  return j.publicUrl;
}

async function uploadFile(localPath) {
  const size = statSync(localPath).size;
  if (size > SUPABASE_DIRECT_MAX_BYTES) {
    console.log(`файл ${(size / 1024 / 1024).toFixed(1)} MB > 45 MB — R2`);
    return uploadToR2(localPath);
  }
  const path = `montage/${Date.now()}-${basename(localPath).replace(/[^\w.\-]+/g, "_")}`;
  console.log("sign_upload…", path);
  const { token, publicUrl } = await call({ action: "sign_upload", path });
  const sb = createClient(SUPABASE_URL, ANON);
  const buf = readFileSync(localPath);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { error } = await sb.storage.from("renders").uploadToSignedUrl(path, token, buf, {
      contentType: "video/mp4",
    });
    if (!error) return publicUrl;
    console.error(`upload attempt ${attempt}:`, error.message);
    if (/exceeded the maximum allowed size/i.test(error.message)) return uploadToR2(localPath);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`upload failed: ${localPath}`);
}

console.log("upload main…");
const publicUrl = await uploadFile(video);
const shortRows = [];
for (const [i, s] of shorts.entries()) {
  if (!existsSync(s)) {
    console.warn("нет файла шортса", s);
    continue;
  }
  console.log(`upload short ${i + 1}…`);
  shortRows.push({ url: await uploadFile(s), title: basename(s, ".mp4") });
}

console.log("complete…");
const res = await call({
  action: "complete",
  id,
  video_url: publicUrl,
  title,
  duration_sec: probeDurationSec(video),
  shorts: shortRows,
});
console.log(JSON.stringify(res, null, 2));
console.log("OK", publicUrl);
