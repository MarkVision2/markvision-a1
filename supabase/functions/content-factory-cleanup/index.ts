/**
 * Еженедельная очистка контент-завода в Clony Supabase (szfgdruhlebfvcmlvxdk):
 * - content_factory_gallery / content_factory_results (через RPC)
 * - Storage: content-factory-uploads/requests/ (временные референс-фото)
 *
 * Вызов: cron (GitHub Actions / pg_cron) с заголовком x-cleanup-key
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cleanup-key",
};

const DEFAULT_GALLERY_DAYS = 30;
const DEFAULT_RESULTS_DAYS = 14;
const DEFAULT_UPLOADS_DAYS = 14;
const LIST_PAGE = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseDays(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get("CONTENT_FACTORY_CLEANUP_KEY");
  if (!expected) return false;
  const key = req.headers.get("x-cleanup-key");
  return key === expected;
}

type StorageClient = ReturnType<typeof createClient>;

/** Рекурсивно удаляет файлы старше cutoff (папки requests/{id}/{subfolder}/…). */
async function deleteOldStorageObjects(
  client: StorageClient,
  bucket: string,
  prefix: string,
  cutoffMs: number,
): Promise<number> {
  let deleted = 0;
  let offset = 0;

  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error) {
      console.warn(`[cleanup] list ${bucket}/${prefix}`, error.message);
      break;
    }
    if (!data?.length) break;

    for (const item of data) {
      if (!item.name) continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.id === null) {
        deleted += await deleteOldStorageObjects(client, bucket, path, cutoffMs);
        continue;
      }

      const created = item.created_at ? new Date(item.created_at).getTime() : 0;
      if (created > 0 && created < cutoffMs) {
        const { error: delErr } = await client.storage.from(bucket).remove([path]);
        if (delErr) console.warn(`[cleanup] remove ${bucket}/${path}`, delErr.message);
        else deleted += 1;
      }
    }

    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }

  return deleted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isAuthorized(req)) return json({ error: "Unauthorized" }, 401);

  const clientUrl = Deno.env.get("CLIENT_SUPABASE_URL");
  const clientKey = Deno.env.get("CLIENT_SUPABASE_SERVICE_ROLE_KEY");
  if (!clientUrl || !clientKey) {
    return json({ error: "CLIENT_SUPABASE_URL / CLIENT_SUPABASE_SERVICE_ROLE_KEY not configured" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* empty body ok */
  }

  const galleryDays = parseDays(
    String(body.gallery_days ?? Deno.env.get("CF_GALLERY_RETENTION_DAYS") ?? ""),
    DEFAULT_GALLERY_DAYS,
  );
  const resultsDays = parseDays(
    String(body.results_days ?? Deno.env.get("CF_RESULTS_RETENTION_DAYS") ?? ""),
    DEFAULT_RESULTS_DAYS,
  );
  const uploadsDays = parseDays(
    String(body.uploads_days ?? Deno.env.get("CF_UPLOADS_RETENTION_DAYS") ?? ""),
    DEFAULT_UPLOADS_DAYS,
  );

  const sb = createClient(clientUrl, clientKey, { auth: { persistSession: false } });

  const { data: rpcData, error: rpcError } = await sb.rpc("cleanup_content_factory_data", {
    p_gallery_days: galleryDays,
    p_results_days: resultsDays,
    p_write_log: false,
  });

  if (rpcError) {
    return json({ error: "RPC cleanup failed", detail: rpcError.message }, 500);
  }

  const uploadsCutoff = Date.now() - uploadsDays * 86_400_000;
  const uploadsDeleted = await deleteOldStorageObjects(sb, "content-factory-uploads", "requests", uploadsCutoff);

  await sb.from("content_factory_cleanup_log").insert({
    source: "edge",
    gallery_deleted: (rpcData as { gallery_deleted?: number })?.gallery_deleted ?? 0,
    results_deleted: (rpcData as { results_deleted?: number })?.results_deleted ?? 0,
    storage_deleted: uploadsDeleted,
    gallery_retention_days: galleryDays,
    results_retention_days: resultsDays,
    details: {
      rpc: rpcData,
      uploads_deleted: uploadsDeleted,
      uploads_days: uploadsDays,
    },
  });

  return json({
    ok: true,
    gallery_days: galleryDays,
    results_days: resultsDays,
    uploads_days: uploadsDays,
    db: rpcData,
    storage: { uploads_deleted: uploadsDeleted },
  });
});
