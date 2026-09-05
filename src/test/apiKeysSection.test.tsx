/**
 * «API-ключи»: список с состояниями, выдача с показом ключа один раз,
 * отзыв через подтверждение. Ключ нигде не должен всплывать повторно.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiKeysSection, apiBaseUrl, apiKeyState, mcpConfigSnippet } from "@/components/publishing/ApiKeysSection";
import type { ApiKey } from "@/lib/publishingClient";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiKeyList = vi.fn();
const apiKeyCreate = vi.fn();
const apiKeyRevoke = vi.fn();
vi.mock("@/lib/publishingClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publishingClient")>();
  return {
    ...actual,
    publishingApi: {
      ...actual.publishingApi,
      apiKeyList: (...a: unknown[]) => apiKeyList(...a),
      apiKeyCreate: (...a: unknown[]) => apiKeyCreate(...a),
      apiKeyRevoke: (...a: unknown[]) => apiKeyRevoke(...a),
    },
  };
});

const key = (id: string, name: string, extra: Partial<ApiKey> = {}): ApiKey => ({
  id, name, key_prefix: `mv_live_${id}xxxx`, scopes: ["read", "publish"], created_at: "2026-09-01T10:00:00Z",
  last_used_at: null, expires_at: null, revoked_at: null, ...extra,
});

beforeEach(() => {
  apiKeyList.mockReset().mockResolvedValue({ keys: [key("a", "Claude MCP"), key("b", "Старый", { revoked_at: "2026-09-02T00:00:00Z" })] });
  apiKeyCreate.mockReset();
  apiKeyRevoke.mockReset().mockResolvedValue({ ok: true });
});

describe("apiKeyState", () => {
  it("активен, отозван, истёк", () => {
    const now = Date.parse("2026-09-05T00:00:00Z");
    expect(apiKeyState({ revoked_at: null, expires_at: null }, now)).toBe("active");
    expect(apiKeyState({ revoked_at: "2026-09-01T00:00:00Z", expires_at: null }, now)).toBe("revoked");
    expect(apiKeyState({ revoked_at: null, expires_at: "2026-09-04T00:00:00Z" }, now)).toBe("expired");
    expect(apiKeyState({ revoked_at: null, expires_at: "2026-09-06T00:00:00Z" }, now)).toBe("active");
  });
});

describe("конфиг MCP", () => {
  it("адрес API строится от базы Supabase, ключ попадает в env", () => {
    expect(apiBaseUrl("https://x.supabase.co/")).toBe("https://x.supabase.co/functions/v1/api/v1");
    const cfg = JSON.parse(mcpConfigSnippet("mv_live_abc", "https://x.supabase.co"));
    expect(cfg.mcpServers.markvision.command).toBe("node");
    expect(cfg.mcpServers.markvision.args[0]).toMatch(/mcp\/markvision\/dist\/index\.js$/);
    expect(cfg.mcpServers.markvision.env).toEqual({ MARKVISION_API_KEY: "mv_live_abc", MARKVISION_API_URL: "https://x.supabase.co/functions/v1/api/v1" });
  });
});

describe("ApiKeysSection", () => {
  it("без проекта не рисуется, с проектом грузит список", async () => {
    const { container, rerender } = render(<ApiKeysSection projectId={null} />);
    expect(container.firstChild).toBeNull();
    rerender(<ApiKeysSection projectId="p1" />);
    await waitFor(() => expect(apiKeyList).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("Claude MCP")).toBeTruthy();
    expect(screen.getByText("Отозван")).toBeTruthy();
    // отозванный ключ отозвать повторно нельзя
    expect(screen.getByRole("button", { name: "Отозвать Claude MCP" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отозвать Старый" })).toBeNull();
  });

  it("создание показывает ключ один раз и очищает форму", async () => {
    apiKeyCreate.mockResolvedValue({ key: "mv_live_SECRET_VALUE", api_key: key("c", "Новый") });
    render(<ApiKeysSection projectId="p1" />);
    await screen.findByText("Claude MCP");
    fireEvent.change(screen.getByLabelText("Название ключа"), { target: { value: "  Новый  " } });
    fireEvent.click(screen.getByRole("button", { name: /Создать ключ/ }));
    await waitFor(() => expect(apiKeyCreate).toHaveBeenCalledWith("p1", { name: "Новый", scopes: ["read", "publish", "manage"] }));
    expect((await screen.findByTestId("api-key-value")).textContent).toBe("mv_live_SECRET_VALUE");
    expect((screen.getByLabelText("Название ключа") as HTMLInputElement).value).toBe("");
    expect(apiKeyList).toHaveBeenCalledTimes(2);
  });

  it("пустое имя — ключ не создаётся", async () => {
    render(<ApiKeysSection projectId="p1" />);
    await screen.findByText("Claude MCP");
    fireEvent.click(screen.getByRole("button", { name: /Создать ключ/ }));
    expect(apiKeyCreate).not.toHaveBeenCalled();
  });

  it("отзыв идёт через подтверждение", async () => {
    render(<ApiKeysSection projectId="p1" />);
    await screen.findByText("Claude MCP");
    fireEvent.click(screen.getByRole("button", { name: "Отозвать Claude MCP" }));
    expect(apiKeyRevoke).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Отозвать" }));
    await waitFor(() => expect(apiKeyRevoke).toHaveBeenCalledWith("p1", "a"));
  });
});
