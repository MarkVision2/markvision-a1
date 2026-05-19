// meta-creative-upsert — HTTP endpoint для сохранения метаданных рекламного креатива.
//
// Используется n8n воркфлоу "AI-targetolog" (узлы Create Ad / Save Ad Creative)
// сразу после публикации рекламы в Meta — чтобы ad_id появился в нашей БД
// мгновенно, а не на следующий cron meta-structure-sync.
//
// Без этой связки путь "креатив → CTWA → лид → CRM-этап → CAPI" обрывается:
// лид приходит с meta_ad_id, для которого в meta_creatives нет строки, и в
// CreativeFunnel он висит без креатива.
//
// Auth: shared secret через `x-creative-key` header (n8n его передаёт).
// Body (JSON):
//   {
//     ad_id: string,            // обязательно — главный ключ
//     adset_id?: string,
//     campaign_id?: string,
//     name?: string,            // имя креатива из Meta (или из n8n)
//     project_id?: string,      // если известен — иначе резолвится через cabinet
//     cabinet_id?: string,      // лучше передавать оба
//     ad_account_id?: string,   // act_xxx — fallback для резолва кабинета
//     thumbnail?: string,       // url превью
//     landing_url?: string,
//     primary_text?: string,
//     headline?: string,
//     description?: string,
//     cta?: string,
//     format?: string,          // 'Photo' | 'Video' | 'Carousel'
//     destination?: string,     // 'WHATSAPP' | 'WEBSITE' | 'INSTAGRAM_DM'
//     objective?: string,       // OUTCOME_LEADS, OUTCOME_SALES, MESSAGES
//     effective_status?: string
//   }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-creative-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeActId(id: string): string {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sharedKey = Deno.env.get("CREATIVE_UPSERT_KEY");
  const provided = req.headers.get("x-creative-key");
  // Service role JWT тоже разрешён — на случай вызова из других edge functions.
  const isServiceRole = req.headers.get("Authorization")?.includes(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___",
  );
  if (!isServiceRole && (!sharedKey || provided !== sharedKey)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const adId = String(body.ad_id ?? "").trim();
  if (!adId) return json({ error: "ad_id required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Резолв кабинета: если cabinet_id явно передан — берём его. Иначе пытаемся
  // найти кабинет по ad_account_id (act_xxx).
  let cabinetId: string | null = (body.cabinet_id as string) ?? null;
  let projectId: string | null = (body.project_id as string) ?? null;

  if (!cabinetId && body.ad_account_id) {
    const raw = String(body.ad_account_id).trim();
    const norm = normalizeActId(raw);
    const numeric = raw.replace(/^act_/i, "");
    const { data } = await admin
      .from("ad_cabinets")
      .select("id, project_id")
      .in("ad_account_id", [raw, norm, numeric])
      .limit(1);
    if (data?.[0]) {
      cabinetId = (data[0] as { id: string }).id;
      if (!projectId) projectId = (data[0] as { project_id: string | null }).project_id;
    }
  }
  // Если cabinet_id есть, но project_id не передан — резолвим из кабинета.
  if (cabinetId && !projectId) {
    const { data } = await admin.from("ad_cabinets")
      .select("project_id").eq("id", cabinetId).maybeSingle();
    projectId = (data as { project_id: string | null } | null)?.project_id ?? null;
  }

  // Собираем строку для upsert. ad_id — natural key, остальные поля обновляются
  // при повторном вызове (например, если n8n обновил имя креатива).
  const row: Record<string, unknown> = {
    ad_id: adId,
    adset_id: body.adset_id ?? null,
    campaign_id: body.campaign_id ?? null,
    name: body.name ?? null,
    project_id: projectId,
    cabinet_id: cabinetId,
    thumbnail: body.thumbnail ?? null,
    landing_url: body.landing_url ?? null,
    primary_text: body.primary_text ?? null,
    headline: body.headline ?? null,
    description: body.description ?? null,
    cta: body.cta ?? null,
    format: body.format ?? null,
    destination: body.destination ?? null,
    objective: body.objective ?? null,
    effective_status: body.effective_status ?? "ACTIVE",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("meta_creatives")
    .upsert(row, { onConflict: "ad_id" })
    .select("ad_id, project_id, cabinet_id")
    .single();

  if (error) {
    console.error("[meta-creative-upsert] error:", error.message);
    return json({ error: error.message }, 500);
  }

  console.log(`[meta-creative-upsert] ad_id=${adId} project=${projectId ?? "—"} cabinet=${cabinetId ?? "—"}`);
  return json({ ok: true, ad_id: data.ad_id, project_id: data.project_id, cabinet_id: data.cabinet_id });
});
