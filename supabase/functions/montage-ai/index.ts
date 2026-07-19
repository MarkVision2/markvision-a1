// AI-помощник монтаж-воркера: Deepgram-транскрипт + OpenAI-разметка.
// Auth: x-montage-key = montage_settings.worker_key (как у montage-worker).
//
// POST JSON { action, ... }:
//   bootstrap_env              → ключи для VPS (.env) — Deepgram/OpenAI/ElevenLabs
//   markup_delete              → delete.json из indexed/utterances + brief
//   markup_accents             → accents.json
//   markup_inserts             → inserts.json (motion b-roll по docs/motion-library.md)
//   markup_shorts              → shorts.json (отбор моментов)
//   markup_reels               → reels.json сцены
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { aiChatCompletion } from "../_lib/aiProvider.ts";

type Json = Record<string, unknown>;

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function chatJson(system: string, user: string, timeoutMs = 120_000): Promise<Json> {
  const data = await aiChatCompletion({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    responseFormat: { type: "json_object" },
    temperature: 0.3,
    openAiModel: "gpt-4o",
    lovableModel: "google/gemini-2.5-flash",
    timeoutMs,
  });
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI вернул пустой ответ");
  }
  return JSON.parse(content) as Json;
}

const MOTION_TEMPLATES = [
  "kinetic-type",
  "checklist-reveal",
  "number-counter",
  "stat-grid",
  "fake-terminal",
  "fake-dashboard-bars",
  "timeline-steps",
  "quote-card",
  "loading-to-done",
  "annotate-arrow-highlight",
  "vs-compare",
  "big-statement",
  "lower-third",
  "pill-row",
  "metric-callout",
  "phone-mockup",
  "chat-bubbles",
  "notification-toast",
  "rating-stars",
  "countdown",
  "gauge",
  "arrow-flow",
  "price-tag",
].join(", ");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: settings } = await admin
    .from("montage_settings")
    .select("worker_key")
    .eq("id", 1)
    .maybeSingle();
  const expected = settings?.worker_key as string | undefined;
  const provided = req.headers.get("x-montage-key");
  if (!expected || !provided || provided !== expected) {
    return json({ error: "forbidden" }, 403);
  }

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "bootstrap_env": {
        return json({
          DEEPGRAM_API_KEY: Deno.env.get("DEEPGRAM_API_KEY") ?? "",
          OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") ?? "",
          ELEVENLABS_API_KEY: Deno.env.get("ELEVENLABS_API_KEY") ?? "",
        });
      }

      case "markup_delete": {
        const indexed = String(body.indexed ?? "");
        const utterances = String(body.utterances ?? "");
        const brief = String(body.brief ?? "");
        if (!indexed) return json({ error: "indexed required" }, 400);
        const result = await chatJson(
          `Ты монтажёр русскоязычных «говорящих голов». Верни JSON:
{"delete":[{"from":<int>,"to":<int>,"reason":"..."}],"keep_full":false}
Индексы слов включительные из indexed.txt.
ЖЁСТКИЕ ПРАВИЛА (очередь Контент-завода):
- Режь ТОЛЬКО явные слова-паразиты (ну/типа/как бы/эээ), фальстарты из 1–3 слов и дословные дубли фраз.
- НЕ вырезай смысловые абзацы, паузы «для воздуха», вступления, концовки, оффтоп «чуть в сторону».
- Если сомневаешься — НЕ режь. Пустой delete допустим.
- Если brief явно просит «не резать / целиком / keep full» — верни {"delete":[],"keep_full":true}.`,
          `BRIEF:\n${brief || "(нет)"}\n\nUTTERANCES:\n${utterances.slice(0, 12000)}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
        );
        return json(result);
      }

      case "markup_accents": {
        const indexed = String(body.indexed ?? "");
        const brief = String(body.brief ?? "");
        if (!indexed) return json({ error: "indexed required" }, 400);
        const result = await chatJson(
          `Ты монтажёр. Верни JSON {"accents":[{"word":<индекс>,"text":"ТЕКСТ КАПСОМ"}]}.
Плотность: МИНИМУМ 1 акцент на каждые 6–8 секунд речи (цифры, ключевые слова, панчи, CTA).
word = индекс из indexed. text — короткий капс (1–3 слова, можно → ₸/$/%). Не дублируй соседние.`,
          `BRIEF:\n${brief || "(нет)"}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
        );
        return json(result);
      }

      case "markup_inserts": {
        const indexed = String(body.indexed ?? "");
        const utterances = String(body.utterances ?? "");
        const brief = String(body.brief ?? "");
        const durationSec = Number(body.durationSec ?? 0);
        if (!indexed) return json({ error: "indexed required" }, 400);
        const target = durationSec > 0
          ? Math.max(6, Math.min(24, Math.round(durationSec / 12)))
          : 10;
        const result = await chatJson(
          `Ты режиссёр motion-графики поверх «говорящей головы». Верни JSON:
{"inserts":[{"anchorWord":<i>,"endWord":<i>,"template":"<slug>","data":{...},"note":"..."}]}
Это code-based b-roll (НЕ картинки). template — ТОЛЬКО: ${MOTION_TEMPLATES}.
Правила:
- Сделай примерно ${target} вставок (плотность ~1 на 10–15 сек), равномерно по ролику.
- Подбирай шаблон ПО СМЫСЛУ фразы (цифры→number-counter/metric-callout; списки→checklist-reveal;
  процесс→timeline-steps/arrow-flow; оффер→price-tag/big-statement; ИИ/код→fake-terminal/chat-bubbles).
- Не повторяй один template подряд. Чередуй цвета accent: #FF7A18 #22D3EE #8B5CF6 #34D399 #FFC53D #FB7185 #38BDF8.
- ~половину вставок с data.cover=true (полный экран на премиум-фоне), остальные — оверлей.
- data обязателен и заполнен под шаблон (см. поля value/label/items/words/steps/lines/…).
- anchorWord/endWord — индексы из indexed, endWord > anchorWord, окно 2–6 сек речи.
- Учитывай brief.`,
          `DURATION_SEC=${durationSec || "?"}\nBRIEF:\n${brief || "(нет)"}\n\nUTTERANCES:\n${utterances.slice(0, 12000)}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
          150_000,
        );
        if (!Array.isArray(result.inserts)) result.inserts = [];
        return json(result);
      }

      case "markup_shorts": {
        const indexed = String(body.indexed ?? "");
        const utterances = String(body.utterances ?? "");
        const words = body.words;
        const brief = String(body.brief ?? "");
        const count = Math.max(1, Math.min(5, Number(body.count) || 3));
        const media = String(body.media ?? "source");
        if (!indexed || !Array.isArray(words)) {
          return json({ error: "indexed and words required" }, 400);
        }
        const durationSec = Number(
          (words as { end?: number }[])[(words as unknown[]).length - 1]?.end ?? 0,
        );
        const result = await chatJson(
          `Ты отбираешь вертикальные шортсы из «говорящей головы». Верни JSON:
{"shorts":[{"id":"Short-<slug>","title":"...","spans":[[startSec,endSec],...],"accents":[<wordIndex>],"fixes":{},"captionStyle":"pill"}]}
Правила:
- ОБЯЗАТЕЛЬНО ровно ${count} шортс(ов) в массиве shorts (не меньше и не больше), каждый 15–45 сек суммарно по spans;
- spans — куски исходника в секундах (0..${durationSec.toFixed(1)}); НЕ бери одним сплошным куском:
  выбрасывай слабые фразы, фальстарты и воду — обычно 2–5 spans на шортс (джамп-каты);
- id только a-zA-Z0-9-, начинается с Short-;
- accents — индексы слов из indexed для punch-зумов и караоке: МИНИМУМ 1 акцент на каждые 4–5 секунд
  (цифры, ключевые слова, панчи) — без них видео выглядит статичным;
- fixes — опциональные правки ASR { "123": "текст" };
- бери хуки, цифры, панчи; учитывай brief.`,
          `MEDIA=${media}\nBRIEF:\n${brief || "(нет)"}\n\nUTTERANCES:\n${utterances.slice(0, 12000)}\n\nINDEXED:\n${indexed.slice(0, 35000)}`,
          150_000,
        );
        if (!Array.isArray(result.shorts)) result.shorts = [];
        result.media = media;
        return json(result);
      }

      case "markup_reels": {
        const indexed = String(body.indexed ?? "");
        const transcript = String(body.transcript ?? "");
        const brief = String(body.brief ?? "");
        if (!indexed) return json({ error: "indexed required" }, 400);
        const result = await chatJson(
          `Ты режиссёр faceless Reels. Верни JSON:
{"theme":"<slug>","scenes":[{"anchorWord":<i>,"endWord":<i>,"template":"<slug>","data":{...}}],"accents":[<i>],"fixes":{}}
theme — ОБЯЗАТЕЛЬНО один из: midnight-orange, neon-violet, ocean-cyan, ember-red,
mint-fresh, gold-noir, paper-ink, aurora-green. Выбирай по настроению текста
(энергия/деньги → gold-noir или ember-red; спокойный эксперт → ocean-cyan или mint-fresh;
провокация → neon-violet; светлый бренд → paper-ink).
Сцены непрерывны по словам (без дыр). template — ТОЛЬКО из списка:
number-counter, vs-compare, checklist-reveal, fake-terminal, fake-dashboard-bars,
kinetic-type, annotate-arrow-highlight, loading-to-done, stat-grid, timeline-steps,
quote-card, big-statement, lower-third, pill-row, metric-callout, phone-mockup,
chat-bubbles, notification-toast, rating-stars, countdown, gauge, arrow-flow, price-tag.
data — поля шаблона (price/label/value/items/lines/steps/accent="#hex"/cover/caption).
Чередуй шаблоны. Цвета accent в data — РАЗНЫЕ между соседними сценами, но в одной
гамме с выбранной theme. На ключевых цифрах — accents.`,
          `BRIEF:\n${brief || "(нет)"}\n\nTRANSCRIPT:\n${transcript.slice(0, 8000)}\n\nINDEXED:\n${indexed.slice(0, 35000)}`,
          150_000,
        );
        return json(result);
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("montage-ai error", e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
