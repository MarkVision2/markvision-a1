#!/usr/bin/env node
/**
 * Контент-конвейер: проверка готовности и боевой smoke test (Этап 0 ТЗ).
 *
 *   node scripts/content-pipeline-smoke.mjs doctor --key <automation_settings.cron_secret> [--worker-url http://172.18.0.1:9120]
 *       Ничего не меняет и не тратит: edge-функции (content-pipeline, radar, publish-*) задеплоены,
 *       миграции применены (maintenance отвечает), очередь/зависшие, воркер жив, n8n отвечает.
 *
 *   node scripts/content-pipeline-smoke.mjs e2e --jwt <access_token> --project <uuid> \
 *        [--title "Тема"] [--description "..."] [--decision approved|rejected --comment "..."] [--timeout-min 30]
 *       ПЛАТНЫЙ полный проход: создаёт тему → generate → следит за этапами до
 *       awaiting_review → (опционально) принимает решение. Печатает время каждого
 *       этапа и стоимость. JWT — access_token пользователя MarkVision (DevTools →
 *       Application → Local Storage → sb-…-auth-token → access_token).
 *
 * Переменные окружения: SUPABASE_URL (по умолчанию прод), AUTOMATION_KEY, USER_JWT.
 */

const SB = (process.env.SUPABASE_URL || "https://szfgdruhlebfvcmlvxdk.supabase.co").replace(/\/$/, "");
const FN = `${SB}/functions/v1/content-pipeline`;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const mode = process.argv[2] || "doctor";
const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const info = (s) => `\x1b[36m•\x1b[0m ${s}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, { method = "GET", headers = {}, body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e?.message ?? e) };
  }
}

/* ───────────────────────────── doctor ───────────────────────────── */

async function doctor() {
  const key = arg("key") || process.env.AUTOMATION_KEY || "";
  let failures = 0;

  const ping = await req(FN);
  if (ping.status === 200 && ping.json?.service === "content-pipeline") console.log(ok("edge-функция content-pipeline задеплоена"));
  else { console.log(bad(`content-pipeline не отвечает (HTTP ${ping.status}): ${ping.text.slice(0, 120)}`)); failures++; }

  if (!key) {
    console.log(info("ключ автоматизации не передан (--key) — проверка миграции и очереди пропущена"));
  } else {
    const m = await req(`${FN}/maintenance`, { method: "POST", headers: { "x-automation-key": key }, body: { source: "doctor" } });
    if (m.status === 200 && m.json?.ok) {
      console.log(ok(`миграция применена, maintenance работает: зависших возвращено ${m.json.requeued}, уведомлений ${m.json.notified}, алертов очереди ${m.json.stuck_alerts}`));
    } else if (m.status === 401 || m.status === 403) {
      console.log(bad("ключ автоматизации не принят (automation_settings.cron_secret)")); failures++;
    } else {
      console.log(bad(`maintenance: HTTP ${m.status} ${m.text.slice(0, 200)} — вероятно, миграция 20260904120000 не применена`)); failures++;
    }
  }

  // Платформа автопостинга: радар и сбор метрик публикаций задеплоены?
  for (const fn of ["radar", "publish-metrics", "publish-accounts", "publish-worker", "publish-oauth"]) {
    const r = await req(`${SB}/functions/v1/${fn}`, { method: "POST", body: {} });
    if (r.status === 404 && /not found/i.test(r.text)) { console.log(bad(`edge-функция ${fn} не задеплоена`)); failures++; }
    else console.log(ok(`edge-функция ${fn} отвечает (HTTP ${r.status})`));
  }
  if (key) {
    const rm = await req(`${SB}/functions/v1/radar/maintenance`, { method: "POST", headers: { "x-automation-key": key }, body: { source: "doctor" } });
    if (rm.status === 200 && rm.json?.ok) console.log(ok(`радар: разобрано ${rm.json.analyzed}, идей ${rm.json.ideas}, источников к сбору ${rm.json.crawl_kicked}, AI-провайдер ${rm.json.ai ? "есть" : "НЕТ"}`));
    else if (rm.status !== 401 && rm.status !== 403) { console.log(bad(`radar/maintenance: HTTP ${rm.status} ${rm.text.slice(0, 160)} — миграция 20260905100000 не применена?`)); failures++; }
    const pm = await req(`${SB}/functions/v1/publish-metrics`, { method: "POST", headers: { "x-automation-key": key }, body: { limit: 1 } });
    if (pm.status === 200 && pm.json?.ok) {
      console.log(ok(`метрики публикаций: due ${pm.json.due}, собрано ${pm.json.collected}, в радар своих ${pm.json.own_posts_fed ?? 0}`));
      // Причины отказов (нет права video.list, протухший токен) — сразу видно, кого переподключать.
      for (const [reason, n] of Object.entries(pm.json.reasons ?? {})) console.log(info(`  не собрано ×${n}: ${reason}`));
    }
    else if (pm.status !== 401 && pm.status !== 403) { console.log(bad(`publish-metrics: HTTP ${pm.status} ${pm.text.slice(0, 160)} — миграция 20260905110000 не применена?`)); failures++; }
  }

  const workerUrl = arg("worker-url") || process.env.WORKER_URL;
  if (workerUrl) {
    const h = await req(`${workerUrl.replace(/\/$/, "")}/health`);
    if (h.status === 200 && h.json?.ok) {
      const d = h.json.disk || {};
      console.log(ok(`FFmpeg-worker жив: ffmpeg=${h.json.ffmpeg} ffprobe=${h.json.ffprobe} диск ${d.used_pct ?? "?"}% (${d.level ?? "?"})`));
      if (d.level && d.level !== "ok") console.log(bad(`диск воркера: ${d.level} (${d.used_pct}%)`));
    } else { console.log(bad(`FFmpeg-worker: HTTP ${h.status} ${h.text.slice(0, 200)}`)); failures++; }
  } else {
    console.log(info("--worker-url не передан — воркер не проверялся (доступен только из приватной сети сервера)"));
  }

  const n8n = arg("n8n-url") || process.env.N8N_URL || "https://n8n.zapoinov.com";
  const hz = await req(`${n8n.replace(/\/$/, "")}/healthz`);
  if (hz.status === 200) console.log(ok("n8n отвечает (healthz)"));
  else { console.log(bad(`n8n healthz: HTTP ${hz.status}`)); failures++; }

  console.log(failures ? `\n${failures} проблем(ы)` : "\nВсё готово к smoke test: node scripts/content-pipeline-smoke.mjs e2e --jwt … --project …");
  process.exit(failures ? 1 : 0);
}

/* ───────────────────────────── e2e ───────────────────────────── */

async function e2e() {
  const jwt = arg("jwt") || process.env.USER_JWT || "";
  const project = arg("project");
  if (!jwt || !project) {
    console.error("нужны --jwt <access_token> и --project <uuid>");
    process.exit(2);
  }
  const auth = { Authorization: `Bearer ${jwt}` };
  const timeoutMin = Number(arg("timeout-min", 30));
  const title = arg("title", `Smoke test ${new Date().toISOString().slice(0, 16)}`);
  const description = arg("description", "Тестовая тема для проверки конвейера: одна мысль, без цен и обещаний.");

  const created = await req(`${FN}/items`, { method: "POST", headers: auth, body: { project_id: project, title, description, category: "content" } });
  if (created.status !== 201) { console.log(bad(`создание темы: HTTP ${created.status} ${created.text.slice(0, 300)}`)); process.exit(1); }
  const itemId = created.json.item.id;
  console.log(ok(`тема создана: ${itemId} (status=${created.json.item.status})`));

  const gen = await req(`${FN}/items/${itemId}/generate`, { method: "POST", headers: auth, body: {} });
  if (gen.status !== 200) { console.log(bad(`generate: HTTP ${gen.status} ${gen.text.slice(0, 300)}`)); process.exit(1); }
  console.log(ok(`generate: queued=${gen.json.queued} kicked=${gen.json.kicked}${gen.json.kicked ? "" : " (n8n не пнули — ждём расписание/ручной запуск)"}`));

  const t0 = Date.now();
  let lastState = null;
  let detail = null;
  while (Date.now() - t0 < timeoutMin * 60_000) {
    const d = await req(`${FN}/items/${itemId}`, { headers: auth });
    if (d.status !== 200) { console.log(bad(`GET item: HTTP ${d.status}`)); await sleep(15_000); continue; }
    detail = d.json;
    const run = detail.current_run;
    const state = run?.state ?? "(нет запуска)";
    if (state !== lastState) {
      console.log(info(`${Math.round((Date.now() - t0) / 1000)} с: ${state}${run ? ` (попытка ${run.attempt}, $${Number(run.cost_usd).toFixed(3)})` : ""}${run?.error_user ? ` — ${run.error_user}` : ""}`));
      lastState = state;
    }
    if (state === "awaiting_review" || state === "failed" || state === "cancelled") break;
    await sleep(15_000);
  }

  if (!detail?.current_run) { console.log(bad("запуск так и не появился — проверьте n8n и расписание")); process.exit(1); }
  const run = detail.current_run;
  console.log("\nЭтапы:");
  const events = run.events || [];
  for (let i = 1; i < events.length; i++) {
    const sec = Math.round((Date.parse(events[i].created_at) - Date.parse(events[i - 1].created_at)) / 1000);
    console.log(`  ${events[i - 1].to_state.padEnd(18)} ${String(sec).padStart(5)} с`);
  }
  console.log(`  итого ${Math.round((Date.now() - t0) / 1000)} с, стоимость $${Number(run.cost_usd).toFixed(4)}`);
  if (detail.script) console.log(`\nСценарий (${detail.script.script.split(/\s+/).length} слов): «${detail.script.title}»\n${detail.script.script}\n`);
  const video = detail.assets.find((a) => a.asset_type === "normalized_video");
  if (video) {
    console.log(ok(`видео: ${video.public_url} ${video.width}x${video.height} ${video.video_codec}/${video.audio_codec} ${video.duration_seconds}s ${video.size_bytes} байт`));
    const head = await fetch(video.public_url, { method: "HEAD" }).catch(() => null);
    console.log(head?.ok ? ok(`ссылка открывается (HTTP ${head.status})`) : bad(`ссылка не открывается: HTTP ${head?.status ?? 0}`));
  }

  if (run.state !== "awaiting_review") { console.log(bad(`конечное состояние: ${run.state}`)); process.exit(1); }
  console.log(ok("ролик ждёт согласования (в Telegram должно прийти одно сообщение с кнопками)"));

  const decision = arg("decision");
  if (decision) {
    const r = await req(`${FN}/items/${itemId}/review`, { method: "POST", headers: auth, body: { decision, comment: arg("comment") } });
    if (r.status === 200) console.log(ok(`решение «${decision}» записано: run ${r.json.current_run?.state}, тема ${r.json.item.status}`));
    else { console.log(bad(`review: HTTP ${r.status} ${r.text.slice(0, 200)}`)); process.exit(1); }
    // Повторное решение должно быть отвергнуто (ТЗ 7.6 / сценарий 12).
    const again = await req(`${FN}/items/${itemId}/review`, { method: "POST", headers: auth, body: { decision, comment: arg("comment") } });
    console.log(again.status === 409 ? ok("повторное решение отвергнуто (409)") : bad(`повторное решение: HTTP ${again.status}`));
  }
}

if (mode === "doctor") doctor();
else if (mode === "e2e") e2e();
else { console.error("режимы: doctor | e2e"); process.exit(2); }
