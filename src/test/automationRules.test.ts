import { describe, expect, it } from "vitest";
import { awaitingReply, pickStageMapRow, type StageMapRow } from "@/lib/automationRules";

describe("awaitingReply — условие дожима", () => {
  it("лид без исходящих не дожимается", () => {
    expect(awaitingReply({ last_outbound_at: null, last_inbound_at: null })).toBe(false);
    expect(awaitingReply({ last_outbound_at: null, last_inbound_at: "2026-08-01T10:00:00Z" })).toBe(false);
  });

  it("написали и ответа не было ни разу — дожимаем", () => {
    expect(awaitingReply({ last_outbound_at: "2026-08-01T10:00:00Z", last_inbound_at: null })).toBe(true);
  });

  it("клиент ответил после нашего сообщения — не дожимаем", () => {
    expect(
      awaitingReply({ last_outbound_at: "2026-08-01T10:00:00Z", last_inbound_at: "2026-08-01T10:05:00Z" }),
    ).toBe(false);
  });

  it("наш ответ последний — дожимаем", () => {
    expect(
      awaitingReply({ last_outbound_at: "2026-08-01T10:05:00Z", last_inbound_at: "2026-08-01T10:00:00Z" }),
    ).toBe(true);
  });

  it("одинаковые метки не считаются ожиданием ответа", () => {
    const t = "2026-08-01T10:00:00Z";
    expect(awaitingReply({ last_outbound_at: t, last_inbound_at: t })).toBe(false);
  });
});

describe("pickStageMapRow — приоритет проектного правила", () => {
  const global: StageMapRow = { capi_event: "Lead", is_paid: false, project_id: null };
  const scoped: StageMapRow = { capi_event: "Purchase", is_paid: true, project_id: "proj-a" };

  it("пусто → null", () => {
    expect(pickStageMapRow([], "proj-a")).toBeNull();
  });

  it("проектная строка перекрывает глобальную независимо от порядка", () => {
    expect(pickStageMapRow([global, scoped], "proj-a")).toBe(scoped);
    expect(pickStageMapRow([scoped, global], "proj-a")).toBe(scoped);
  });

  it("правило чужого проекта не применяется — берём глобальное", () => {
    expect(pickStageMapRow([{ ...scoped, project_id: "proj-b" }, global], "proj-a")).toBe(global);
  });

  it("чужое правило без глобального не подставляется", () => {
    expect(pickStageMapRow([{ ...scoped, project_id: "proj-b" }], "proj-a")).toBeNull();
  });

  it("без проекта берём только глобальное", () => {
    expect(pickStageMapRow([scoped, global], null)).toBe(global);
  });
});
