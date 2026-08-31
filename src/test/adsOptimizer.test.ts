import { describe, expect, it } from "vitest";
import {
  buildReport,
  countLeadsFromActions,
  decideCampaign,
  DEFAULT_THRESHOLDS,
  detectFatigue,
  isAccessProblem,
  nextBudgetCents,
  type CampaignSnapshot,
} from "../../supabase/functions/_lib/adsOptimizer.ts";

function snapshot(patch: Partial<CampaignSnapshot> = {}): CampaignSnapshot {
  return {
    campaignId: "c1",
    name: "Клиника | Фото | WhatsApp | 3108 | AI",
    adSetId: "as1",
    rolling: { spend: 12, leads: 6, cpl: 2, ctr: 1.4, frequency: 1.1, impressions: 8000 },
    today: { spend: 4, leads: 2, cpl: 2, ctr: 1.4 },
    score: 60,
    daysActive: 10,
    ageHours: 240,
    scoreTrend: "stable",
    cplTrend: "stable",
    depth3Rate: 40,
    quality: null,
    crm: { paid: 0, scheduled: 0, arrived: 0 },
    currentDailyBudgetCents: 1000,
    ...patch,
  };
}

describe("countLeadsFromActions", () => {
  it("не задваивает один лид, приходящий под разными именами", () => {
    const leads = countLeadsFromActions([
      { action_type: "lead", value: "3" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "3" },
      { action_type: "onsite_web_lead", value: "2" },
    ]);
    expect(leads).toBe(3);
  });

  it("складывает лиды из разных источников", () => {
    const leads = countLeadsFromActions([
      { action_type: "lead", value: "3" },
      { action_type: "onsite_conversion.lead_grouped", value: "2" },
      { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5" },
    ]);
    expect(leads).toBe(10);
  });

  it("игнорирует посторонние действия и пустой ввод", () => {
    expect(countLeadsFromActions([{ action_type: "link_click", value: "99" }])).toBe(0);
    expect(countLeadsFromActions(undefined)).toBe(0);
    expect(countLeadsFromActions(null)).toBe(0);
  });
});

describe("nextBudgetCents", () => {
  it("растит на шаг и упирается в потолок", () => {
    expect(nextBudgetCents(1000, 1.2, 50)).toBe(1200);
    expect(nextBudgetCents(4500, 1.2, 50)).toBe(5000);
  });

  it("на потолке роста больше нет", () => {
    expect(nextBudgetCents(5000, 1.2, 50)).toBeNull();
  });

  it("без текущего бюджета расти не от чего", () => {
    expect(nextBudgetCents(null, 1.2, 50)).toBeNull();
    expect(nextBudgetCents(0, 1.2, 50)).toBeNull();
  });
});

describe("decideCampaign — защита денег", () => {
  it("кампанию с оплатами в CRM не паузим даже при чудовищном CPL", () => {
    const d = decideCampaign(snapshot({
      crm: { paid: 2, scheduled: 0, arrived: 0 },
      rolling: { spend: 100, leads: 1, cpl: 100 },
      today: { spend: 50, leads: 0, cpl: 0 },
    }));
    expect(d.kind).toBe("scale");
    if (d.kind === "scale") expect(d.capUsd).toBe(100);
  });

  it("оплаты есть, но кампания новая — просто защищаем без роста", () => {
    const d = decideCampaign(snapshot({
      crm: { paid: 1, scheduled: 0, arrived: 0 },
      daysActive: 2,
    }));
    expect(d).toEqual({ kind: "protect", reason: "1 оплат в CRM" });
  });

  it("записи и визиты защищают, пока расход за сегодня в норме", () => {
    const d = decideCampaign(snapshot({
      crm: { paid: 0, scheduled: 3, arrived: 1 },
      rolling: { spend: 60, leads: 0, cpl: 0 },
      today: { spend: 5, leads: 0, cpl: 0 },
    }));
    expect(d.kind).toBe("protect");
  });

  it("но перерасход сегодня снимает эту защиту", () => {
    const d = decideCampaign(snapshot({
      crm: { paid: 0, scheduled: 3, arrived: 1 },
      rolling: { spend: 60, leads: 0, cpl: 0 },
      today: { spend: 25, leads: 0, cpl: 0 },
    }));
    expect(d.kind).toBe("pause");
  });
});

describe("decideCampaign — рост победителей", () => {
  const winner = snapshot({
    score: 80,
    rolling: { spend: 20, leads: 10, cpl: 2 },
    depth3Rate: 45,
  });

  it("качество, цена и глубина вместе дают рост бюджета", () => {
    const d = decideCampaign(winner);
    expect(d.kind).toBe("scale");
    if (d.kind === "scale") expect(d.newBudgetCents).toBe(1200);
  });

  it("низкая доля качественных лидов блокирует рост", () => {
    const d = decideCampaign({
      ...winner,
      quality: { total: 10, qualified: 3, rate: 30 },
    });
    expect(d.kind).not.toBe("scale");
  });

  it("мелкая глубина воронки блокирует рост", () => {
    expect(decideCampaign({ ...winner, depth3Rate: 10 }).kind).not.toBe("scale");
  });

  it("падающий тренд блокирует рост", () => {
    expect(decideCampaign({ ...winner, scoreTrend: "degrading" }).kind).not.toBe("scale");
  });

  it("новую кампанию не разгоняем", () => {
    expect(decideCampaign({ ...winner, daysActive: 3 }).kind).not.toBe("scale");
  });
});

describe("decideCampaign — остановки", () => {
  it("экстренная остановка при перерасходе за сегодня без лидов", () => {
    const d = decideCampaign(snapshot({
      today: { spend: 15, leads: 0, cpl: 0 },
      rolling: { spend: 20, leads: 1, cpl: 20 },
    }));
    expect(d.kind).toBe("pause");
    if (d.kind === "pause") {
      expect(d.scenario).toBe("vampires");
      expect(d.confidence).toBe("high");
    }
  });

  it("но не раньше суток работы — данных ещё нет", () => {
    const d = decideCampaign(snapshot({
      today: { spend: 15, leads: 0, cpl: 0 },
      rolling: { spend: 15, leads: 0, cpl: 0 },
      daysActive: 1,
      ageHours: 5,
    }));
    expect(d.kind).toBe("ok");
  });

  it("трёхдневный расход без лидов останавливает кампанию", () => {
    const d = decideCampaign(snapshot({
      rolling: { spend: 25, leads: 0, cpl: 0 },
      today: { spend: 3, leads: 0, cpl: 0 },
    }));
    expect(d.kind).toBe("pause");
    if (d.kind === "pause") expect(d.reason).toContain("0 лидов");
  });

  it("дешёвые, но мусорные лиды останавливаются по ai_score", () => {
    const d = decideCampaign(snapshot({
      rolling: { spend: 10, leads: 20, cpl: 0.5 },
      quality: { total: 20, qualified: 2, rate: 10 },
    }));
    expect(d.kind).toBe("pause");
    if (d.kind === "pause") expect(d.scenario).toBe("junk");
  });

  it("мало лидов — данным о качестве не верим", () => {
    const d = decideCampaign(snapshot({
      rolling: { spend: 10, leads: 3, cpl: 3.3 },
      quality: { total: 3, qualified: 0, rate: 0 },
    }));
    expect(d.kind).toBe("ok");
  });

  it("высокий CPL останавливает, если качество не защищает", () => {
    const d = decideCampaign(snapshot({
      rolling: { spend: 30, leads: 3, cpl: 10 },
      score: 50,
    }));
    expect(d.kind).toBe("pause");
    if (d.kind === "pause") expect(d.scenario).toBe("degradation");
  });

  it("высокое качество прощает высокий CPL", () => {
    const d = decideCampaign(snapshot({
      rolling: { spend: 30, leads: 3, cpl: 10 },
      score: 85,
    }));
    expect(d.kind).toBe("ok");
  });

  it("улучшающийся тренд защищает от паузы по CPL", () => {
    const d = decideCampaign(snapshot({
      rolling: { spend: 30, leads: 3, cpl: 10 },
      score: 50,
      cplTrend: "improving",
    }));
    expect(d.kind).toBe("protect");
  });

  it("кампания в льготном периоде защищена от паузы по качеству", () => {
    const d = decideCampaign(snapshot({
      rolling: { spend: 20, leads: 4, cpl: 5 },
      score: 30,
      daysActive: 3,
    }));
    expect(d.kind).toBe("protect");
    if (d.kind === "protect") expect(d.reason).toContain("3 дн.");
  });

  it("здоровая кампания не трогается", () => {
    expect(decideCampaign(snapshot()).kind).toBe("ok");
  });

  it("пороги можно ужесточить настройкой проекта", () => {
    const strict = { ...DEFAULT_THRESHOLDS, maxCpl: 1.5 };
    expect(decideCampaign(snapshot(), strict).kind).toBe("pause");
  });
});

describe("detectFatigue", () => {
  it("высокая частота показов — предупреждение", () => {
    const w = detectFatigue(
      snapshot({ rolling: { spend: 10, leads: 2, cpl: 5, frequency: 3.4, ctr: 1.2, impressions: 9000 } }),
      DEFAULT_THRESHOLDS,
    );
    expect(w).toContain("частота 3.4");
  });

  it("средняя частота плюс падение CTR — тоже предупреждение", () => {
    const w = detectFatigue(
      snapshot({
        rolling: { spend: 10, leads: 2, cpl: 5, frequency: 2.3, ctr: 2.0, impressions: 9000 },
        today: { spend: 2, leads: 0, cpl: 0, ctr: 1.0 },
      }),
      DEFAULT_THRESHOLDS,
    );
    expect(w).toContain("падает");
  });

  it("мало показов — выводы делать рано", () => {
    expect(detectFatigue(
      snapshot({ rolling: { spend: 1, leads: 0, cpl: 0, frequency: 5, ctr: 1, impressions: 100 } }),
      DEFAULT_THRESHOLDS,
    )).toBeNull();
  });

  it("здоровая кампания предупреждений не даёт", () => {
    expect(detectFatigue(snapshot(), DEFAULT_THRESHOLDS)).toBeNull();
  });
});

describe("buildReport", () => {
  it("утренний режим честно сообщает, что ничего не менял", () => {
    const text = buildReport({
      cabinetName: "Клиника",
      mode: "morning",
      outcomes: [{ campaign: snapshot(), decision: { kind: "ok" }, applied: false }],
      fatigueWarnings: [],
    });
    expect(text).toContain("Доброе утро");
    expect(text).toContain("только отчёт");
  });

  it("перечисляет остановки, рост и то, что не удалось применить", () => {
    const text = buildReport({
      cabinetName: "Клиника",
      mode: "night",
      outcomes: [
        {
          campaign: snapshot({ name: "A" }),
          decision: { kind: "pause", reason: "0 лидов", scenario: "vampires", confidence: "high" },
          applied: true,
        },
        {
          campaign: snapshot({ name: "B" }),
          decision: { kind: "scale", reason: "score 80", newBudgetCents: 1200, capUsd: 50 },
          applied: true,
        },
        {
          campaign: snapshot({ name: "C" }),
          decision: { kind: "pause", reason: "CPL", scenario: "degradation", confidence: "medium" },
          applied: false,
          error: "Meta: нет прав",
        },
      ],
      fatigueWarnings: ["D: частота 3.2"],
    });
    expect(text).toContain("Остановили:");
    expect(text).toContain("Подняли бюджет:");
    expect(text).toContain("Выгорание креатива:");
    expect(text).toContain("Не удалось применить:");
    expect(text).toContain("Meta: нет прав");
  });

  it("проблема с доступом выносится в начало", () => {
    const text = buildReport({
      cabinetName: "Клиника",
      mode: "night",
      outcomes: [],
      fatigueWarnings: [],
      healthAlert: "Нет доступа к кабинету",
    });
    expect(text.startsWith("Нет доступа к кабинету")).toBe(true);
  });

  it("когда делать нечего — так и пишет", () => {
    const text = buildReport({
      cabinetName: "Клиника",
      mode: "night",
      outcomes: [{ campaign: snapshot(), decision: { kind: "ok" }, applied: false }],
      fatigueWarnings: [],
    });
    expect(text).toContain("Все кампании в норме");
  });
});

describe("isAccessProblem", () => {
  it("узнаёт протухший токен и заблокированный кабинет", () => {
    expect(isAccessProblem("Error validating access token: Session has expired")).toBe(true);
    expect(isAccessProblem('{"code": 190}')).toBe(true);
    expect(isAccessProblem("Ad account is disabled")).toBe(true);
  });

  it("обычную ошибку за проблему доступа не принимает", () => {
    expect(isAccessProblem("Invalid parameter: daily_budget")).toBe(false);
  });
});
