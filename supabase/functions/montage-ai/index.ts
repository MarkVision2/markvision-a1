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

const HOOK_INSERT_TEMPLATES = new Set(["kinetic-type", "big-statement", "quote-card"]);

/** Earliest insert must be a short hook motion (not video / not soft open). */
function ensureHookFirstInsert(inserts: Json[]): Json[] {
  if (!Array.isArray(inserts) || inserts.length === 0) return inserts;
  const sorted = [...inserts].sort(
    (a, b) => Number(a.anchorWord ?? 0) - Number(b.anchorWord ?? 0),
  );
  const first = sorted[0];
  const firstTpl = String(first.template || "");
  if (firstTpl && HOOK_INSERT_TEMPLATES.has(firstTpl) && !first.prompt && !first.query) {
    const data = { ...((first.data as Json) || {}), cover: true };
    sorted[0] = { ...first, layout: "full", data };
    return sorted;
  }
  const hookIdx = sorted.findIndex(
    (it) => it.template && HOOK_INSERT_TEMPLATES.has(String(it.template)),
  );
  const a0 = Number(first.anchorWord ?? 0);
  const e0 = Math.max(a0 + 1, Number(first.endWord ?? a0 + 3));
  if (hookIdx > 0) {
    const hook = sorted[hookIdx];
    sorted[hookIdx] = { ...first };
    sorted[0] = {
      ...hook,
      anchorWord: a0,
      endWord: Math.min(e0, a0 + 8),
      layout: "full",
      data: { ...((hook.data as Json) || {}), cover: true },
    };
    delete (sorted[0] as Json).prompt;
    delete (sorted[0] as Json).query;
    return sorted.sort((a, b) => Number(a.anchorWord ?? 0) - Number(b.anchorWord ?? 0));
  }
  const note = String(first.note || first.spokenText || "СМОТРИ");
  const punch = note.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w.toUpperCase());
  sorted[0] = {
    anchorWord: a0,
    endWord: Math.min(e0, a0 + 8),
    template: "kinetic-type",
    layout: "full",
    data: { words: punch.length ? punch : ["СМОТРИ"], cover: true, accent: "#EF4444" },
    note: first.note || note,
    spokenText: first.spokenText || note,
  };
  return sorted;
}

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
        const accentEverySec = Number(body.accentEverySec ?? 4);
        if (!indexed) return json({ error: "indexed required" }, 400);
        const result = await chatJson(
          `Ты монтажёр. Верни JSON {"accents":[{"word":<индекс>,"text":"ТЕКСТ КАПСОМ"}]}.
Плотность: 1 акцент на каждые ${Math.max(3, Math.min(12, accentEverySec))} секунд речи (цифры, ключевые слова, панчи, CTA, вопросы).
На КАЖДОЕ смысловое предложение — хотя бы один акцент на главном слове.
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
        const brollMode = String(body.brollMode ?? "auto");
        const insertEverySec = Number(body.insertEverySec ?? 4);
        const coverRatio = Number(body.coverRatio ?? 0.45);
        const accentColor = String(body.accentColor ?? "#F5E14B");
        const styleId = String(body.styleId ?? "expert-explainer");
        if (!indexed) return json({ error: "indexed required" }, 400);
        const every = Math.max(3, Math.min(14, insertEverySec || 4));
        const target = durationSec > 0
          ? Math.max(8, Math.min(56, Math.round(durationSec / every)))
          : 14;
        const coverPct = Math.round(Math.max(0.1, Math.min(0.7, coverRatio)) * 100);

        // Kie / Pexels — видео-клипы + Remotion motion-дизайн (не только сток).
        if (brollMode === "kie" || brollMode === "pexels") {
          const kind = brollMode === "kie" ? "Kie/Kling" : "Pexels";
          // Kie платный (~$0.28 / 5с) — макс 3 клипа; Pexels — до 6.
          const videoTarget = brollMode === "kie"
            ? Math.max(2, Math.min(3, Math.round(target / 4)))
            : Math.max(3, Math.min(6, Math.round(target / 3)));
          const motionTarget = Math.max(4, Math.min(14, target - videoTarget));
          const result = await chatJson(
            `Ты режиссёр вертикального 9:16 «говорящая голова» в стиле ${styleId}.
Источник видео: ${kind}. Плюс ОБЯЗАТЕЛЬНО Remotion motion-дизайн.
Верни JSON:
{"inserts":[ ...видео ИЛИ motion... ]}

ДВА ТИПА вставок (оба обязательны):

1) ВИДЕО (${kind}) — ровно ${videoTarget} шт.:
{"anchorWord":<i>,"endWord":<i>,"prompt":"<english>","query":"<search>","layout":"full","note":"<ru quote>","spokenText":"<ru quote>"}
- layout ВСЕГДА "full" (cutaway на весь кадр).
- prompt — cinematic EN 1–2 предложения по смыслу фразы; vertical 9:16; no text/logos/faces/celebrities.
- query — 2–5 EN слов (точный noun из фразы).
- На самые сильные мысли, равномерно по ролику.

2) MOTION Remotion — ровно ${motionTarget} шт. (код-графика, НЕ картинки):
{"anchorWord":<i>,"endWord":<i>,"template":"<slug>","layout":"third"|"half","data":{...},"note":"<ru quote>","spokenText":"<ru quote>"}
- template ТОЛЬКО: ${MOTION_TEMPLATES}.
- ~${coverPct}% с data.cover=true (тёмный фон); остальные cover:false поверх спикера.
- Караоке уже показывает речь — после хука ЗАПРЕЩЕНО big-statement/kinetic-type/quote-card
  с длинной цитатой фразы (хук в начале — исключение: punch ≤3 слова).
- data: короткие ярлыки ≤3 слова ИЛИ items/steps/value без простыни текста.
- МАППИНГ: боль→metric+checklist; успех→gauge; раньше/сейчас→vs-compare/bars; процесс→timeline-steps; деньги→number-counter.
- Accent: ${accentColor}. Чередуй #EF4444 #34D399 #22D3EE #FB7185.

ОБЩИЕ ПРАВИЛА:
- ХУК (ОБЯЗАТЕЛЬНО): самая ранняя вставка — MOTION (не видео) на первых словах речи
  (минимальный anchorWord). template: kinetic-type | big-statement | quote-card;
  punch ≤3 слова (не вся фраза), cover:true, layout:full. Потом видео/остальное.
- Сначала прочитай anchorWord..endWord. Вставка иллюстрирует ЭТУ фразу.
- Видео и motion НЕ на одних и тех же словах (окна не пересекаются).
- endWord > anchorWord; видео 3–6 сек, motion 2–5 сек.
- note/spokenText = цитата фразы (для разметки, НЕ для огромного текста в кадре).
- ЗАПРЕЩЕНО: оффтоп, плейсхолдеры «БОЛЬШОЕ ЗАЯВЛЕНИЕ», >${videoTarget} видео,
  пустые prompt/template, зум лица, видео на первом слоте, слабый разгон без панча.`,
            `DURATION_SEC=${durationSec || "?"}\nBROLL_MODE=${brollMode}\nSTYLE=${styleId}\nBRIEF:\n${brief || "(нет)"}\n\nUTTERANCES:\n${utterances.slice(0, 12000)}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
            150_000,
          );
          if (!Array.isArray(result.inserts)) result.inserts = [];
          // Страховка: не больше videoTarget видео-слотов (с prompt/query без template).
          const videos = result.inserts.filter((it: Json) => !it.template && (it.prompt || it.query));
          const motions = result.inserts.filter((it: Json) => it.template);
          result.inserts = ensureHookFirstInsert([
            ...videos.slice(0, videoTarget),
            ...motions.slice(0, motionTarget),
          ]);
          return json(result);
        }

        const sourceHint =
          brollMode === "library"
            ? "Источник B-roll: папки проекта — планируй окна под клипы/нарезки."
            : "Источник B-roll: motion-графика (шаблоны ниже).";
        const result = await chatJson(
          `Ты режиссёр motion-графики для вертикального 9:16 «говорящая голова».
Стиль шаблона: ${styleId}. Верни JSON:
{"inserts":[{"anchorWord":<i>,"endWord":<i>,"template":"<slug>","layout":"third"|"half"|"full","data":{...},"note":"<ru quote>","spokenText":"<ru quote>"}]}
Это code-based b-roll (НЕ картинки). template — ТОЛЬКО: ${MOTION_TEMPLATES}.
${sourceHint}
ГЛАВНОЕ: визуал по смыслу фразы. Караоке уже показывает речь — НЕ дублируй фразу огромным текстом.
ХУК (ОБЯЗАТЕЛЬНО): первая вставка — на начале речи (минимальный anchorWord, первые 1–3 сек).
template: kinetic-type | big-statement | quote-card; punch ≤3 слова; cover:true; layout:full.
Не начинай с воды («привет», «сегодня разберём») — сразу панч/цифра/боль/оффер.
ЗАПРЕЩЕНО после хука: big-statement/kinetic-type/quote-card с длинной цитатой речи;
плейсхолдер «БОЛЬШОЕ ЗАЯВЛЕНИЕ».
GROUNDING (ЖЁСТКО):
- Прочитай слова anchorWord..endWord ДО выбора template.
- data: items/steps/value/короткий label ≤3 слова из фразы. Цифры только если сказаны.
- note и spokenText = цитата (метаданные). Нет grounded-визуала → ПРОПУСТИ слот.
Правила плотности:
- Цель ~${target} вставок (~1 на ${every} сек).
- ~${coverPct}% cover:true без текстовой простыни.
- МАППИНГ: боль→metric+checklist; успех→gauge; раньше/сейчас→bars; процесс→timeline; деньги→number-counter.
- Accent: ${accentColor}. Чередуй #EF4444 #34D399 #22D3EE #FB7185.
- endWord > anchorWord, окно 2–5 сек. Без зума лица.`,
          `DURATION_SEC=${durationSec || "?"}\nBROLL_MODE=${brollMode}\nSTYLE=${styleId}\nBRIEF:\n${brief || "(нет)"}\n\nUTTERANCES:\n${utterances.slice(0, 12000)}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
          150_000,
        );
        if (!Array.isArray(result.inserts)) result.inserts = [];
        result.inserts = ensureHookFirstInsert(result.inserts);
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
- ХУК: каждый шортс ОБЯЗАН начинаться с сильного хука — первый span = вопрос/цифра/боль/оффер
  (не приветствие и не разгон). Если хук в середине куска — режь spans так, чтобы он был первым;
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
ХУК (ОБЯЗАТЕЛЬНО): scenes[0] — сильный хук на первых словах речи.
template ТОЛЬКО: kinetic-type | big-statement | quote-card.
data: punch ≤3 слова (не вся фраза), cover:true, caption:false;
kinetic-type → data.words[]; big-statement/quote-card → data.lines.
Запрещено начинать с lower-third / checklist / dashboard / воды («привет», «сегодня»).
data — поля шаблона (price/label/value/items/lines/words/steps/accent="#hex"/cover/caption).
Чередуй шаблоны после хука. Цвета accent в data — РАЗНЫЕ между соседними сценами, но в одной
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
