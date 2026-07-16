// Выдаёт браузеру presigned URL для прямой загрузки файла в Cloudflare R2 —
// используется автопостингом для файлов больше 50 МБ, которые Supabase
// Storage на Free-плане не принимает (жёсткий лимит платформы). Сами байты
// идут из браузера напрямую в R2, минуя наш сервер и лимит Supabase.
//
// verify_jwt=false, защита заголовком x-app-key == cf_settings.client_pub_key
// (тот же механизм, что и у content-scheduler/publisher).
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-key",
};

// 2 ГБ: сырые исходники «Монтажа съёмки» (говорящая голова с телефона) легко
// перерастают прежние 500 МБ; Reels/карусели автопостинга в лимит тем более влезают.
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
async function setting(k: string) {
  const r = await fetch(`${SB_URL}/rest/v1/cf_settings?key=eq.${k}&select=value`, { headers: H });
  const body = (await r.json().catch(() => null)) as { value: string }[] | null;
  return body?.[0]?.value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const appKey = req.headers.get("x-app-key") ?? "";
  const expected = await setting("client_pub_key");
  if (!expected || appKey !== expected) return json({ error: "forbidden" }, 403);

  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  const publicUrl = Deno.env.get("R2_PUBLIC_URL");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    return json({ error: "R2 не настроен на сервере (нет R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_PUBLIC_URL)" }, 500);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const filename = String(body?.filename ?? "");
  const contentType = String(body?.contentType ?? "application/octet-stream");
  const size = Number(body?.size ?? 0);
  if (!filename) return json({ error: "filename обязателен" }, 400);
  if (!Number.isFinite(size) || size <= 0) return json({ error: "size обязателен" }, 400);
  if (size > MAX_BYTES) return json({ error: `Файл больше ${Math.round(MAX_BYTES / 1024 / 1024)} МБ` }, 400);

  try {
    const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const key = `posts/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
    const signed = await client.sign(endpoint, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      aws: { signQuery: true },
    });

    return json({
      ok: true,
      uploadUrl: signed.url,
      publicUrl: `${publicUrl.replace(/\/+$/, "")}/${key}`,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
