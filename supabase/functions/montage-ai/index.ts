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
- query — 2–5 EN слов: КОНКРЕТНЫЕ существительные из spokenText (дословный перевод смысла).
  Примеры: фраза про «отчёты/рекламу» → "laptop analytics dashboard"; про «деньги» → "counting cash desk".
  ЗАПРЕЩЕНО: generic business/office/people/success/motivation; еда/рыба/фрукты/животные/природа — ТОЛЬКО если это сказано в фразе.
  Если нет конкретного визуала из речи — НЕ делай видео-слот (оставь окно под motion).
- На самые сильные мысли, равномерно по ролику.

2) MOTION Remotion — ровно ${motionTarget} шт. (код-графика, НЕ картинки):
{"anchorWord":<i>,"endWord":<i>,"template":"<slug>","layout":"third"|"half","data":{...},"note":"<ru quote>","spokenText":"<ru quote>"}
- template ТОЛЬКО: ${MOTION_TEMPLATES}.
- ~${coverPct}% с data.cover=true (тёмный фон + мысль в центре); остальные cover:false (big-statement/metric поверх спикера).
- data.text/label/lines/items/value — ТОЛЬКО из слов фразы; цифры только если сказаны.
- МАППИНГ: боль→metric+checklist; успех→gauge; раньше/сейчас→vs-compare/bars; процесс→timeline-steps; тезис→big-statement #EF4444; деньги→number-counter.
- Accent: ${accentColor}. Чередуй #EF4444 #34D399 #22D3EE #FB7185.

ОБЩИЕ ПРАВИЛА:
- Сначала прочитай anchorWord..endWord. Вставка иллюстрирует ЭТУ фразу.
- Видео и motion НЕ на одних и тех же словах (окна не пересекаются).
- endWord > anchorWord; видео 3–6 сек, motion 2–5 сек.
- note/spokenText = цитата фразы.
- ЗАПРЕЩЕНО: оффтоп (рыба/мандарины/еда без речи о них), >${videoTarget} видео, пустые prompt/template, зум лица.`,
            `DURATION_SEC=${durationSec || "?"}\nBROLL_MODE=${brollMode}\nSTYLE=${styleId}\nBRIEF:\n${brief || "(нет)"}\n\nUTTERANCES:\n${utterances.slice(0, 12000)}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
            150_000,
          );
          if (!Array.isArray(result.inserts)) result.inserts = [];
          // Страховка: не больше videoTarget видео-слотов (с prompt/query без template).
          const videos = result.inserts.filter((it: Json) => !it.template && (it.prompt || it.query));
          const motions = result.inserts.filter((it: Json) => it.template);
          result.inserts = [
            ...videos.slice(0, videoTarget),
            ...motions.slice(0, motionTarget),
          ];
          return json(result);
        }

        // Library — клипы из папок проекта + motion. Каталог приходит от воркера.
        if (brollMode === "library") {
          const catalog = Array.isArray(body.assetCatalog) ? body.assetCatalog as Json[] : [];
          const videoTarget = Math.max(
            2,
            Math.min(8, catalog.length || 4, Math.round(target / 3)),
          );
          const motionTarget = Math.max(4, Math.min(14, target - videoTarget));
          const catalogLines = catalog.slice(0, 80).map((a) => {
            const id = String(a.id ?? "");
            const name = String(a.name ?? "");
            const folder = String(a.folder_name ?? a.folderName ?? "");
            const kind = String(a.media_type ?? a.mediaType ?? "video");
            return `- ${id} | ${kind} | folder="${folder}" | name="${name}"`;
          }).join("\n");
          const result = await chatJson(
            `Ты режиссёр вертикального 9:16 «говорящая голова» в стиле ${styleId}.
Источник видео: МЕДИАТЕКА проекта (свои B-roll). Плюс Remotion motion.
Верни JSON: {"inserts":[ ... ]}

ДВА ТИПА:

1) ВИДЕО из медиатеки — до ${videoTarget} шт. (не больше числа клипов в каталоге):
{"anchorWord":<i>,"endWord":<i>,"assetId":"<uuid|null>","query":"<need>","layout":"full","note":"<ru quote>","spokenText":"<ru quote>"}
- layout ВСЕГДА "full".
- Сначала прочитай фразу. Подбери клип ИЗ КАТАЛОГА, чьё имя/папка по смыслу бьётся с фразой → assetId.
- Имена вроде IMG_9190 / RPReplay_* / UUID — «немые»: assetId=null, query=краткое описание нужного визуала из фразы; воркер разложит пул сам.
- НЕ выдумывай assetId вне каталога. Один клип — максимум один раз.
- Если фраза абстрактная (цифры, «важно») — лучше MOTION, не видео.

2) MOTION Remotion — ровно ${motionTarget} шт.:
{"anchorWord":<i>,"endWord":<i>,"template":"<slug>","layout":"third"|"half","data":{...},"note":"<ru quote>","spokenText":"<ru quote>"}
- template ТОЛЬКО: ${MOTION_TEMPLATES}.
- ~${coverPct}% cover:true. data только из слов фразы.
- Accent: ${accentColor}. Чередуй #EF4444 #34D399 #22D3EE #FB7185.

ОБЩЕЕ: окна не пересекаются; spokenText=цитата; без оффтопа и без стока Pexels.`,
            `DURATION_SEC=${durationSec || "?"}\nBROLL_MODE=library\nSTYLE=${styleId}\nBRIEF:\n${brief || "(нет)"}\n\nLIBRARY_ASSETS (${catalog.length}):\n${catalogLines || "(пусто — только motion)"}\n\nUTTERANCES:\n${utterances.slice(0, 12000)}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
            150_000,
          );
          if (!Array.isArray(result.inserts)) result.inserts = [];
          const allowedIds = new Set(catalog.map((a) => String(a.id ?? "")).filter(Boolean));
          const usedIds = new Set<string>();
          const videos: Json[] = [];
          const motions: Json[] = [];
          for (const it of result.inserts) {
            if (it?.template) {
              motions.push(it);
              continue;
            }
            const aid = it?.assetId != null ? String(it.assetId) : "";
            if (aid && allowedIds.has(aid) && !usedIds.has(aid)) {
              usedIds.add(aid);
              videos.push({ ...it, assetId: aid, layout: "full" });
            } else if (!it?.template) {
              // Слот без валидного assetId — воркер подберёт из пула по query/spokenText.
              videos.push({ ...it, assetId: null, layout: "full" });
            }
          }
          result.inserts = [
            ...videos.slice(0, videoTarget),
            ...motions.slice(0, motionTarget),
          ];
          return json(result);
        }

        const result = await chatJson(
          `Ты режиссёр motion-графики для вертикального 9:16 «говорящая голова».
Стиль шаблона: ${styleId}. Верни JSON:
{"inserts":[{"anchorWord":<i>,"endWord":<i>,"template":"<slug>","layout":"third"|"half"|"full","data":{...},"note":"<ru quote>","spokenText":"<ru quote>"}]}
Это code-based b-roll (НЕ картинки). template — ТОЛЬКО: ${MOTION_TEMPLATES}.
Источник B-roll: motion-графика (шаблоны ниже).
ГЛАВНОЕ: каждая мысль = ВИЗУАЛЬНАЯ СЦЕНА по ИМЕННО этой фразе (не декор, не оффтоп).
GROUNDING (ЖЁСТКО):
- Прочитай слова anchorWord..endWord ДО выбора template.
- data.text/label/lines/items/value — только из этой фразы (дословно или лёгкая нормализация).
- Цифры/% в data = цифры из речи. Нет цифры → не используй number-counter/metric-callout.
- note и spokenText = цитата фразы. Если не можешь grounded-визуал — ПРОПУСТИ слот (лучше дыра, чем оффтоп).
Правила плотности:
- Цель ~${target} вставок (~1 на ${every} сек), без дыр >${every + 2} сек где есть смысл.
- ~${coverPct}% с data.cover=true: тёмный фон + ЦЕНТР = мысль из фразы. Тег контекста из той же мысли.
- Остальные cover:false: big-statement/metric-callout сверху (layout:third) — текст из фразы.
- МАППИНГ только если фраза реально про это: боль→metric+checklist; успех→gauge; раньше/сейчас→bars; процесс→timeline; тезис→big-statement #EF4444; деньги→number-counter.
- Accent: ${accentColor}. Чередуй #EF4444 #34D399 #22D3EE #FB7185.
- endWord > anchorWord, окно 2–5 сек. Без зума/приближения лица.`,
          `DURATION_SEC=${durationSec || "?"}\nBROLL_MODE=${brollMode}\nSTYLE=${styleId}\nBRIEF:\n${brief || "(нет)"}\n\nUTTERANCES:\n${utterances.slice(0, 12000)}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
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
