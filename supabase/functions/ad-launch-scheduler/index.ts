// ad-launch-scheduler — материализует авто-запуски в очередь ad_launch_jobs.
//
// Читает два источника:
//   1. ad_cabinets с auto_launch_enabled = true (базовый режим: один запуск
//      в сутки в launch_hour по таймзоне кабинета, в разрешённые days_of_week);
//   2. ad_launch_schedules — когда на кабинет нужно несколько разных запусков.
//
// Дедупликация — через ad_launch_jobs.dedupe_key: уникальный индекс не даст
// создать вторую кампанию, даже если крон отработает дважды в один час.
//
// Запускается pg_cron раз в 5 минут. Auth: x-automation-key.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { type LaunchMedia, type LaunchSpec, validateLaunchSpec } from "../_lib/adLaunchSpec.ts";
import {
  type CabinetRow,
  isDue,
  localParts,
  mediaFromUrls,
  specFromCabinet,
} from "../_lib/adLaunchSchedule.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Свежий креатив из галереи Контент-завода (внешний проект Clony). */
async function galleryMedia(projectId: string | null): Promise<LaunchMedia[]> {
  if (!projectId) return [];
  const url = (Deno.env.get("CLIENT_SUPABASE_URL") || "https://szfgdruhlebfvcmlvxdk.supabase.co")
    .replace(/\/+$/, "");
  const key = Deno.env.get("CLIENT_SUPABASE_SERVICE_ROLE_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return [];
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await db
      .from("content_factory_gallery")
      .select("image_url")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1);
    const imageUrl = (data as Array<{ image_url: string }> | null)?.[0]?.image_url;
    return imageUrl ? mediaFromUrls([imageUrl]) : [];
  } catch (e) {
    console.error("[ad-launch-scheduler] gallery:", (e as Error).message);
    return [];
  }
}

async function enqueue(
  admin: SupabaseClient,
  args: {
    spec: LaunchSpec;
    projectId: string | null;
    cabinetId: string;
    dedupeKey: string;
    budgetLabel: string;
  },
): Promise<{ ok: boolean; reason?: string; launchId?: string }> {
  const problems = validateLaunchSpec(args.spec);
  if (problems.length) return { ok: false, reason: problems.join("; ") };

  const launchId = crypto.randomUUID();

  const { error: campErr } = await admin.from("ad_campaigns").insert({
    cabinet_id: args.cabinetId,
    project_id: args.projectId,
    goal: args.spec.goal,
    budget: args.budgetLabel,
    text: args.spec.text,
    whatsapp_id: args.spec.goal === "whatsapp" ? args.spec.whatsappNumber : null,
    pixel_id: args.spec.goal === "site-leads" ? args.spec.pixelId : null,
    pixel_event: args.spec.goal === "site-leads" ? args.spec.pixelEvent : null,
    lead_form_id: args.spec.goal === "meta-form" ? args.spec.leadFormId : null,
    launch_id: launchId,
    status: "queued",
    status_step: "queued",
    status_message: "Авто-запуск по расписанию поставлен в очередь",
    status_updated_at: new Date().toISOString(),
  });
  if (campErr) console.error("[ad-launch-scheduler] ad_campaigns:", campErr.message);

  const { error } = await admin.from("ad_launch_jobs").insert({
    launch_id: launchId,
    project_id: args.projectId,
    cabinet_id: args.cabinetId,
    source: "schedule",
    spec: args.spec,
    status: "queued",
    step: "queued",
    dedupe_key: args.dedupeKey,
  });

  if (error) {
    // 23505 — сработал уникальный индекс по dedupe_key: задание на этот час
    // уже стоит. Это не ошибка, а штатная защита от повторного прохода крона.
    if (error.code === "23505") {
      await admin.from("ad_campaigns").delete().eq("launch_id", launchId);
      return { ok: false, reason: "duplicate" };
    }
    return { ok: false, reason: error.message };
  }
  return { ok: true, launchId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settings } = await admin
    .from("automation_settings")
    .select("cron_secret")
    .eq("id", true)
    .maybeSingle();
  const expected = (settings as { cron_secret?: string } | null)?.cron_secret
    ?? Deno.env.get("AUTOMATION_CRON_KEY");
  const provided = req.headers.get("x-automation-key") ?? req.headers.get("x-cron-key");
  const isServiceRole = req.headers.get("Authorization")?.includes(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___",
  );
  if (!isServiceRole && (!expected || provided !== expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const now = new Date();
  const results: unknown[] = [];

  // ===== 1. Кабинеты с включённым авто-запуском =====
  const { data: cabinets, error: cabErr } = await admin
    .from("ad_cabinets")
    .select("*")
    .eq("auto_launch_enabled", true)
    .eq("online", true);
  if (cabErr) return json({ error: cabErr.message }, 500);

  for (const raw of (cabinets ?? []) as CabinetRow[]) {
    const tz = raw.timezone || "Asia/Almaty";
    if (!isDue(now, tz, raw.launch_hour ?? 9, raw.days_of_week ?? [])) continue;

    const media = mediaFromUrls(raw.creative_media_urls);
    const spec = specFromCabinet(raw, media.length ? media : await galleryMedia(raw.project_id));
    const { date } = localParts(now, tz);
    const res = await enqueue(admin, {
      spec,
      projectId: raw.project_id,
      cabinetId: raw.id,
      dedupeKey: `cab:${raw.id}:${date}:${raw.launch_hour ?? 9}`,
      budgetLabel: String(Math.round((Number(raw.daily_budget) || 0) / 100)),
    });
    results.push({ cabinet: raw.id, name: raw.name, ...res });
  }

  // ===== 2. Явные расписания =====
  const { data: schedules } = await admin
    .from("ad_launch_schedules")
    .select("*")
    .eq("enabled", true);

  for (const sch of (schedules ?? []) as Array<Record<string, unknown>>) {
    const { data: cab } = await admin
      .from("ad_cabinets")
      .select("*")
      .eq("id", sch.cabinet_id as string)
      .maybeSingle();
    if (!cab) continue;

    const cabinet = cab as CabinetRow;
    const tz = cabinet.timezone || "Asia/Almaty";
    if (!isDue(now, tz, Number(sch.launch_hour) || 9, (sch.days_of_week as number[]) ?? [])) continue;

    const media = sch.creative_source === "content_factory_gallery"
      ? await galleryMedia(cabinet.project_id)
      : mediaFromUrls(
        ((sch.spec as Record<string, unknown>)?.media as LaunchMedia[] | undefined)?.map((m) => m.url)
          ?? cabinet.creative_media_urls,
      );

    // Шаблон расписания перекрывает поля, выведенные из кабинета.
    const spec = { ...specFromCabinet(cabinet, media), ...(sch.spec as Partial<LaunchSpec>), media };
    const { date } = localParts(now, tz);
    const res = await enqueue(admin, {
      spec: spec as LaunchSpec,
      projectId: cabinet.project_id,
      cabinetId: cabinet.id,
      dedupeKey: `sched:${sch.id}:${date}`,
      budgetLabel: String(Math.round((spec as LaunchSpec).budgetCents / 100)),
    });
    if (res.ok) {
      await admin.from("ad_launch_schedules")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", sch.id as string);
    }
    results.push({ schedule: sch.id, name: sch.name, ...res });
  }

  const queued = results.filter((r) => (r as { ok?: boolean }).ok).length;
  if (queued > 0) {
    // Не ждём — воркер и так поднимется ближайшим кроном через минуту.
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ad-launch-worker`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ source: "scheduler", batch_size: Math.min(queued, 20) }),
    }).catch(() => {});
  }

  return json({ ok: true, queued, checked: results.length, results });
});
