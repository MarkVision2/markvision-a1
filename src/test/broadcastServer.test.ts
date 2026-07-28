import { describe, it, expect } from "vitest";
import { canonicalPhone, resolveRecipientRows } from "@/lib/broadcastServer";
import { emptyBroadcastDraft } from "@/lib/broadcastStore";
import type { LeadContact } from "@/hooks/useLeadContacts";

describe("canonicalPhone", () => {
  it("сводит к формату +<цифры>", () => {
    expect(canonicalPhone("+7 (701) 234-56-78")).toBe("+77012345678");
    expect(canonicalPhone("77012345678")).toBe("+77012345678");
    expect(canonicalPhone(" 8 701 234 56 78 ")).toBe("+87012345678");
  });
  it("отсекает невалидные по длине", () => {
    expect(canonicalPhone("123")).toBe("");
    expect(canonicalPhone("1234567890123456")).toBe("");
    expect(canonicalPhone("")).toBe("");
  });
});

describe("resolveRecipientRows", () => {
  const crm: LeadContact[] = [
    { id: "1", name: "Иван", phone: "+7 701 111 22 33", source: "instagram", stageKey: "new" },
    { id: "2", name: "Пётр", phone: "77014445566", source: "whatsapp", stageKey: "paid" },
    { id: "3", name: "Дубль", phone: "+77011112233", source: "instagram", stageKey: "new" }, // дубль #1
    { id: "4", name: "Плохой", phone: "123", source: "instagram", stageKey: "new" }, // невалидный
  ];

  it("CRM: фильтр по этапу + дедуп + отсев невалидных + lead_id", () => {
    const draft = { ...emptyBroadcastDraft(), audienceSource: "crm" as const, crmFilter: { stageKeys: ["new"], sources: [] } };
    const rows = resolveRecipientRows(draft, crm);
    expect(rows).toHaveLength(1); // #1 (дубль #3 убран, #4 невалиден, #2 не в этапе)
    expect(rows[0]).toEqual({ name: "Иван", phone: "+77011112233", lead_id: "1" });
  });

  it("CRM без фильтра — все валидные уникальные", () => {
    const draft = { ...emptyBroadcastDraft(), audienceSource: "crm" as const };
    const rows = resolveRecipientRows(draft, crm);
    expect(rows.map((r) => r.phone).sort()).toEqual(["+77011112233", "+77014445566"]);
  });

  it("upload: канонизация и дедуп загруженного списка", () => {
    const draft = {
      ...emptyBroadcastDraft(),
      audienceSource: "upload" as const,
      uploadedContacts: [
        { name: "A", phone: "+7 700 000 00 00" },
        { name: "B", phone: "77000000000" }, // дубль A
        { name: "C", phone: "+7 700 111 11 11" },
      ],
    };
    const rows = resolveRecipientRows(draft, []);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.lead_id === null)).toBe(true);
  });

  it("upload: имя из CRM если в списке пусто", () => {
    const draft = {
      ...emptyBroadcastDraft(),
      audienceSource: "upload" as const,
      uploadedContacts: [{ name: "", phone: "+7 701 111 22 33" }],
    };
    const rows = resolveRecipientRows(draft, crm);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: "Иван", phone: "+77011112233", lead_id: "1" });
  });
});
