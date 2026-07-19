import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser, AUTH_CORS_HEADERS } from "../_lib/auth.ts";
import { aiChatCompletion, hasAiProvider, aiModelName } from "../_lib/aiProvider.ts";

const corsHeaders = {
  ...AUTH_CORS_HEADERS,
  "Access-Control-Allow-Headers":
    `${AUTH_CORS_HEADERS["Access-Control-Allow-Headers"]}, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version`,
};

const MAX_IMAGES = 8;
const MAX_DATA_URL_CHARS = 1_400_000; // ~1MB each after base64

type MediaKind = "CAROUSEL" | "REELS" | "IMAGE" | "STORIES";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (!hasAiProvider()) {
      return new Response(
        JSON.stringify({ error: "AI не настроен (нужен OPENAI_API_KEY или LOVABLE_API_KEY)" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const mediaType = (["CAROUSEL", "REELS", "IMAGE", "STORIES"].includes(body.mediaType)
      ? body.mediaType
      : "IMAGE") as MediaKind;
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const imagesRaw = Array.isArray(body.images) ? body.images : [];
    const images = imagesRaw
      .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("data:image/"))
      .slice(0, MAX_IMAGES)
      .filter((u: string) => u.length <= MAX_DATA_URL_CHARS);

    if (images.length === 0) {
      return new Response(JSON.stringify({ error: "Нет изображений для анализа" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const userParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [
      {
        type: "text",
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
      .trim();

    if (!caption) {
      return new Response(JSON.stringify({ error: "Модель не вернула описание" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        caption: caption.slice(0, 2200),
        model: aiModelName("google/gemini-2.5-flash", "gpt-4o-mini"),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка генерации";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
