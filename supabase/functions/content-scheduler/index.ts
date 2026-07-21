// API планировщика автопостинга v5: CRUD cf_scheduled_posts + publish_now + stats + cover_url для Reels.
// verify_jwt=false, защита заголовком x-app-key == cf_settings.client_pub_key.
//
// project_id (опционально): очередь постов теперь может быть привязана к
// проекту CRM — publisher публикует такие посты через Instagram-аккаунт
// именно этого проекта (instagram_accounts), а не через один глобальный
// аккаунт из cf_settings. Записи без project_id — легаси, как раньше.
import { aiChatCompletion, hasAiProvider, aiModelName } from "../_lib/aiProvider.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-key",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> || {}) } });
  const t = await r.text();
  let body: unknown = null;
  try { body = t ? JSON.parse(t) : null; } catch { body = t; }
  return { ok: r.ok, status: r.status, body };
}
async function setting(k: string) { return ((await db(`cf_settings?key=eq.${k}&select=value`)).body as { value: string }[] | null)?.[0]?.value; }

const TYPES = ["IMAGE", "REELS", "STORIES", "CAROUSEL"];
const MAX_CAPTION_IMAGES = 8;
const MAX_DATA_URL_CHARS = 1_400_000;

async function generateIgCaption(b: Record<string, unknown>) {
  if (!hasAiProvider()) {
    return json({ ok: false, error: "AI не настроен (OPENAI_API_KEY или LOVABLE_API_KEY)" }, 503);
  }
  const mediaType = (TYPES.includes(String(b.media_type ?? "").toUpperCase())
    ? String(b.media_type).toUpperCase()
    : "IMAGE");
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
  const images = (Array.isArray(b.images) ? b.images : [])
    .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("data:image/"))
    .slice(0, MAX_CAPTION_IMAGES)
    .filter((u) => u.length <= MAX_DATA_URL_CHARS);
  if (!images.length) return json({ ok: false, error: "Нет изображений для анализа" }, 400);

  const kindHint =
    mediaType === "CAROUSEL"
      ? "Это карусель Instagram: несколько слайдов с текстом/иконками."
      : mediaType === "REELS"
        ? "Это кадр из Reels-видео."
        : "Это изображение для поста Instagram.";

  const systemPrompt =
    `Ты — SMM-редактор Instagram в Казахстане. Пишешь короткие подписи к постам на русском. ` +
    `Сначала прочитай весь текст на картинках (OCR), затем сделай живую подпись. ` +
    `Правила: 2–5 коротких предложений или абзацев; без воды и клише; можно 1 эмодзи; ` +
    `в конце 3–6 релевантных хэштегов через пробел; без кавычек вокруг всего текста; ` +
    `не выдумывай факты, которых нет на слайдах; CTA мягкий, если уместен.`;

  const userParts = [
    {
      type: "text" as const,
      text:
        `${kindHint}\n` +
        (title ? `Рабочий заголовок автора: «${title}».\n` : "") +
        `Слайдов/кадров: ${images.length}.\n` +
        `Прочитай текст на изображениях и напиши короткую подпись для публикации в Instagram. ` +
        `Верни только текст подписи, без пояснений.`,
    },
    ...images.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "low" as const },
    })),
  ];

  const data = await aiChatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userParts },
    ],
    temperature: 0.55,
    openAiModel: "gpt-4o-mini",
    lovableModel: "google/gemini-2.5-flash",
    timeoutMs: 90_000,
  });

  const caption = String(data?.choices?.[0]?.message?.content ?? "")
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/, "")
    .trim()
    .slice(0, 2200);
  if (!caption) return json({ ok: false, error: "Модель не вернула описание" }, 502);
  return json({
    ok: true,
    caption,
    model: aiModelName("google/gemini-2.5-flash", "gpt-4o-mini"),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const appKey = req.headers.get("x-app-key") ?? "";
  const expected = await setting("client_pub_key");
  if (!expected || appKey !== expected) return json({ ok: false, error: "forbidden" }, 403);

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(b.action ?? "list");
  const projectId = typeof b.project_id === "string" && b.project_id ? b.project_id : null;

  if (action === "ai_caption") {
    try {
      return await generateIgCaption(b);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : "Ошибка генерации" }, 500);
    }
  }

  if (action === "list") {
    const filter = projectId
      ? `&or=(project_id.eq.${projectId},project_id.is.null)`
      : "";
    const { body } = await db(`cf_scheduled_posts?select=*${filter}&order=scheduled_at.desc&limit=200`);
    return json({ ok: true, posts: body ?? [] });
  }

  if (action === "stats") {
    const from = String(b.from ?? ""), to = String(b.to ?? "");
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(from) || !re.test(to)) return json({ ok: false, error: "bad period" }, 400);
    const r = await fetch(`${SB_URL}/rest/v1/rpc/cf_autopost_stats`, { method: "POST", headers: { ...H }, body: JSON.stringify({ p_from: from, p_to: to, p_project_id: projectId }) });
    const t = await r.text();
    let data: unknown = null; try { data = t ? JSON.parse(t) : null; } catch { /* */ }
    if (!r.ok) return json({ ok: false, error: "rpc", detail: t }, 500);
    return json({ ok: true, stats: data });
  }

  if (action === "create") {
    const media_type = String(b.media_type ?? "IMAGE").toUpperCase();
    if (!TYPES.includes(media_type)) return json({ ok: false, error: "bad media_type" }, 400);
    const caption = typeof b.caption === "string" ? b.caption : "";
    const scheduled_at = b.scheduled_at ? new Date(String(b.scheduled_at)).toISOString() : null;
    if (!scheduled_at || isNaN(Date.parse(scheduled_at))) return json({ ok: false, error: "bad scheduled_at" }, 400);
    if (caption.length > 2200) return json({ ok: false, error: "caption > 2200" }, 400);

    const buildRow = (storedType: string) => {
      const row: Record<string, unknown> = {
        media_type: storedType,
        caption,
        scheduled_at,
        status: "queued",
        dry_run: b.dry_run === true,
        project_id: projectId,
      };
      if (media_type === "CAROUSEL") {
        const urls = Array.isArray(b.child_urls) ? (b.child_urls as string[]).filter((u) => typeof u === "string" && u) : [];
        if (urls.length < 2 || urls.length > 10) return { error: "карусель: 2–10 элементов" as const };
        row.child_urls = urls;
        row.media_url = urls[0];
        row.thumbnail_url = b.thumbnail_url ?? urls[0];
      } else {
        if (!b.media_url || typeof b.media_url !== "string") return { error: "media_url обязателен" as const };
        row.media_url = b.media_url;
        if (media_type === "REELS" && typeof b.cover_url === "string" && b.cover_url) {
          row.cover_url = b.cover_url;
          row.thumbnail_url = b.cover_url;
        } else {
          row.thumbnail_url = b.thumbnail_url ?? (media_type === "IMAGE" ? b.media_url : null);
        }
        if (media_type === "REELS" && b.thumb_offset_ms != null && Number.isFinite(Number(b.thumb_offset_ms))) {
          row.thumb_offset_ms = Math.max(0, Math.round(Number(b.thumb_offset_ms)));
        }
      }
      return { row };
    };

    const primary = buildRow(media_type);
    if ("error" in primary) return json({ ok: false, error: primary.error }, 400);

    let { ok, body, status } = await db(`cf_scheduled_posts`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(primary.row),
    });

    // Prod check constraint historically allowed only IMAGE/REELS. Until migration
    // lands, persist carousel as IMAGE + child_urls (publisher detects by child_urls).
    const failMsg = typeof body === "object" && body && "message" in (body as object)
      ? String((body as { message?: string }).message ?? "")
      : "";
    if (!ok && media_type === "CAROUSEL" && /media_type_check/i.test(failMsg)) {
      const fallback = buildRow("IMAGE");
      if ("row" in fallback) {
        const retry = await db(`cf_scheduled_posts`, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(fallback.row),
        });
        ok = retry.ok;
        body = retry.body;
        status = retry.status;
      }
    }

    if (!ok) {
      if (/media_type_check/i.test(failMsg)) {
        return json({
          ok: false,
          error: "Тип публикации не разрешён в базе (нужен CAROUSEL/STORIES в check constraint)",
          detail: body,
        }, status);
      }
      return json({ ok: false, error: failMsg || "db", detail: body }, status);
    }
    return json({ ok: true, post: Array.isArray(body) ? body[0] : body });
  }

  if (action === "update") {
    const id = String(b.id ?? "");
    if (!id) return json({ ok: false, error: "id" }, 400);
    const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.caption === "string") upd.caption = b.caption;
    if (b.scheduled_at) {
      const iso = new Date(String(b.scheduled_at)).toISOString();
      if (isNaN(Date.parse(iso))) return json({ ok: false, error: "bad scheduled_at" }, 400);
      upd.scheduled_at = iso;
    }
    if (typeof b.cover_url === "string") { upd.cover_url = b.cover_url; upd.thumbnail_url = b.cover_url; }
    if (b.thumb_offset_ms != null && Number.isFinite(Number(b.thumb_offset_ms))) {
      upd.thumb_offset_ms = Math.max(0, Math.round(Number(b.thumb_offset_ms)));
    }
    if (typeof b.dry_run === "boolean") upd.dry_run = b.dry_run;
    if (projectId) upd.project_id = projectId;
    const { ok, body } = await db(`cf_scheduled_posts?id=eq.${id}&status=in.(queued,failed,tested)`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(upd) });
    if (!ok) return json({ ok: false, error: "db", detail: body }, 400);
    return json({ ok: true, post: Array.isArray(body) ? body[0] : body });
  }

  if (action === "publish_now") {
    const id = String(b.id ?? "");
    if (!id) return json({ ok: false, error: "id" }, 400);
    const patchRow: Record<string, unknown> = {
      scheduled_at: new Date().toISOString(),
      status: "queued",
      dry_run: false,
      container_id: null,
      published_ig_media_id: null,
      error: null,
      updated_at: new Date().toISOString(),
    };
    if (projectId) patchRow.project_id = projectId;
    await db(`cf_scheduled_posts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patchRow) });
    const secret = await setting("cron_secret");
    let result: unknown = null;
    try { result = await (await fetch(`${SB_URL}/functions/v1/publisher?key=${secret}`)).json(); } catch { /* крон подхватит */ }
    return json({ ok: true, result });
  }

  if (action === "retry") {
    const id = String(b.id ?? "");
    if (!id) return json({ ok: false, error: "id" }, 400);
    const patchRow: Record<string, unknown> = {
      status: "queued",
      error: null,
      container_id: null,
      updated_at: new Date().toISOString(),
    };
    if (projectId) patchRow.project_id = projectId;
    await db(`cf_scheduled_posts?id=eq.${id}&status=in.(failed,tested)`, { method: "PATCH", body: JSON.stringify(patchRow) });
    return json({ ok: true });
  }

  if (action === "delete") {
    const id = String(b.id ?? "");
    if (!id) return json({ ok: false, error: "id" }, 400);
    await db(`cf_scheduled_posts?id=eq.${id}`, { method: "DELETE" });
    return json({ ok: true });
  }

  // Удалить всё, что не опубликовано (failed / queued / processing / tested) —
  // например после смены Instagram-аккаунта, когда старые посты уже не выйдут.
  if (action === "clear_stuck") {
    const mode = String(b.mode ?? "unpublished");
    const statuses = mode === "failed_only" ? ["failed"] : ["failed", "queued", "processing", "tested"];
    let path = `cf_scheduled_posts?status=in.(${statuses.join(",")})`;
    const includeLegacy = b.include_legacy !== false;
    if (projectId) {
      path += includeLegacy
        ? `&or=(project_id.eq.${projectId},project_id.is.null)`
        : `&project_id=eq.${projectId}`;
    }
    const { ok, body, status } = await db(path, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    if (!ok) return json({ ok: false, error: "db", detail: body }, status);
    const deleted = Array.isArray(body) ? body.length : 0;
    return json({ ok: true, deleted });
  }

  return json({ ok: false, error: "unknown action" }, 400);
});
