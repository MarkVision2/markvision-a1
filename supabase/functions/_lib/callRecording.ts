// Архив записей разговоров, общий для провайдеров телефонии.
//
// Ссылка АТС на запись живёт недолго (у Binotel — 15 минут), поэтому в карточку
// лида нельзя класть её как есть: через час это мёртвый URL. Качаем файл в bucket
// call-recordings и отдаём постоянную ссылку — её же играет плеер в ленте лида
// и по ней же работает разбор AI-РОПом.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { validateRecordingUrl } from "./auth.ts";

export const RECORDING_BUCKET = "call-recordings";
const MAX_RECORDING_BYTES = 100 * 1024 * 1024; // совпадает с лимитом бакета
const TIMEOUT_MS = 25_000;

export type ArchivedRecording = {
  url: string;
  mime: string;
  filename: string;
  bytes: number;
};

export async function archiveRecording(
  admin: SupabaseClient,
  sourceUrl: string,
  leadId: string,
  callId: string,
  provider = "call",
): Promise<ArchivedRecording | null> {
  // Ссылка может приходить из payload вебхука, то есть снаружи. Гоним её через
  // тот же allow-list, что и разбор записи, иначе получаем SSRF: функция ходит
  // service-role клиентом и достала бы внутренние адреса.
  const safeUrl = validateRecordingUrl(sourceUrl);
  if (!safeUrl) {
    console.warn(`[${provider}] recording url rejected by allow-list`);
    return null;
  }

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(safeUrl, { signal: ctrl.signal });
    if (!res.ok) {
      console.warn(`[${provider}] recording download non-2xx`, res.status);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) return null;
    if (buf.byteLength > MAX_RECORDING_BYTES) {
      console.warn(`[${provider}] recording too large`, buf.byteLength);
      return null;
    }

    const mime = (res.headers.get("content-type") ?? "audio/mpeg").split(";")[0].trim();
    const ext = mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "mp3";
    const safeCallId = callId.replace(/[^A-Za-z0-9_-]/g, "") || crypto.randomUUID();
    const filename = `${provider}-${safeCallId}.${ext}`;
    const path = `${leadId}/${safeCallId}.${ext}`;

    const { error } = await admin.storage.from(RECORDING_BUCKET).upload(path, buf, {
      contentType: mime,
      upsert: true,
    });
    if (error) {
      console.error(`[${provider}] recording upload failed`, error.message);
      return null;
    }
    const { data } = admin.storage.from(RECORDING_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, mime, filename, bytes: buf.byteLength };
  } catch (e) {
    console.warn(`[${provider}] recording archive failed`, e);
    return null;
  } finally {
    clearTimeout(tid);
  }
}
