#!/usr/bin/env node
/** Дожать complete для уже отрендеренного файла. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
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

const id = process.argv[2];
const video = resolve(process.argv[3] || "");
const title = process.argv[4] || basename(video, ".mp4");
if (!id || !existsSync(video)) {
  console.error("Usage: node scripts/montage-complete-local.mjs <jobId> <video.mp4> [title]");
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

const path = `montage/${Date.now()}-${basename(video).replace(/[^\w.\-]+/g, "_")}`;
console.log("sign_upload…");
const { token, publicUrl } = await call({ action: "sign_upload", path });
console.log("upload…", (readFileSync(video).byteLength / 1e6).toFixed(1), "MB →", publicUrl);
const sb = createClient(SUPABASE_URL, ANON);
const buf = readFileSync(video);
let upErr;
for (let attempt = 1; attempt <= 5; attempt++) {
  const { error } = await sb.storage.from("renders").uploadToSignedUrl(path, token, buf, {
    contentType: "video/mp4",
  });
  if (!error) {
    upErr = null;
    break;
  }
  upErr = error;
  console.error(`upload attempt ${attempt}:`, error.message);
  await new Promise((r) => setTimeout(r, 1500 * attempt));
}
if (upErr) throw upErr;

console.log("complete…");
const res = await call({
  action: "complete",
  id,
  video_url: publicUrl,
  title,
  duration_sec: probeDurationSec(video),
  shorts: [],
});
console.log(JSON.stringify(res, null, 2));
console.log("OK", publicUrl);
