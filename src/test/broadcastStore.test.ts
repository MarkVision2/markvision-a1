import { beforeEach, describe, expect, it } from "vitest";
import {
  createBroadcast,
  emptyBroadcastDraft,
  parseContacts,
  readBroadcasts,
  removeBroadcast,
  renderMessage,
  updateBroadcast,
} from "@/lib/broadcastStore";
import { filterCrmContacts, resolveRecipients, summarizeBroadcasts } from "@/hooks/useBroadcasts";
import type { LeadContact } from "@/hooks/useLeadContacts";

const P = "bcast-test";

beforeEach(() => {
  localStorage.clear();
});

describe("parseContacts", () => {
  it("разбирает «Имя, номер» и просто номера, дедупит", () => {
    const list = parseContacts(
      [
        "Иван, +7 700 123 45 67",
        "Айгерим; +7 701 765 43 21",
        "+7 702 000 00 00",
        "дубль, +77001234567", // дубль первого
        "", // пустая
        "мусор без номера",
      ].join("\n"),
    );
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ name: "Иван", phone: "+77001234567" });
    expect(list[2].name).toBe("");
  });
});

describe("renderMessage", () => {
  it("подставляет имя и добавляет заголовок", () => {
    const out = renderMessage("Акция", "Привет, {имя}!", { name: "Пётр Иванов" });
    expect(out).toBe("*Акция*\n\nПривет, Пётр!");
  });
  it("работает без заголовка и без имени", () => {
    expect(renderMessage("", "Здравствуйте, {name}!", { name: "" })).toBe("Здравствуйте, !");
  });
});

describe("filterCrmContacts", () => {
  const contacts: LeadContact[] = [
    { id: "1", name: "A", phone: "+7700", source: "instagram", stageKey: "new" },
    { id: "2", name: "B", phone: "+7701", source: "whatsapp", stageKey: "paid" },
    { id: "3", name: "C", phone: "+7700", source: "instagram", stageKey: "new" }, // дубль телефона
    { id: "4", name: "D", phone: "", source: "instagram", stageKey: "new" }, // без телефона
  ];
  it("фильтрует по этапам и источникам, дедупит по телефону", () => {
    expect(filterCrmContacts(contacts, [], [])).toHaveLength(2); // 1 и 2 (3 дубль, 4 пустой)
    expect(filterCrmContacts(contacts, ["new"], [])).toHaveLength(1);
    expect(filterCrmContacts(contacts, [], ["whatsapp"])).toHaveLength(1);
    expect(filterCrmContacts(contacts, ["paid"], ["instagram"])).toHaveLength(0);
  });
});

describe("broadcast CRUD + summary", () => {
  // Уникальный project-id на каждый тест — in-memory кэш стора живёт между тестами.
  it("создаёт черновик и запланированную", () => {
    const pid = `${P}-create`;
    const draft = createBroadcast(pid, { ...emptyBroadcastDraft(), name: "Draft", message: "hi" });
    expect(draft.status).toBe("draft");

    const scheduled = createBroadcast(pid, {
      ...emptyBroadcastDraft(),
      name: "Sched",
      message: "hi",
      schedule: { mode: "scheduled", at: "2026-07-01T10:00" },
    });
    expect(scheduled.status).toBe("scheduled");

    expect(readBroadcasts(pid)).toHaveLength(2);
  });

  it("обновляет статистику и сводку", () => {
    const pid = `${P}-update`;
    const b = createBroadcast(pid, { ...emptyBroadcastDraft(), name: "B", message: "hi" });
    updateBroadcast(pid, b.id, { status: "sent", stats: { total: 5, sent: 4, delivered: 3, read: 2, replied: 1, failed: 1 } });
    const s = summarizeBroadcasts(readBroadcasts(pid));
    expect(s.total).toBe(1);
    expect(s.sent).toBe(1);
    expect(s.reached).toBe(4);
  });

  it("удаляет рассылку", () => {
    const pid = `${P}-remove`;
    const b = createBroadcast(pid, { ...emptyBroadcastDraft(), name: "B", message: "hi" });
    expect(readBroadcasts(pid)).toHaveLength(1);
    removeBroadcast(pid, b.id);
    expect(readBroadcasts(pid)).toHaveLength(0);
  });

  it("resolveRecipients берёт загруженный список для upload", () => {
    const pid = `${P}-resolve`;
    const uploaded = [{ name: "X", phone: "+7700" }];
    const b = createBroadcast(pid, {
      ...emptyBroadcastDraft(),
      name: "U",
      message: "hi",
      audienceSource: "upload",
      uploadedContacts: uploaded,
    });
    expect(resolveRecipients(b, [])).toEqual(uploaded);
  });
});
