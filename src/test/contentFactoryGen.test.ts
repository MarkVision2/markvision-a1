/**
 * Сборка промпта и разбор ответа модели в прямом контуре Контент-завода.
 *
 * Здесь ломается тихо: неподставленный токен или неразобранный JSON не
 * роняют запрос, а дают пустую или бессмысленную картинку. Поэтому проверяем
 * подстановку, терпимость парсера к ответам модели и порядок кадров.
 */
import { describe, expect, it } from "vitest";
import {
  buildAllData,
  buildBranchPrompt,
  buildSlidePrompt,
  cleanJsonBlock,
  parseJsonSafe,
  parseStrategy,
  renderPrompt,
} from "../../supabase/functions/_lib/contentFactoryGen.ts";
import {
  BRANCH_PROMPTS,
  promptForContentType,
} from "../../supabase/functions/_lib/contentFactoryPrompts.ts";

const body = {
  content_type: "fb-target",
  prompt: "ТЗ на креатив",
  name: "Кофемашина",
  description: "Для дома",
  style: "минимализм",
  color: "чёрный",
  language: "ru",
  aspect: "4:5",
  slides: 3,
  ctas: "Купить",
  fb_niche: "техника",
  request_id: "req-1",
  session_id: "sess-1",
};

describe("renderPrompt", () => {
  it("подставляет поля брифа", () => {
    const out = renderPrompt("тип {{content_type}}, стиль {{style}}, {{slides}} шт.", body);
    expect(out).toBe("тип fb-target, стиль минимализм, 3 шт.");
  });

  it("незаполненный токен становится пустой строкой, а не ломает промпт", () => {
    expect(renderPrompt("[{{platform}}]", body)).toBe("[]");
    expect(renderPrompt("[{{чего_то_нет}}]", body)).toBe("[{{чего_то_нет}}]");
  });

  it("подставляет результаты анализа входа", () => {
    const out = renderPrompt(
      "{{image_analysis}}|{{site_data}}|{{text_analysis}}",
      body,
      { image_analysis: "фото", site_data: "сайт", text_analysis: "текст" },
    );
    expect(out).toBe("фото|сайт|текст");
  });

  it("объект в поле уходит как JSON, а не [object Object]", () => {
    expect(renderPrompt("{{ctas}}", { ctas: ["Купить", "Узнать"] })).toBe('["Купить","Узнать"]');
  });
});

describe("buildAllData", () => {
  it("выкидывает служебные поля и пустые значения", () => {
    const all = JSON.parse(buildAllData({ ...body, chat_id: "1", timestamp: "x", empty: "" }));
    expect(all.request_id).toBeUndefined();
    expect(all.session_id).toBeUndefined();
    expect(all.chat_id).toBeUndefined();
    expect(all.timestamp).toBeUndefined();
    expect(all.empty).toBeUndefined();
    expect(all.name).toBe("Кофемашина");
  });
});

describe("promptForContentType", () => {
  it("каждый тип из мастера получает свою ветку", () => {
    for (const key of ["fb-target", "insta-carousel", "instagram-stories", "neuro-photo"]) {
      expect(promptForContentType(key)).toBe(BRANCH_PROMPTS[key]);
    }
  });

  it("незнакомый тип уходит в общую ветку, а не падает", () => {
    const fallback = promptForContentType("marketplace");
    expect(fallback.length).toBeGreaterThan(100);
    expect(Object.values(BRANCH_PROMPTS)).not.toContain(fallback);
  });

  it("в перенесённых промптах не осталось выражений n8n", () => {
    for (const prompt of [...Object.values(BRANCH_PROMPTS), promptForContentType("x")]) {
      expect(prompt).not.toContain("$node[");
      expect(prompt).not.toContain('$item("0")');
      expect(prompt.startsWith("=")).toBe(false);
    }
  });
});

describe("buildBranchPrompt", () => {
  it("собирает промпт ветки с подставленным брифом", () => {
    const out = buildBranchPrompt(body, { image_analysis: "анализ фото" });
    expect(out).toContain("Кофемашина");
    expect(out).toContain("анализ фото");
    expect(out).not.toContain("{{all_data}}");
  });
});

describe("cleanJsonBlock / parseJsonSafe", () => {
  it("снимает markdown-обёртку модели", () => {
    expect(cleanJsonBlock('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("отрезает болтовню вокруг JSON", () => {
    expect(parseJsonSafe('Вот результат: {"a":1} — готово')).toEqual({ a: 1 });
  });

  it("чинит висячие запятые — модель ставит их регулярно", () => {
    expect(parseJsonSafe('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it("на безнадёжном ответе возвращает null, а не бросает", () => {
    expect(parseJsonSafe("совсем не json")).toBeNull();
  });
});

describe("parseStrategy", () => {
  it("читает слайды и достаёт аспект", () => {
    const slides = parseStrategy(JSON.stringify({
      slides: [
        { slide_number: 1, slide_type: "hook", image_prompt: "кадр 1", aspect_ratio: "1:1" },
        { slide_number: 2, slide_type: "offer", image_prompt: "кадр 2" },
      ],
    }), "4:5");
    expect(slides).toHaveLength(2);
    expect(slides[0].aspect_ratio).toBe("1:1");
    expect(slides[1].aspect_ratio).toBe("4:5");
  });

  it("понимает другие имена массива из разных веток промпта", () => {
    for (const key of ["creatives", "thumbnails", "ads_creatives", "images"]) {
      const slides = parseStrategy(JSON.stringify({ [key]: [{ image_prompt: "кадр" }] }));
      expect(slides).toHaveLength(1);
    }
  });

  it("плоский ответ про один кадр тоже принимается", () => {
    expect(parseStrategy(JSON.stringify({ image_prompt: "один кадр" }))).toHaveLength(1);
  });

  it("нумерует кадры, если модель забыла slide_number", () => {
    const slides = parseStrategy(JSON.stringify({
      slides: [{ image_prompt: "a" }, { image_prompt: "b" }],
    }));
    expect(slides.map((s) => s.slide_number)).toEqual([1, 2]);
  });

  it("режет по лимиту и выкидывает кадры без промпта", () => {
    const slides = parseStrategy(JSON.stringify({
      slides: [{ image_prompt: "a" }, { image_prompt: "" }, { image_prompt: "c" }],
    }), "4:5", 2);
    expect(slides).toHaveLength(1);
  });

  it("мусор вместо JSON даёт пустой список, а не исключение", () => {
    expect(parseStrategy("модель отказалась")).toEqual([]);
  });
});

describe("buildSlidePrompt", () => {
  it("добавляет технический блок с аспектом", () => {
    const out = buildSlidePrompt(
      { slide_number: 1, slide_type: "hook", image_prompt: "кадр", aspect_ratio: "9:16" },
      2,
    );
    expect(out).toContain("Aspect Ratio: 9:16");
    expect(out).toContain("reference images");
    expect(out).toContain('"imageSize": "1K"');
  });

  it("без референсов не обещает модели несуществующие картинки", () => {
    const out = buildSlidePrompt(
      { slide_number: 1, slide_type: "hook", image_prompt: "кадр", aspect_ratio: "1:1" },
      0,
    );
    expect(out).toContain("No reference images");
  });
});
