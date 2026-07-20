import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const DEMO_NAME = "Эрик";
const EXTERNAL_ID = "act_demo_eric";
const TOTAL_SPEND = 540_000;
const TOTAL_LEADS = 270;
const SALE_AMOUNT = 263_000;
const TOTAL_SALES = 18;
const TOTAL_REVENUE = 4_734_000;

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function stageKeyForIndex(i: number): string {
  if (i <= 45) return "new";
  if (i <= 70) return "no_answer";
  if (i <= 110) return "in_progress";
  if (i <= 145) return "scheduled";
  if (i <= 198) return "visit";
  if (i <= 252) return "invoice";
  if (i <= 270) return "paid";
  return "rejected";
}

export async function seedEricDemo(
  admin: SupabaseClient,
  monthStart = "2026-07-01",
  monthEnd = "2026-07-31",
) {
  const days = daysBetween(monthStart, monthEnd);
  const dayCount = days.length;

  // RPC если миграция уже накатилась
  const { data: rpcData, error: rpcError } = await admin.rpc("seed_demo_project_eric", {
    p_month_start: monthStart,
    p_month_end: monthEnd,
  });
  if (!rpcError && rpcData) return rpcData;

  // --- fallback: TypeScript seed (без SQL-функции в БД) ---
  let projectId: string;
  const { data: existing } = await admin.from("projects").select("id").ilike("name", DEMO_NAME).limit(1)
    .maybeSingle();
  if (existing?.id) {
    projectId = existing.id as string;
  } else {
    const { data: created, error } = await admin.from("projects").insert({
      name: DEMO_NAME,
      domain: "eric.demo",
      initials: "ЭР",
      is_primary: false,
    }).select("id").single();
    if (error || !created) throw error ?? new Error("create project failed");
    projectId = created.id as string;
  }

  await admin.rpc("ensure_project_pipeline", { p_project_id: projectId });

  const { data: pipeline } = await admin.from("pipelines")
    .select("id").eq("project_id", projectId).eq("is_default", true).maybeSingle();
  if (!pipeline?.id) throw new Error("pipeline missing");
  const pipelineId = pipeline.id as string;

  const { data: stages } = await admin.from("pipeline_stages")
    .select("id,key").eq("pipeline_id", pipelineId);
  const stageByKey = new Map((stages ?? []).map((s) => [s.key as string, s.id as string]));

  // cleanup
  const { data: oldLeads } = await admin.from("leads").select("id").eq("project_id", projectId);
  const leadIds = (oldLeads ?? []).map((l) => l.id as string);
  if (leadIds.length) {
    await admin.from("communications").delete().in("lead_id", leadIds);
    await admin.from("tasks").delete().in("lead_id", leadIds);
    await admin.from("leads").delete().eq("project_id", projectId);
  }
  await admin.from("meta_creative_daily").delete().eq("project_id", projectId);
  await admin.from("meta_creatives").delete().eq("project_id", projectId);
  await admin.from("meta_campaign_daily").delete().eq("project_id", projectId);
  await admin.from("meta_campaigns").delete().eq("project_id", projectId);
  await admin.from("cabinet_daily_insights").delete().eq("project_id", projectId)
    .gte("date", monthStart).lte("date", monthEnd);
  await admin.from("rnp_daily").delete().eq("project_id", projectId)
    .gte("date", monthStart).lte("date", monthEnd);

  let cabinetId: string;
  const { data: cab } = await admin.from("ad_cabinets").select("id")
    .eq("project_id", projectId).eq("external_id", EXTERNAL_ID).maybeSingle();
  if (cab?.id) {
    cabinetId = cab.id as string;
    await admin.from("ad_cabinets").update({
      name: "Meta Ads — Эрик (демо)",
      online: true,
      spend: 0, leads: 0, sales: 0, revenue: 0,
    }).eq("id", cabinetId);
  } else {
    const { data: newCab, error } = await admin.from("ad_cabinets").insert({
      project_id: projectId,
      name: "Meta Ads — Эрик (демо)",
      external_id: EXTERNAL_ID,
      online: true,
      type: "Демо",
      provider: "meta",
      spend: 0, leads: 0, sales: 0, revenue: 0,
    }).select("id").single();
    if (error || !newCab) throw error ?? new Error("cabinet create failed");
    cabinetId = newCab.id as string;
  }

  const baseSpend = Math.floor(TOTAL_SPEND / dayCount);
  const spendRem = TOTAL_SPEND - baseSpend * dayCount;
  const baseLeads = Math.floor(TOTAL_LEADS / dayCount);
  const leadsRem = TOTAL_LEADS - baseLeads * dayCount;

  const cdiRows = days.map((date, idx) => {
    const spend = baseSpend + (idx < spendRem ? 1 : 0);
    const leads = baseLeads + (idx < leadsRem ? 1 : 0);
    const impr = 14000 + (idx * 137) % 9000;
    const clicks = 200 + (idx * 23) % 280;
    return {
      cabinet_id: cabinetId,
      external_id: EXTERNAL_ID,
      project_id: projectId,
      provider: "meta",
      date,
      spend,
      impressions: impr,
      clicks,
      leads,
      revenue: 0,
      currency: "KZT",
      crm_diagnostics: 0,
      crm_sales: 0,
      crm_revenue: 0,
      crm_diagnostic_revenue: 0,
      ctr: Math.round((clicks / impr) * 10000) / 100,
      cpc: Math.round((spend / clicks) * 100) / 100,
      cpm: Math.round((spend / impr) * 1000000) / 100,
      cpl: Math.round((spend / leads) * 100) / 100,
    };
  });
  const { error: cdiErr } = await admin.from("cabinet_daily_insights").upsert(cdiRows, {
    onConflict: "external_id,date",
  });
  if (cdiErr) throw cdiErr;

  const campaigns = [
    { campaign_id: "8801001", name: "Эрик | WhatsApp лиды", daily_budget: 22000, status: "ACTIVE" },
    { campaign_id: "8801002", name: "Эрик | Запись на консультацию", daily_budget: 16000, status: "ACTIVE" },
    { campaign_id: "8801003", name: "Эрик | Ретаргет", daily_budget: 10000, status: "PAUSED" },
  ];
  await admin.from("meta_campaigns").upsert(
    campaigns.map((c) => ({
      cabinet_id: cabinetId,
      project_id: projectId,
      campaign_id: c.campaign_id,
      name: c.name,
      objective: "OUTCOME_LEADS",
      destination_type: c.campaign_id === "8801002" ? "WEBSITE" : "WHATSAPP",
      effective_status: c.status,
      daily_budget: c.daily_budget,
    })),
    { onConflict: "campaign_id" },
  );

  const mcdRows = days.flatMap((date, idx) => {
    const spend = baseSpend + (idx < spendRem ? 1 : 0);
    const leads = baseLeads + (idx < leadsRem ? 1 : 0);
    return [
      { campaign_id: "8801001", spend: Math.round(spend * 0.45), leads: Math.round(leads * 0.5) },
      { campaign_id: "8801002", spend: Math.round(spend * 0.35), leads: Math.round(leads * 0.35) },
      { campaign_id: "8801003", spend: spend - Math.round(spend * 0.45) - Math.round(spend * 0.35),
        leads: leads - Math.round(leads * 0.5) - Math.round(leads * 0.35) },
    ].map((c) => ({
      campaign_id: c.campaign_id,
      cabinet_id: cabinetId,
      project_id: projectId,
      date,
      spend: c.spend,
      impressions: 2000 + idx * 50,
      clicks: 30 + idx % 40,
      leads: c.leads,
      messages: Math.round(c.leads * 0.3),
      currency: "KZT",
    }));
  });
  await admin.from("meta_campaign_daily").upsert(mcdRows, { onConflict: "campaign_id,date" });

  for (let i = 1; i <= 8; i++) {
    const adId = `880200${i}`;
    const campId = i <= 3 ? "8801001" : i <= 6 ? "8801002" : "8801003";
    await admin.from("meta_creatives").upsert({
      cabinet_id: cabinetId,
      project_id: projectId,
      ad_id: adId,
      campaign_id: campId,
      name: `eric_kreativ_${i} | video | demo`,
      creative_type: "video",
      effective_status: i <= 5 ? "ACTIVE" : "CAMPAIGN_PAUSED",
      thumbnail_url: `https://picsum.photos/seed/eric${i}/400/711`,
      image_url: `https://picsum.photos/seed/eric${i}/400/711`,
      poster_url: `https://picsum.photos/seed/eric${i}/720/1280`,
      headline: "Эрик — консультация и разбор",
      primary_text: "Запишитесь на бесплатную консультацию. Разберём вашу ситуацию и составим план.",
      cta: "Написать в WhatsApp",
    }, { onConflict: "ad_id" });
  }

  const leadRows = Array.from({ length: TOTAL_LEADS }, (_, idx) => {
    const i = idx + 1;
    const key = stageKeyForIndex(i);
    const stageId = stageByKey.get(key) ?? stageByKey.get("new");
    const dayOffset = (i - 1) % dayCount;
    const created = new Date(`${days[dayOffset]}T08:00:00Z`);
    created.setUTCHours(created.getUTCHours() + (i % 10));
    const isPaid = i >= 253 && i <= 270;
    const paidAt = isPaid
      ? new Date(`${days[(i - 253) % dayCount]}T14:00:00Z`)
      : null;
    return {
      project_id: projectId,
      cabinet_id: cabinetId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      name: i % 7 === 0 ? `Айгуль ${i % 100}` : i % 5 === 0 ? `Данияр ${i % 100}` : `Клиент ${String(i).padStart(3, "0")}`,
      phone: `+7705${String(3_000_000 + i).padStart(7, "0")}`,
      source: "meta",
      channel: "whatsapp",
      campaign: ["Эрик | WhatsApp лиды", "Эрик | Запись", "Эрик | Ретаргет"][i % 3],
      meta_ad_id: `880200${1 + (i % 8)}`,
      meta_campaign_id: `880100${1 + (i % 3)}`,
      amount: isPaid ? SALE_AMOUNT : 0,
      diagnostic_amount: i >= 199 && i <= 252 ? 18000 + (i % 7) * 1200 : 0,
      paid: isPaid,
      paid_at: paidAt?.toISOString() ?? null,
      created_at: created.toISOString(),
      last_activity_at: created.toISOString(),
      first_response_at: new Date(created.getTime() + 12 * 60_000).toISOString(),
      city: ["Алматы", "Астана", "Шымкент", "Караганда"][i % 4],
      service: ["Консультация", "Курс", "Менторство", "Разбор", "Диагностика"][i % 5],
      ai_score: 42 + (i % 48),
      temperature: i % 9 === 0 ? "hot" : i % 3 === 0 ? "warm" : "cold",
      tags: i % 6 === 0 ? ["vip"] : [],
    };
  });
  const { data: insertedLeads, error: leadErr } = await admin.from("leads").insert(leadRows).select("id,created_at");
  if (leadErr) throw leadErr;

  await admin.rpc("reconcile_cdi_for_project", {
    p_project_id: projectId,
    p_since: monthStart,
  });

  const rnpRows = days.map((date, idx) => ({
    project_id: projectId,
    date,
    diag_revenue: 35000 + (idx % 5) * 8000,
    planned_diagnostics: 3 + (idx % 3),
    conducted_diagnostics: 2 + (idx % 2),
    prepayments_count: idx % 3,
    prepayments_sum: 60000 + (idx % 7) * 15000,
    cash_received: 120000 + (idx % 11) * 25000,
  }));
  await admin.from("rnp_daily").insert(rnpRows);

  const monthKey = monthStart.slice(0, 7);
  await admin.from("revenue_plan").upsert({
    project_id: projectId,
    month_key: monthKey,
    value: TOTAL_REVENUE,
  }, { onConflict: "project_id,month_key" });
  await admin.from("finance_plans").upsert({
    project_id: projectId,
    month_key: monthKey,
    spend: TOTAL_SPEND,
    leads: TOTAL_LEADS,
    cpl: 2000,
    visits: 54,
    sales: TOTAL_SALES,
    revenue: TOTAL_REVENUE,
    cr_lead_visit: 0.2,
    cr_visit_sale: 0.33,
    avg_check: SALE_AMOUNT,
  }, { onConflict: "project_id,month_key" });
  await admin.from("monthly_finance").upsert({
    project_id: projectId,
    month_key: monthKey,
    revenue: TOTAL_REVENUE,
    spend: TOTAL_SPEND,
  }, { onConflict: "project_id,month_key" });

  const commLeads = (insertedLeads ?? []).slice(20, 60);
  const commRows = commLeads.flatMap((l) => {
    const t = new Date(l.created_at as string);
    return [
      { lead_id: l.id, type: "message", channel: "whatsapp", direction: "in",
        content: "Здравствуйте! Увидел рекламу, хочу узнать подробнее", status: "delivered",
        created_at: new Date(t.getTime() + 5 * 60_000).toISOString(), is_auto: false, is_draft: false },
      { lead_id: l.id, type: "message", channel: "whatsapp", direction: "out",
        content: "Добрый день! Расскажите, что вас интересует?", status: "delivered",
        created_at: new Date(t.getTime() + 12 * 60_000).toISOString(), is_auto: false, is_draft: false },
      { lead_id: l.id, type: "message", channel: "whatsapp", direction: "in",
        content: "Интересует консультация и формат работы", status: "delivered",
        created_at: new Date(t.getTime() + 25 * 60_000).toISOString(), is_auto: false, is_draft: false },
    ];
  });
  if (commRows.length) await admin.from("communications").insert(commRows);

  const { data: cabTotals } = await admin.from("cabinet_daily_insights")
    .select("spend,leads,crm_sales,crm_revenue").eq("cabinet_id", cabinetId);
  const spend = (cabTotals ?? []).reduce((s, r) => s + Number(r.spend ?? 0), 0);
  const leads = (cabTotals ?? []).reduce((s, r) => s + Number(r.leads ?? 0), 0);
  const sales = (cabTotals ?? []).reduce((s, r) => s + Number(r.crm_sales ?? 0), 0);
  const revenue = (cabTotals ?? []).reduce((s, r) => s + Number(r.crm_revenue ?? 0), 0);
  await admin.from("ad_cabinets").update({ spend, leads, sales, revenue }).eq("id", cabinetId);

  return {
    ok: true,
    mode: rpcError ? "typescript" : "rpc",
    project_id: projectId,
    project_name: DEMO_NAME,
    month: { from: monthStart, to: monthEnd },
    kpi: {
      spend: TOTAL_SPEND,
      leads: TOTAL_LEADS,
      cpl: Math.round(TOTAL_SPEND / TOTAL_LEADS),
      sales: TOTAL_SALES,
      revenue: TOTAL_REVENUE,
    },
    counts: {
      cdi_days: days.length,
      creatives: 8,
      leads: TOTAL_LEADS,
      communications: commRows.length,
    },
  };
}
