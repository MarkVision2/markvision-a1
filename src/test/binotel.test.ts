import { describe, it, expect } from "vitest";
import {
  binotelErrorText,
  callContent,
  callDirection,
  callStartedAt,
  dispositionLabel,
  isAnswered,
  isRecordable,
  parseCallDetails,
  phoneTail,
  toBinotelPhone,
  toE164,
  toInt,
} from "../../supabase/functions/_lib/binotel";

describe("нормализация номеров", () => {
  it("украинский номер приводит к национальному формату для Binotel", () => {
    expect(toBinotelPhone("+380675639050")).toBe("0675639050");
    expect(toBinotelPhone("380675639050")).toBe("0675639050");
    expect(toBinotelPhone("0675639050")).toBe("0675639050");
    expect(toBinotelPhone("+38 (067) 563-90-50")).toBe("0675639050");
  });

  it("не трогает номера других стран", () => {
    expect(toBinotelPhone("+77011234567")).toBe("77011234567");
  });

  it("хвост из 9 цифр совпадает у всех форматов одного номера", () => {
    const tails = [
      "+380675639050",
      "380675639050",
      "0675639050",
      "+38 (067) 563-90-50",
    ].map(phoneTail);
    expect(new Set(tails).size).toBe(1);
    expect(tails[0]).toBe("675639050");
  });

  it("собирает E.164 из украинского номера", () => {
    expect(toE164("0675639050")).toBe("+380675639050");
    expect(toE164("675639050")).toBe("+380675639050");
    expect(toE164("380675639050")).toBe("+380675639050");
    expect(toE164("")).toBe("");
  });

  it("собирает E.164 из казахстанского номера во всех бытовых написаниях", () => {
    // Один и тот же номер: +7 700 606 88 69
    expect(toE164("+77006068869")).toBe("+77006068869");
    expect(toE164("87006068869")).toBe("+77006068869");   // транковая 8
    expect(toE164("7006068869")).toBe("+77006068869");    // без кода страны
    expect(toE164("+7 700 606 88 69")).toBe("+77006068869");
  });

  it("хвост совпадает у казахстанского номера через 7 и через 8", () => {
    const tails = ["+77006068869", "87006068869", "8 (700) 606-88-69"].map(phoneTail);
    expect(new Set(tails).size).toBe(1);
  });

  it("казахстанский номер не ломается украинским правилом 380→0", () => {
    expect(toBinotelPhone("+77006068869")).toBe("77006068869");
  });
});

describe("ошибки REST API", () => {
  it("расшифровывает известный код", () => {
    expect(binotelErrorText({ status: "error", code: 121, message: "wrong key" }))
      .toContain("Неверный key или secret");
  });

  it("на незнакомом коде отдаёт сообщение сервера", () => {
    expect(binotelErrorText({ status: "error", code: 999, message: "boom" })).toBe("boom");
  });

  it("не падает на пустом ответе", () => {
    expect(binotelErrorText({})).toContain("unknown");
  });
});

describe("разбор callDetails", () => {
  const call = {
    generalCallID: 1387100932,
    externalNumber: "0675639050",
    callType: 0,
    disposition: "ANSWER",
    billsec: 478,
    startTime: 1505591081,
  };

  it("принимает объект звонка как есть", () => {
    expect(parseCallDetails({ callDetails: call })?.generalCallID).toBe(1387100932);
  });

  it("разворачивает карту { generalCallID: {...} } из раздела STATS", () => {
    expect(parseCallDetails({ callDetails: { "1387100932": call } })?.externalNumber)
      .toBe("0675639050");
  });

  it("возвращает null, когда callDetails нет или он не объект", () => {
    expect(parseCallDetails({})).toBeNull();
    expect(parseCallDetails({ callDetails: "" })).toBeNull();
    expect(parseCallDetails({ callDetails: [] })).toBeNull();
  });
});

describe("поля звонка", () => {
  it("callType: 0 — входящий, 1 — исходящий", () => {
    expect(callDirection(0)).toBe("in");
    expect(callDirection("0")).toBe("in");
    expect(callDirection(1)).toBe("out");
    expect(callDirection("1")).toBe("out");
    expect(callDirection(undefined)).toBe("in");
  });

  it("startTime в секундах разворачивается в ISO", () => {
    expect(callStartedAt(1505591081)).toBe(new Date(1505591081000).toISOString());
  });

  it("миллисекунды тоже понимает", () => {
    expect(callStartedAt(1505591081000)).toBe(new Date(1505591081000).toISOString());
  });

  it("без startTime подставляет текущее время", () => {
    const now = Date.parse("2026-08-29T10:00:00.000Z");
    expect(callStartedAt(null, now)).toBe("2026-08-29T10:00:00.000Z");
    expect(callStartedAt("", now)).toBe("2026-08-29T10:00:00.000Z");
  });

  it("toInt терпит строки и отбрасывает мусор", () => {
    expect(toInt("478")).toBe(478);
    expect(toInt(0)).toBe(0);
    expect(toInt("")).toBeNull();
    expect(toInt(null)).toBeNull();
    expect(toInt("abc")).toBeNull();
    expect(toInt(true)).toBeNull();
  });
});

describe("состояния звонка", () => {
  it("отвеченными считаются только ANSWER и TRANSFER", () => {
    expect(isAnswered("ANSWER")).toBe(true);
    expect(isAnswered("TRANSFER")).toBe(true);
    expect(isAnswered("NOANSWER")).toBe(false);
    expect(isAnswered("BUSY")).toBe(false);
  });

  it("запись бывает у ANSWER/TRANSFER/VM-SUCCESS/SUCCESS", () => {
    expect(isRecordable("ANSWER")).toBe(true);
    expect(isRecordable("VM-SUCCESS")).toBe(true);
    expect(isRecordable("SUCCESS")).toBe(true);
    expect(isRecordable("NOANSWER")).toBe(false);
    expect(isRecordable("CANCEL")).toBe(false);
  });

  it("переводит код в человеческую причину", () => {
    expect(dispositionLabel("BUSY")).toBe("занято");
    expect(dispositionLabel("NOANSWER")).toBe("нет ответа");
    expect(dispositionLabel("")).toBe("нет ответа");
  });
});

describe("текст звонка в ленте лида", () => {
  it("для отвеченного показывает длительность", () => {
    const text = callContent({
      answered: true, disposition: "ANSWER", durationSec: 478, recordingArchived: true,
    });
    expect(text).toContain("Длительность: 7 мин 58 с");
    expect(text).toContain("Запись разговора приложена");
    expect(text).not.toContain("Не дозвонились");
  });

  it("короткий звонок — только секунды", () => {
    expect(callContent({
      answered: true, disposition: "ANSWER", durationSec: 42, recordingArchived: false,
    })).toBe("Длительность: 42 с");
  });

  it("для непринятого объясняет причину и не врёт про длительность", () => {
    const text = callContent({
      answered: false, disposition: "BUSY", durationSec: 0, recordingArchived: false,
    });
    expect(text).toBe("Не дозвонились: занято");
  });
});
