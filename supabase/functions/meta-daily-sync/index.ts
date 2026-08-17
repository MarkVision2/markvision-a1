import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v21.0";

// "Лиды с сайта / лид-формы" — берём максимум среди вариантов одного и того же события,
// чтобы не задвоить (Meta часто дублирует одно и то же действие под разными именами).
const LEAD_ACTIONS = [
  "lead",
  "leadgen.other",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_web_lead",
];
// "Начатые переписки" — отдельное событие, считаем как лид и СУММИРУЕМ с лидами выше.
// Только то событие, что Meta UI показывает в графе "Начало переписки".
const MESSAGING_ACTIONS = [
  "onsite_conversion.messaging_conversation_started_7d",
];
const PURCHASE_ACTIONS = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
];

function maxAction(actions: Array<{ action_type: string; value: string }> | undefined, types: string[]) {
  if (!actions) return 0;
  let max = 0;
  for (const a of actions) {
    if (types.includes(a.action_type)) {
      const v = Number(a.value || 0);
      if (v > max) max = v;
    }
  }
  return max;
}
function sumActions(actions: Array<{ action_type: string; value: string }> | undefined, types: string[]) {
  if (!actions) return 0;
  return actions.filter((a) => types.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
}
function normalizeActId(id: string) {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}
function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function ymdInTimeZone(d: Date, timeZone = "Asia/Almaty") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysYmd(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

function ymdToDmy(s: string) {
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}
function parseUsdFromXml(xml: string): number | null {
  const items = xml.split(/<item[\s>]/i).slice(1);
  for (const it of items) {
    const t = it.match(/<title>\s*([^<]+?)\s*<\/title>/i);
    const dsc = it.match(/<description>\s*([^<]+?)\s*<\/description>/i);
    if (t && dsc && t[1].trim().toUpperCase() === "USD") {
      const v = Number(dsc[1].replace(",", "."));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}
async function fetchNbkRate(date: string): Promise<number | null> {
  for (let i = 0; i < 8; i++) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    try {
      const r = await fetch(`https://nationalbank.kz/rss/get_rates.cfm?fdate=${ymdToDmy(dStr)}`);
      if (!r.ok) continue;
      const v = parseUsdFromXml(await r.text());
      if (v) return v;
    } catch (_) { /* next */ }
  }
  return null;
}
async function getRatesForDates(
  admin: ReturnType<typeof createClient>,
  dates: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (dates.length === 0) return map;
  const { data } = await admin.from("fx_rates").select("date, usd_kzt").in("date", dates);
  for (const r of (data ?? []) as Array<{ date: string; usd_kzt: number | string }>) {
    map.set(r.date, Number(r.usd_kzt));
  }
  for (const d of dates) {
    if (map.has(d)) continue;
    const rate = await fetchNbkRate(d);
    if (rate) {
      map.set(d, rate);
      await admin.from("fx_rates").upsert(
        { date: d, usd_kzt: rate, source: "nbk", fetched_at: new Date().toISOString() },
        { onConflict: "date" },
      );
    }
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminPre = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: Record<string, unknown> = {};
    if (req.method === "POST") body = await req.json().catch(() => ({}));

    if (body.list_ad_accounts === true) {
      const auth = await requireUser(req);
      if (!auth.ok) return auth.response;

      const excludeRaw: string[] = Array.isArray(body.exclude_act_ids)
        ? body.exclude_act_ids
        : [];
      const exclude = excludeRaw.map((x) => normalizeActIdList(String(x)));
      const token = await resolveMetaAccessToken(
        typeof body.access_token === "string" ? body.access_token : null,
      );
      if (!token) {
        return new Response(JSON.stringify({
          error: "Meta access token не настроен. Укажите токен в Настройках → Автоматизация.",
          accounts: [],
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const fetched = await fetchAllMetaAdAccounts(token);
      const accounts = mapAdAccounts(fetched.rows, exclude);
      return new Response(JSON.stringify({
        ok: true,
        accounts,
        meta_hint: fetched.meta_hint,
        token_identity: fetched.token_identity,
        sources: fetched.sources,
        raw_count: fetched.rows.length,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Allow internal cron call via shared secret OR require admin user JWT.
    // Поддерживаем оба варианта аутентификации:
    //   1) META_SYNC_CRON_KEY + x-cron-key — для отдельного ключа функции.
    //   2) automation_settings.cron_secret + x-automation-key — единый ключ для
    //      всех cron-задач (тот же, что использует crm-automations). Это решает
    //      401 при срабатывании cron meta-daily-sync-daily, когда отдельный
    //      env-secret не задан.
    let isCron = false;
    const envCronKey = Deno.env.get("META_SYNC_CRON_KEY");
    const envCronHeader = req.headers.get("x-cron-key");
    if (envCronKey && envCronHeader === envCronKey) {
      isCron = true;
    } else {
      const automationKey = req.headers.get("x-automation-key");
      if (automationKey) {
        const { data: settings } = await adminPre
          .from("automation_settings")
          .select("cron_secret")
          .eq("id", true)
          .maybeSingle();
        const dbSecret = (settings as { cron_secret?: string | null } | null)?.cron_secret ?? null;
        if (dbSecret && automationKey === dbSecret) isCron = true;
      }
    }
    if (!isCron) {
      const auth = await requireUser(req);
      if (!auth.ok) return auth.response;
      if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) {
        return new Response(JSON.stringify({
          error: "Синхронизация Meta доступна только admin или manager",
        }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    const admin = adminPre;
    // Токен резолвим ПО КАЖДОМУ кабинету (его OAuth-токен). Общий — только запасной
    // для ещё не переподключённых кабинетов; поэтому здесь не падаем, если его нет.
    const bodyToken = typeof body.access_token === "string" ? body.access_token : null;
    const fallbackToken = await resolveMetaAccessToken({ bodyToken, admin });

    // Токен ПРОЕКТА из meta_tokens — общий на все кабинеты проекта. Именно его
    // не хватало: раньше синк брал только токен кабинета + глобальный запасной,
    // из-за чего кабинет без своего токена не синкался, хотя на проекте токен есть.
    // Кэшируем по project_id, чтобы не дёргать БД на каждый кабинет.
    const projectTokenCache = new Map<string, string | null>();
    async function projectToken(projectId: string | null | undefined): Promise<string | null> {
      const key = projectId ?? "";
      if (!key) return null;
      if (projectTokenCache.has(key)) return projectTokenCache.get(key) ?? null;
      const t = await resolveMetaAccessToken({ projectId: key, admin });
      projectTokenCache.set(key, t);
      return t;
    }

    // Read params: date | since/until | cabinet_id (from query OR JSON body).
    // `body` уже распарсен выше (строка 151), здесь только новые поля.
    const url = new URL(req.url);
    const qpDate = url.searchParams.get("date") ?? (body.date as string | undefined) ?? null;
    const qpSince = url.searchParams.get("since") ?? (body.since as string | undefined) ?? null;
    const qpUntil = url.searchParams.get("until") ?? (body.until as string | undefined) ?? null;
    const qpCabinetId = url.searchParams.get("cabinet_id") ?? (body.cabinet_id as string | undefined) ?? null;

    const isYmd = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

    let since: string;
    let until: string;
    if (isYmd(qpSince) && isYmd(qpUntil)) {
      since = qpSince!;
      until = qpUntil!;
    } else if (isYmd(qpDate)) {
      since = qpDate!;
      until = qpDate!;
    } else {
      const yesterdayAlmaty = addDaysYmd(ymdInTimeZone(new Date(), "Asia/Almaty"), -1);
      since = until = yesterdayAlmaty;
    }
    if (since > until) [since, until] = [until, since];

    let cabQuery = admin
      .from("ad_cabinets")
      .select("id, external_id, ad_account_id, project_id, name, provider, access_token")
      .or("provider.eq.meta,provider.is.null");
    if (qpCabinetId) cabQuery = cabQuery.eq("id", qpCabinetId);
    const { data: cabinets, error: cabErr } = await cabQuery;
    if (cabErr) throw cabErr;

    const results: Array<Record<string, unknown>> = [];

    // Простой retry для транзитных ошибок Meta API: 3 попытки с экспоненциальным backoff.
    // Это закрывает основную причину "не всегда синхронизируется" — сеть/rate-limit.
    async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
      let lastErr: unknown = null;
      for (let i = 0; i < attempts; i++) {
        try {
          const r = await fetch(url);
          // Retry на 429 (rate limit) и 5xx (transient server errors). 4xx (кроме 429) — клиентская ошибка, не ретраим.
          if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429)) return r;
          lastErr = new Error(`HTTP ${r.status}`);
        } catch (e) {
          lastErr = e;
        }
        if (i < attempts - 1) await new Promise((res) => setTimeout(res, 500 * Math.pow(2, i)));
      }
      throw lastErr ?? new Error("fetch failed after retries");
    }

    for (const cab of cabinets ?? []) {
      const ext = String(
        (cab as { external_id?: string | null }).external_id
        ?? (cab as { ad_account_id?: string | null }).ad_account_id
        ?? "",
      ).trim();
      const cabName = (cab as { name?: string }).name ?? ext;
      if (!ext) {
        // Раньше тихо пропускали — теперь явно логируем, чтобы было видно неконфигурированные кабинеты.
        results.push({ cabinet_id: cab.id, cabinet: cabName, ok: false, error: "external_id (ad_account_id) не задан" });
        console.warn(`[meta-daily-sync] cabinet=${cab.id} skipped: external_id empty`);
        continue;
      }
      const actId = normalizeActId(ext);

      // Токены: OAuth-токен кабинета → токен ПРОЕКТА (meta_tokens) → глобальный запасной.
      // Перебор: первый реально отвечающий выигрывает. Токен кабинета необязателен —
      // одного подключения Facebook на проект достаточно для всех его кабинетов.
      const cabTok = String((cab as { access_token?: string | null }).access_token || "").trim();
      const projTok = await projectToken((cab as { project_id?: string | null }).project_id);
      const tokens = [...new Set([cabTok, projTok, fallbackToken].filter((t): t is string => !!t))];
      if (tokens.length === 0) {
        results.push({ cabinet_id: cab.id, cabinet: cabName, ok: false, error: "нет Meta-токена — подключите Facebook в проекте" });
        continue;
      }

      const fields = ["date_start", "spend", "impressions", "clicks", "actions", "action_values"].join(",");
      const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
      const insightsUrl = (tk: string) =>
        `https://graph.facebook.com/${META_API_VERSION}/${actId}/insights` +
        `?fields=${fields}&time_range=${timeRange}&time_increment=1&level=account&limit=500` +
        `&access_token=${encodeURIComponent(tk)}`;
      const currencyUrl = (tk: string) =>
        `https://graph.facebook.com/${META_API_VERSION}/${actId}` +
        `?fields=currency&access_token=${encodeURIComponent(tk)}`;

      try {
        // Перебираем токены на основном запросе — первый рабочий выигрывает.
        let iRes = await fetchWithRetry(insightsUrl(tokens[0]));
        let usedTok = tokens[0];
        for (let ti = 1; ti < tokens.length && !iRes.ok; ti++) {
          usedTok = tokens[ti];
          iRes = await fetchWithRetry(insightsUrl(usedTok));
        }
        const aRes = await fetchWithRetry(currencyUrl(usedTok));
        const iJson = await iRes.json();
        const aJson = await aRes.json().catch(() => ({}));
        if (!iRes.ok) {
          const errMsg = iJson?.error?.message ?? `HTTP ${iRes.status}`;
          results.push({ cabinet_id: cab.id, cabinet: cabName, ok: false, error: errMsg, code: iJson?.error?.code });
          console.error(`[meta-daily-sync] cabinet=${ext} meta error: ${errMsg}`);
          continue;
        }
        const accountCurrency: string = aJson?.currency ?? "USD";
        const rawRows = (iJson.data ?? []) as Array<Record<string, unknown>>;
        const dates = Array.from(new Set(
          rawRows.map((r) => String(r?.date_start ?? "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        ));
        const needConvert = accountCurrency !== "KZT";
        const ratesMap = needConvert ? await getRatesForDates(admin, dates) : new Map<string, number>();

        const rows: Array<Record<string, unknown>> = [];
        let totalSpend = 0, totalLeads = 0, totalClicks = 0, totalRevenue = 0;
        for (const row of rawRows) {
          const date = String(row?.date_start ?? "");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          let spend = Number(row?.spend ?? 0);
          const impressions = Number(row?.impressions ?? 0);
          const clicks = Number(row?.clicks ?? 0);
          // Лиды = заявки (форма/сайт/пиксель) + начатые переписки в мессенджерах.
          // Внутри каждой группы берём MAX, чтобы не задвоить (Meta дублирует одно и то же
          // событие под разными action_type), а между группами — суммируем.
          const formLeads = maxAction(row?.actions as any, LEAD_ACTIONS);
          const msgLeads = maxAction(row?.actions as any, MESSAGING_ACTIONS);
          const leads = formLeads + msgLeads;
          let revenue = sumActions(row?.action_values as any, PURCHASE_ACTIONS);
          let storedCurrency = accountCurrency;
          if (needConvert) {
            const rate = ratesMap.get(date);
            if (rate) {
              spend = spend * rate;
              revenue = revenue * rate;
              storedCurrency = "KZT";
            }
          }
          const cpl = leads > 0 ? spend / leads : 0;
          const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
          const cpc = clicks > 0 ? spend / clicks : 0;
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
          rows.push({
            cabinet_id: cab.id,
            external_id: actId,
            project_id: (cab as any).project_id ?? null,
            date,
            spend, impressions, clicks, leads, revenue,
            cpl, cpm, cpc, ctr,
            currency: storedCurrency,
            synced_at: new Date().toISOString(),
          });
          totalSpend += spend; totalLeads += leads; totalClicks += clicks; totalRevenue += revenue;
        }
        if (rows.length > 0) {
          const { error: upErr } = await admin
            .from("cabinet_daily_insights")
            .upsert(rows, { onConflict: "external_id,date" });
          if (upErr) {
            results.push({ cabinet_id: cab.id, cabinet: cabName, ok: false, error: upErr.message });
            console.error(`[meta-daily-sync] cabinet=${ext} upsert error: ${upErr.message}`);
            continue;
          }
        }
        results.push({
          cabinet_id: cab.id, cabinet: cabName, ok: true,
          since, until, days: rows.length,
          spend: totalSpend, leads: totalLeads, clicks: totalClicks, revenue: totalRevenue,
        });
        console.log(
          `[meta-daily-sync] cabinet=${ext} project=${(cab as any).project_id ?? "—"} ` +
          `range=${since}..${until} days=${rows.length} spend=${totalSpend.toFixed(2)} ` +
          `leads=${totalLeads} clicks=${totalClicks} revenue=${totalRevenue.toFixed(2)}`,
        );
      } catch (e) {
        results.push({ cabinet_id: cab.id, cabinet: cabName, ok: false, error: (e as Error).message });
        console.error(`[meta-daily-sync] cabinet=${ext} fatal:`, e);
      }
    }

    // Сводный summary в лог, чтобы было видно в supabase logs какие кабинеты упали.
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    console.log(`[meta-daily-sync] summary: ${okCount} ok, ${failCount} failed, range ${since}..${until}`);

    // Журналируем каждый прогон в ad_sync_runs (один INSERT на кабинет), чтобы UI
    // мог показать last_sync_status / последние ошибки без копания в edge logs.
    if (results.length > 0) {
      const logRows = results.map((r) => ({
        provider: "meta",
        cabinet_id: (r as { cabinet_id?: string }).cabinet_id ?? null,
        external_id: typeof (r as { cabinet?: string }).cabinet === "string"
          ? (r as { cabinet?: string }).cabinet
          : null,
        since,
        until,
        ok: !!(r as { ok?: boolean }).ok,
        days: Number((r as { days?: number }).days ?? 0),
        spend: Number((r as { spend?: number }).spend ?? 0),
        leads: Number((r as { leads?: number }).leads ?? 0),
        clicks: Number((r as { clicks?: number }).clicks ?? 0),
        revenue: Number((r as { revenue?: number }).revenue ?? 0),
        error: (r as { error?: string }).error ?? null,
        error_code: (r as { code?: string | number }).code != null ? String((r as { code?: string | number }).code) : null,
        triggered_by: isCron ? "cron" : "manual",
      }));
      // best-effort: если таблицы ещё нет — не валим всю синхронизацию.
      const { error: logErr } = await admin.from("ad_sync_runs").insert(logRows);
      if (logErr) console.warn(`[meta-daily-sync] ad_sync_runs insert failed: ${logErr.message}`);
    }

    return new Response(JSON.stringify({ since, until, count: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
