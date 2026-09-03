#!/usr/bin/env node
/**
 * Сверка «что реально отдаёт Meta» ↔ «что система записала в cabinet_daily_insights».
 *
 * Ничего не меняет — только читает Graph API и Supabase. Нужен, чтобы понять,
 * почему цифры в «Управлении рекламой» расходятся с Ads Manager:
 *   1) показывает ВСЕ action_type за период (видно, двоятся ли лиды);
 *   2) считает лиды по кампаниям (как пайплайн) и показывает, сколько давала
 *      старая формула «заявки + переписки»;
 *   3) сравнивает clicks (все клики) с inline_link_clicks (клики по ссылке) —
 *      Ads Manager по умолчанию показывает CTR/CPC именно по link clicks;
 *   4) тянет те же данные с use_unified_attribution_setting=true — это режим,
 *      в котором Graph API отдаёт ровно то, что видно в Ads Manager;
 *   5) при наличии service-role ключа сверяет всё это с тем, что лежит в БД.
 *
 * Запуск:
 *   node scripts/meta-doctor.mjs --act act_946037834437407 --since 2026-09-01 --until 2026-09-03
 *
 * Токен: --token <meta_token> либо META_ACCESS_TOKEN в окружении.
 * Сверка с БД (опционально): SUPABASE_SERVICE_ROLE_KEY в окружении
 * (+ SUPABASE_URL, по умолчанию szfgdruhlebfvcmlvxdk).
 */

const API = "v21.0";
const SB_URL = process.env.SUPABASE_URL || "https://szfgdruhlebfvcmlvxdk.supabase.co";

// Те же списки, что в supabase/functions/meta-daily-sync/index.ts.
const LEAD_ACTIONS = [
  "lead",
  "leadgen.other",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_web_lead",
];
const MESSAGING_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d"];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

function normalizeActId(id) {
  const t = String(id || "").trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

const num = (v) => Number(v || 0);
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

function maxAction(actions, types) {
  let max = 0;
  for (const a of actions ?? []) {
    if (types.includes(a.action_type)) max = Math.max(max, num(a.value));
  }
  return max;
}

async function graph(path, params, token) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`https://graph.facebook.com/${API}/${path}?${qs}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}

async function insights(actId, since, until, token, unified, level = "account") {
  const params = {
    fields: [
      "date_start",
      "spend",
      "impressions",
      "clicks",
      "inline_link_clicks",
      "actions",
      "action_values",
    ].join(","),
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    level,
    limit: "500",
  };
  if (level === "campaign") params.fields += ",campaign_id";
  if (unified) params.use_unified_attribution_setting = "true";
  const rows = [];
  let j = await graph(`${actId}/insights`, params, token);
  rows.push(...(j.data ?? []));
  // Пагинация: месяц влезает в один ответ, но длинные периоды — нет.
  while (j?.paging?.next) {
    const r = await fetch(j.paging.next);
    j = await r.json();
    if (j.error) throw new Error(j.error.message);
    rows.push(...(j.data ?? []));
  }
  return rows;
}

/**
 * Лиды одного объекта — как считает meta-daily-sync после фикса: максимум по всем
 * лид-событиям, включая переписки (складывать нельзя — Meta кладёт один диалог
 * сразу в несколько action_type).
 */
function pipelineLeads(row) {
  const form = maxAction(row.actions, LEAD_ACTIONS);
  const msg = maxAction(row.actions, MESSAGING_ACTIONS);
  return { form, msg, leads: Math.max(form, msg), legacyLeads: form + msg };
}

/** Лиды по дням = сумма кампаний за день (как в meta-daily-sync). */
function leadsByDate(campaignRows) {
  const byDate = new Map();
  for (const r of campaignRows) {
    const l = pipelineLeads(r);
    const cur = byDate.get(r.date_start) ?? { leads: 0, messages: 0, legacyLeads: 0 };
    cur.leads += l.leads;
    cur.messages += l.msg;
    cur.legacyLeads += l.legacyLeads;
    byDate.set(r.date_start, cur);
  }
  return byDate;
}

function totals(rows, byDate) {
  const t = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, msg: 0, leads: 0, legacyLeads: 0 };
  for (const r of rows) {
    t.spend += num(r.spend);
    t.impressions += num(r.impressions);
    t.clicks += num(r.clicks);
    t.linkClicks += num(r.inline_link_clicks);
    const day = byDate?.get(r.date_start);
    const l = day ?? pipelineLeads(r);
    t.msg += day ? day.messages : l.msg;
    t.leads += l.leads;
    t.legacyLeads += l.legacyLeads;
  }
  return t;
}

async function cdiRows(actId, since, until, serviceKey) {
  const qs = new URLSearchParams({
    select: "date,spend,impressions,clicks,leads,currency,cabinet_id,project_id,synced_at",
    external_id: `eq.${actId}`,
    date: `gte.${since}`,
    order: "date.asc",
  });
  qs.append("date", `lte.${until}`);
  const r = await fetch(`${SB_URL}/rest/v1/cabinet_daily_insights?${qs}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  const token = arg("token") || process.env.META_ACCESS_TOKEN;
  const actId = normalizeActId(arg("act") || "");
  const since = arg("since");
  const until = arg("until");

  if (!token || !actId || !since || !until) {
    console.error(
      "Использование: node scripts/meta-doctor.mjs --act act_XXXX --since YYYY-MM-DD --until YYYY-MM-DD [--token …]",
    );
    process.exit(1);
  }

  const acc = await graph(actId, {
    fields: "name,currency,timezone_name,account_status",
  }, token);
  console.log("\n=== Кабинет ===");
  console.log(`  ${acc.name ?? actId} (${actId})`);
  console.log(`  валюта: ${acc.currency}   часовой пояс: ${acc.timezone_name}   статус: ${acc.account_status}`);
  if (acc.timezone_name && acc.timezone_name !== "Asia/Almaty") {
    console.log(
      `  ⚠ дни Meta нарезаны по ${acc.timezone_name}, а лиды CRM — по Asia/Almaty: посуточное сравнение будет со сдвигом`,
    );
  }

  // Аккаунт — расход/клики; кампании — лиды (так же считает meta-daily-sync).
  const [rowsDefault, campaignRows, rowsUnified] = await Promise.all([
    insights(actId, since, until, token, true),
    insights(actId, since, until, token, true, "campaign").catch((e) => {
      console.log(`  ⚠ запрос по кампаниям не прошёл: ${e.message}`);
      return null;
    }),
    insights(actId, since, until, token, false).catch(() => null),
  ]);

  const byDate = campaignRows ? leadsByDate(campaignRows) : null;
  const tDef = totals(rowsDefault, byDate);
  const tUni = rowsUnified ? totals(rowsUnified, null) : null;

  console.log(`\n=== Meta, ${since}..${until} (окно атрибуции Ads Manager) ===`);
  console.log(
    `  ${pad("дата", 12)}${padL("расход", 12)}${padL("показы", 10)}${padL("клики", 8)}` +
    `${padL("по ссылке", 11)}${padL("переписки", 11)}${padL("лиды", 8)}${padL("было", 8)}`,
  );
  for (const r of rowsDefault) {
    const day = byDate?.get(r.date_start) ?? pipelineLeads(r);
    const msg = day.messages ?? day.msg;
    console.log(
      `  ${pad(r.date_start, 12)}${padL(fmt(num(r.spend)), 12)}${padL(num(r.impressions), 10)}` +
      `${padL(num(r.clicks), 8)}${padL(num(r.inline_link_clicks), 11)}${padL(msg, 11)}` +
      `${padL(day.leads, 8)}${padL(day.legacyLeads, 8)}`,
    );
  }
  console.log(
    `  ${pad("ИТОГО", 12)}${padL(fmt(tDef.spend), 12)}${padL(tDef.impressions, 10)}${padL(tDef.clicks, 8)}` +
    `${padL(tDef.linkClicks, 11)}${padL(tDef.msg, 11)}${padL(tDef.leads, 8)}${padL(tDef.legacyLeads, 8)}`,
  );
  console.log(`  «было» — старая формула (заявки + переписки), из-за неё лиды двоились.`);

  const ctrAll = tDef.impressions ? (tDef.clicks / tDef.impressions) * 100 : 0;
  const ctrLink = tDef.impressions ? (tDef.linkClicks / tDef.impressions) * 100 : 0;
  const cpcAll = tDef.clicks ? tDef.spend / tDef.clicks : 0;
  const cpcLink = tDef.linkClicks ? tDef.spend / tDef.linkClicks : 0;
  console.log("\n=== CTR / CPC ===");
  console.log(`  по кликам по ссылке (так теперь считает система и так показывает Ads Manager):`);
  console.log(`    CTR ${fmt(ctrLink)}%    CPC ${fmt(cpcLink)}`);
  console.log(`  по всем кликам (как было раньше — лайки и клики по профилю тоже считались):`);
  console.log(`    CTR ${fmt(ctrAll)}%    CPC ${fmt(cpcAll)}`);

  if (tUni) {
    console.log("\n=== Окно атрибуции ===");
    console.log(`  окно Ads Manager (unified):   расход ${fmt(tDef.spend)}   лид-событий ${tDef.legacyLeads}`);
    console.log(`  окно API по умолчанию:        расход ${fmt(tUni.spend)}   лид-событий ${tUni.legacyLeads}`);
    if (tUni.legacyLeads !== tDef.legacyLeads) {
      console.log("  ⚠ окна дают разные конверсии — без unified цифры не сходились бы с Meta");
    }
  }

  console.log("\n=== Все action_type за период (сырьё Meta) ===");
  const byType = new Map();
  for (const r of rowsDefault) {
    for (const a of r.actions ?? []) {
      byType.set(a.action_type, (byType.get(a.action_type) ?? 0) + num(a.value));
    }
  }
  const sorted = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, value] of sorted) {
    const mark = LEAD_ACTIONS.includes(type)
      ? " ← лид-событие"
      : MESSAGING_ACTIONS.includes(type)
        ? " ← начатые переписки (тот же лид)"
        : "";
    console.log(`  ${padL(fmt(value, 0), 8)}  ${type}${mark}`);
  }

  if (tDef.legacyLeads !== tDef.leads) {
    console.log("\n=== Двойной счёт лидов ===");
    console.log(
      `  старая формула: ${tDef.legacyLeads}   новая (по кампаниям): ${tDef.leads}   ` +
      `завышение: ${fmt(((tDef.legacyLeads - tDef.leads) / Math.max(1, tDef.leads)) * 100, 0)}%`,
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.log("\n(SUPABASE_SERVICE_ROLE_KEY не задан — сверка с cabinet_daily_insights пропущена)\n");
    return;
  }

  const stored = await cdiRows(actId, since, until, serviceKey);
  const storedByDate = new Map(stored.map((r) => [r.date, r]));
  console.log("\n=== Что записано в cabinet_daily_insights ===");
  console.log(
    `  ${pad("дата", 12)}${padL("расход БД", 12)}${padL("вал.", 6)}${padL("лиды БД", 9)}` +
    `${padL("лиды Meta", 11)}${padL("клики БД", 10)}  расхождение`,
  );
  const currencies = new Set();
  for (const r of rowsDefault) {
    const db = storedByDate.get(r.date_start);
    const l = pipelineLeads(r);
    if (db) currencies.add(db.currency);
    const diff = !db
      ? "НЕТ СТРОКИ В БД"
      : num(db.leads) !== l.leads
        ? `лиды ${num(db.leads)} ≠ ${l.leads}`
        : "";
    console.log(
      `  ${pad(r.date_start, 12)}${padL(db ? fmt(num(db.spend)) : "—", 12)}${padL(db?.currency ?? "—", 6)}` +
      `${padL(db ? num(db.leads) : "—", 9)}${padL(l.leads, 11)}${padL(db ? num(db.clicks) : "—", 10)}  ${diff}`,
    );
  }
  if (currencies.size > 1) {
    console.log(
      `  ⚠ в одном периоде строки в разных валютах (${[...currencies].join(", ")}) — ` +
      "итог месяца суммирует несопоставимые числа",
    );
  }
  const orphan = stored.filter((r) => !rowsDefault.some((x) => x.date_start === r.date));
  if (orphan.length) {
    console.log(`  ⚠ в БД есть ${orphan.length} дн., которых нет в ответе Meta: ${orphan.map((r) => r.date).join(", ")}`);
  }
  const cabinets = new Set(stored.map((r) => r.cabinet_id));
  if (cabinets.size > 1) {
    console.log(`  ⚠ строки этого act_ привязаны к разным кабинетам (${cabinets.size}) — ключ upsert external_id+date их перетирает`);
  }
  const lastSync = stored.map((r) => r.synced_at).filter(Boolean).sort().pop();
  console.log(`\n  последний синк: ${lastSync ?? "никогда"}`);
  console.log("");
}

main().catch((e) => {
  console.error(`Ошибка: ${e.message}`);
  process.exit(1);
});
