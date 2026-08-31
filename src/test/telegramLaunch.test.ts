import { describe, expect, it } from "vitest";
import {
  destinationToGoal,
  extractAdText,
  extractCodeWord,
  extractUrls,
  needsDirectionPrompt,
  parseBudgetUsd,
  parseDestination,
  parseLaunchCommand,
  pickWebsiteUrl,
  resolveWebsite,
} from "../../supabase/functions/_lib/telegramLaunch.ts";

describe("parseDestination", () => {
  it("узнаёт лид-форму", () => {
    expect(parseDestination("на форму, бюджет 20")).toBe("leadform");
    expect(parseDestination("Лид-форма")).toBe("leadform");
    expect(parseDestination("leadform")).toBe("leadform");
  });

  it("узнаёт директ", () => {
    expect(parseDestination("в директ")).toBe("instagram");
    expect(parseDestination("директ, бюджет 15")).toBe("instagram");
  });

  it("узнаёт сайт по слову", () => {
    expect(parseDestination("на сайт")).toBe("website");
    expect(parseDestination("трафик")).toBe("website");
  });

  it("по умолчанию WhatsApp", () => {
    expect(parseDestination("запусти")).toBe("whatsapp");
    expect(parseDestination("")).toBe("whatsapp");
  });

  it("ссылка на сайт в подписи сама означает запуск на сайт", () => {
    expect(parseDestination("Смотрите тут https://clinic.kz/lp")).toBe("website");
  });

  it("ссылка на медиа-хостинг направление не меняет", () => {
    expect(parseDestination("вот видео https://drive.google.com/file/d/1")).toBe("whatsapp");
    expect(parseDestination("пост https://www.instagram.com/p/abc")).toBe("whatsapp");
  });

  it("слово instagram внутри ссылки не уводит в директ", () => {
    expect(parseDestination("на сайт https://instagram-agency.kz")).toBe("website");
  });
});

describe("parseBudgetUsd", () => {
  it("читает разные формы записи", () => {
    expect(parseBudgetUsd("бюджет 30")).toBe(30);
    expect(parseBudgetUsd("бюджет: 25.5")).toBe(25.5);
    expect(parseBudgetUsd("запусти на 50$")).toBe(50);
    expect(parseBudgetUsd("40 долларов в день")).toBe(40);
    expect(parseBudgetUsd("на 15")).toBe(15);
    expect(parseBudgetUsd("бюджет 12,5")).toBe(12.5);
  });

  it("не принимает суммы вне разумного диапазона", () => {
    expect(parseBudgetUsd("бюджет 0")).toBeNull();
    expect(parseBudgetUsd("бюджет 5000")).toBeNull();
  });

  it("не принимает число из текста объявления за бюджет", () => {
    expect(parseBudgetUsd("Работаем на 100 процентов")).toBeNull();
    expect(parseBudgetUsd("Импланты на 15 лет гарантии")).toBeNull();
    expect(parseBudgetUsd("скидка на 3 дня")).toBeNull();
  });

  it("явно указанный бюджет сильнее числа из текста", () => {
    expect(parseBudgetUsd("Гарантия на 15 лет. Бюджет 40")).toBe(40);
  });

  it("без суммы возвращает null — берём бюджет кабинета", () => {
    expect(parseBudgetUsd("запусти на сайт")).toBeNull();
    expect(parseBudgetUsd("")).toBeNull();
  });
});

describe("extractAdText", () => {
  it("выкидывает командные слова из начала", () => {
    expect(extractAdText("запусти на сайт Комплексная диагностика организма со скидкой 30%"))
      .toBe("Комплексная диагностика организма со скидкой 30%");
  });

  it("выкидывает ссылки", () => {
    const text = extractAdText(
      "на сайт https://clinic.kz Профессиональная чистка зубов за 8000 тенге",
    );
    expect(text).toBe("Профессиональная чистка зубов за 8000 тенге");
  });

  it("короткая команда текстом объявления не становится", () => {
    expect(extractAdText("запусти на сайт")).toBe("");
    expect(extractAdText("в директ")).toBe("");
  });

  it("сохраняет абзацы длинного текста", () => {
    const text = extractAdText("Импланты под ключ за 3 дня\n\nЗвоните и записывайтесь");
    expect(text).toBe("Импланты под ключ за 3 дня\n\nЗвоните и записывайтесь");
  });
});

describe("extractCodeWord", () => {
  it("узнаёт плюс", () => {
    expect(extractCodeWord("Напишите + в директ")).toBe("+");
    expect(extractCodeWord("ставьте плюсик")).toBe("+");
  });

  it("узнаёт слово после «напишите слово»", () => {
    expect(extractCodeWord("напишите слово СТАРТ")).toBe("СТАРТ");
    expect(extractCodeWord("напишите слово цена")).toBe("ЦЕНА");
  });

  it("узнаёт слово в кавычках", () => {
    expect(extractCodeWord('отправьте "ЗАПИСЬ"')).toBe("ЗАПИСЬ");
  });

  it("узнаёт слово капсом", () => {
    expect(extractCodeWord("напишите ЦЕНА и мы ответим")).toBe("ЦЕНА");
  });

  it("склеивает несколько источников — подпись и расшифровку видео", () => {
    expect(extractCodeWord("", "в ролике диктор просит: напишите слово АКЦИЯ")).toBe("АКЦИЯ");
  });

  it("без просьбы кодового слова нет", () => {
    expect(extractCodeWord("Просто текст объявления")).toBe("");
    expect(extractCodeWord("")).toBe("");
  });
});

describe("pickWebsiteUrl и extractUrls", () => {
  it("отрезает хвостовую пунктуацию", () => {
    expect(extractUrls("смотрите (https://clinic.kz/lp), там всё")).toEqual([
      "https://clinic.kz/lp",
    ]);
  });

  it("берёт первую не-медиа ссылку", () => {
    expect(pickWebsiteUrl("видео https://youtu.be/x и сайт https://clinic.kz"))
      .toBe("https://clinic.kz");
  });

  it("если ссылок на сайт нет — null", () => {
    expect(pickWebsiteUrl("https://drive.google.com/file/d/1")).toBeNull();
    expect(pickWebsiteUrl("без ссылок")).toBeNull();
  });
});

describe("resolveWebsite", () => {
  it("без списка разрешённых доменов доверяем подписи", () => {
    expect(resolveWebsite({
      fromCaption: "https://any.kz/lp",
      cabinetDefault: "https://clinic.kz",
    })).toEqual({ url: "https://any.kz/lp", status: "no_whitelist", message: null });
  });

  it("разрешённый домен из подписи проходит", () => {
    const r = resolveWebsite({
      fromCaption: "https://clinic.kz/implants",
      cabinetDefault: "https://clinic.kz",
      allowed: [{ url: "https://clinic.kz", isDefault: true }],
    });
    expect(r.status).toBe("ok");
    expect(r.url).toBe("https://clinic.kz/implants");
  });

  it("домен кабинета разрешён всегда, даже если его нет в списке", () => {
    const r = resolveWebsite({
      fromCaption: "https://clinic.kz/lp",
      cabinetDefault: "https://clinic.kz",
      allowed: [{ url: "https://other.kz", isDefault: true }],
    });
    expect(r.status).toBe("ok");
  });

  it("чужой домен подменяется на сайт кабинета и объясняется", () => {
    const r = resolveWebsite({
      fromCaption: "https://competitor.kz/lp",
      cabinetDefault: "https://clinic.kz",
      allowed: [{ url: "https://clinic.kz", label: "Сайт клиники", isDefault: true }],
    });
    expect(r.status).toBe("fallback_default");
    expect(r.url).toBe("https://clinic.kz");
    expect(r.message).toContain("competitor.kz");
  });

  it("ссылки в подписи нет — берём сайт кабинета", () => {
    const r = resolveWebsite({
      cabinetDefault: "https://clinic.kz",
      allowed: [{ url: "https://clinic.kz", isDefault: true }],
    });
    expect(r.url).toBe("https://clinic.kz");
    expect(r.message).toBeNull();
  });
});

describe("needsDirectionPrompt", () => {
  it("медиа без подписи — переспрашиваем направление", () => {
    expect(needsDirectionPrompt({ caption: "", hasMedia: true })).toBe(true);
  });

  it("фото из альбома без подписи пропускаем — подпись на другом снимке", () => {
    expect(needsDirectionPrompt({ caption: "", hasMedia: true, mediaGroupId: "123" }))
      .toBe(false);
  });

  it("с подписью не переспрашиваем", () => {
    expect(needsDirectionPrompt({ caption: "на сайт", hasMedia: true })).toBe(false);
  });
});

describe("parseLaunchCommand", () => {
  it("разбирает боевую подпись целиком", () => {
    const parsed = parseLaunchCommand(
      "на сайт https://clinic.kz/implants бюджет 40 " +
        "Импланты под ключ за 3 дня. Напишите слово СТАРТ",
    );
    expect(parsed.destination).toBe("website");
    expect(parsed.goal).toBe("site-leads");
    expect(parsed.budgetUsd).toBe(40);
    expect(parsed.websiteFromCaption).toBe("https://clinic.kz/implants");
    expect(parsed.codeWord).toBe("СТАРТ");
    expect(parsed.adText).toContain("Импланты под ключ");
    expect(parsed.adText).not.toContain("https://");
  });

  it("направления переводятся в цели мастера один в один", () => {
    expect(destinationToGoal("whatsapp")).toBe("whatsapp");
    expect(destinationToGoal("website")).toBe("site-leads");
    expect(destinationToGoal("leadform")).toBe("meta-form");
    expect(destinationToGoal("instagram")).toBe("instagram-direct");
  });
});
