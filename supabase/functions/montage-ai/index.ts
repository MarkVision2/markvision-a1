// AI-помощник монтаж-воркера: Deepgram-транскрипт + OpenAI-разметка.
// Auth: x-montage-key = montage_settings.worker_key (как у montage-worker).
//
// POST JSON { action, ... }:
//   bootstrap_env              → ключи для VPS (.env) — Deepgram/OpenAI/ElevenLabs
//   markup_delete              → delete.json из indexed/utterances + brief
//   markup_accents             → accents.json
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
        // Одноразовая выдача секретов воркеру (он уже авторизован worker-ключом).
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
{"delete":[{"from":<int>,"to":<int>,"reason":"..."}]}
Индексы слов включительные из indexed.txt. Вырежи: дубли фраз (оставь лучшую/последнюю версию),
слова-паразиты (ну/типа/как бы/эээ/вот), фальстарты, длинные паузы-бормотания, оффтоп.
Не вырезай смысл и цифры. Если brief задан — учти его. Пустой delete допустим.`,
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
Выбери 5–15 ключевых слов/цифр для экранных акцентов (капс, можно → и ₸/$/%).
word = индекс из indexed. Не дублируй соседние слова.`,
          `BRIEF:\n${brief || "(нет)"}\n\nINDEXED:\n${indexed.slice(0, 40000)}`,
        );
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
- ровно ${count} шортс(ов), каждый 15–45 сек суммарно по spans;
- spans — непрерывные куски исходника в секундах (0..${durationSec.toFixed(1)}), без дыр внутри фразы;
- id только a-zA-Z0-9-, начинается с Short-;
- accents — индексы слов из indexed для punch/караоке;
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
{"scenes":[{"anchorWord":<i>,"endWord":<i>,"template":"<имя>","data":{...}}]}
Сцены непрерывны по словам (без дыр). Шаблоны: BigNumber, Quote, Checklist, BeforeAfter,
Steps, Comparison, Warning, Tip, LogoOutro, KineticLine. data — поля шаблона (title/value/items…).
Цвета разнообразные. Короткие сцены оставляют караоке.`,
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
