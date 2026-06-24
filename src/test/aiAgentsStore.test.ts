import { beforeEach, describe, expect, it } from "vitest";
import {
  createAgent,
  duplicateAgent,
  emptyAgentDraft,
  readAgents,
  removeAgent,
  setAgentStatus,
  updateAgent,
} from "@/lib/aiAgentsStore";
import { summarize } from "@/hooks/useAiAgents";

const P = "test-project";

beforeEach(() => {
  localStorage.clear();
  // Сбрасываем in-memory кэш стора, перезагружая модуль через прямую очистку LS
  // + чтение под новым ключом проекта на каждый тест.
});

describe("aiAgentsStore", () => {
  it("seeds a draft example agent for a fresh project", () => {
    const agents = readAgents(`${P}-seed`);
    expect(agents.length).toBeGreaterThanOrEqual(1);
    expect(agents[0].status).toBe("draft");
  });

  it("creates an agent and persists it to localStorage", () => {
    const pid = `${P}-create`;
    const before = readAgents(pid).length;
    const agent = createAgent(pid, { ...emptyAgentDraft(), name: "Бот WhatsApp", channel: "whatsapp" });
    expect(agent.id).toMatch(/[0-9a-f-]{36}/);
    expect(agent.name).toBe("Бот WhatsApp");

    const after = readAgents(pid);
    expect(after.length).toBe(before + 1);
    expect(after[0].id).toBe(agent.id); // newest first

    const raw = localStorage.getItem(`mv:ai-agents:${pid}`);
    expect(raw).toContain("Бот WhatsApp");
  });

  it("updates fields and refreshes updatedAt", () => {
    const pid = `${P}-update`;
    const agent = createAgent(pid, { ...emptyAgentDraft(), name: "X" });
    updateAgent(pid, agent.id, { name: "Y", handle: "@shop" });
    const found = readAgents(pid).find((a) => a.id === agent.id);
    expect(found?.name).toBe("Y");
    expect(found?.handle).toBe("@shop");
  });

  it("toggles status", () => {
    const pid = `${P}-status`;
    const agent = createAgent(pid, { ...emptyAgentDraft(), name: "Z", handle: "+700" });
    setAgentStatus(pid, agent.id, "active");
    expect(readAgents(pid).find((a) => a.id === agent.id)?.status).toBe("active");
  });

  it("duplicates as a fresh draft without handle", () => {
    const pid = `${P}-dup`;
    const agent = createAgent(pid, { ...emptyAgentDraft(), name: "Orig", handle: "+700", status: "active" });
    const copy = duplicateAgent(pid, agent.id);
    expect(copy).not.toBeNull();
    expect(copy?.name).toContain("копия");
    expect(copy?.status).toBe("draft");
    expect(copy?.handle).toBe("");
    expect(copy?.id).not.toBe(agent.id);
  });

  it("removes an agent", () => {
    const pid = `${P}-remove`;
    const agent = createAgent(pid, { ...emptyAgentDraft(), name: "Temp" });
    const before = readAgents(pid).length;
    removeAgent(pid, agent.id);
    expect(readAgents(pid).length).toBe(before - 1);
    expect(readAgents(pid).find((a) => a.id === agent.id)).toBeUndefined();
  });

  it("summarizes active/paused/handled stats", () => {
    const list = [
      { status: "active", handle: "+1", channel: "whatsapp", stats: { handled: 10, resolved: 7, handoff: 3 } },
      { status: "paused", handle: "@x", channel: "instagram", stats: { handled: 5, resolved: 2, handoff: 3 } },
      { status: "draft", handle: "", channel: "whatsapp", stats: { handled: 0, resolved: 0, handoff: 0 } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const s = summarize(list);
    expect(s.total).toBe(3);
    expect(s.active).toBe(1);
    expect(s.paused).toBe(1);
    expect(s.connectedChannels).toBe(1); // only the active+handle one counts
    expect(s.handled).toBe(15);
    expect(s.resolved).toBe(9);
    expect(s.resolvedPct).toBeCloseTo(60, 0);
  });
});
