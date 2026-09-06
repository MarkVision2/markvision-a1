/**
 * Тонкий клиент публичного API MarkVision (edge-функция `api`, docs/PUBLIC-API.md).
 * Без зависимостей от MCP — его же можно дёргать из скриптов и тестов.
 */
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

export interface ClientOptions {
  apiKey: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (/\/functions\/v1\/api\/v1$/.test(trimmed)) return trimmed;
  if (/\/functions\/v1\/api$/.test(trimmed)) return `${trimmed}/v1`;
  if (/\.supabase\.co$/.test(trimmed)) return `${trimmed}/functions/v1/api/v1`;
  return trimmed;
}

export interface UploadResult {
  file_url: string;
  size: number;
  content_type: string;
}

export class MarkVisionClient {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: ClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const obj = (parsed ?? {}) as Record<string, unknown>;
    if (!res.ok || typeof obj.error === "string") {
      throw new ApiError(typeof obj.error === "string" ? obj.error : `HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    return obj as T;
  }

  me() { return this.request<{ project: { id: string; name: string | null }; key: { name: string; scopes: string[] } }>("GET", "/me"); }
  accounts(opts: { limit?: number; offset?: number; q?: string; platform?: string; group_id?: string; status?: string } = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) if (v != null && v !== "") q.set(k, String(v));
    const qs = q.toString();
    return this.request<{ accounts: unknown[]; total?: number; has_more?: boolean }>("GET", `/accounts${qs ? `?${qs}` : ""}`);
  }
  bulkUpdateAccounts(accountIds: string[], patch: Record<string, unknown>) {
    return this.request<{ updated: number; missing: number }>("POST", "/accounts/bulk", { account_ids: accountIds, patch });
  }
  calendar(opts: { from: string; to: string; group_id?: string; account_ids?: string[] }) {
    const q = new URLSearchParams({ from: opts.from, to: opts.to });
    if (opts.group_id) q.set("group_id", opts.group_id);
    if (opts.account_ids?.length) q.set("account_ids", opts.account_ids.join(","));
    return this.request<{ accounts: unknown[]; jobs: unknown[]; truncated: boolean }>("GET", `/calendar?${q}`);
  }
  groups() { return this.request<{ groups: unknown[] }>("GET", "/groups"); }
  publications(limit = 20) { return this.request<{ publications: unknown[] }>("GET", `/publications?limit=${limit}`); }
  publication(id: string) { return this.request<{ publication: unknown }>("GET", `/publications/${id}`); }
  createPublication(input: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", "/publications", input); }
  createJobs(id: string, target: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", `/publications/${id}/jobs`, target); }
  distribute(input: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", "/publications/distribute", input); }
  cancelJob(id: string) { return this.request<Record<string, unknown>>("POST", `/jobs/${id}/cancel`); }
  retryJob(id: string) { return this.request<Record<string, unknown>>("POST", `/jobs/${id}/retry`); }

  updateAccount(id: string, patch: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", `/accounts/${id}`, patch); }
  healthCheck(accountIds?: string[]) {
    return this.request<Record<string, unknown>>("POST", "/accounts/health-check", accountIds?.length ? { account_ids: accountIds } : {});
  }
  createGroup(input: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", "/groups", input); }
  updateGroup(id: string, patch: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", `/groups/${id}`, patch); }
  deleteGroup(id: string) { return this.request<Record<string, unknown>>("POST", `/groups/${id}/delete`); }
  settings() { return this.request<Record<string, unknown>>("GET", "/settings"); }
  updateSettings(patch: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", "/settings", patch); }
  jobs(status?: string, limit = 100, offset = 0, extra: { video_id?: string; account_id?: string; campaign_id?: string } = {}) {
    const q = new URLSearchParams({ limit: String(limit), ...(status ? { status } : {}), ...(offset ? { offset: String(offset) } : {}) });
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return this.request<{ jobs: unknown[] }>("GET", `/jobs?${q}`);
  }
  metrics() { return this.request<Record<string, unknown>>("GET", "/metrics"); }
  job(id: string) { return this.request<Record<string, unknown>>("GET", `/jobs/${id}`); }
  contentAnalytics(opts: { limit?: number; winners?: boolean } = {}) {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 50), ...(opts.winners ? { winners: "1" } : {}) });
    return this.request<{ content: unknown[] }>("GET", `/analytics/content?${q}`);
  }
  contentAnalyticsItem(id: string) { return this.request<Record<string, unknown>>("GET", `/analytics/content/${id}`); }
  accountAnalytics(id: string) { return this.request<Record<string, unknown>>("GET", `/analytics/accounts/${id}`); }
  notifications(opts: { limit?: number; unread?: boolean } = {}) {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 50), ...(opts.unread ? { unread: "1" } : {}) });
    return this.request<{ notifications: unknown[]; unread: number }>("GET", `/notifications?${q}`);
  }
  readNotification(id: string) { return this.request<Record<string, unknown>>("POST", `/notifications/${id}/read`); }

  campaigns() { return this.request<{ campaigns: unknown[]; metrics: unknown[] }>("GET", "/campaigns"); }
  campaign(id: string) { return this.request<Record<string, unknown>>("GET", `/campaigns/${id}`); }
  createCampaign(input: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", "/campaigns", input); }
  updateCampaign(id: string, patch: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", `/campaigns/${id}`, patch); }
  campaignAddItems(id: string, videoIds: string[]) { return this.request<Record<string, unknown>>("POST", `/campaigns/${id}/items`, { video_ids: videoIds }); }
  campaignRemoveItems(id: string, videoIds: string[]) { return this.request<Record<string, unknown>>("POST", `/campaigns/${id}/items-remove`, { video_ids: videoIds }); }
  campaignAction(id: string, action: "start" | "pause" | "complete" | "archive" | "plan") { return this.request<Record<string, unknown>>("POST", `/campaigns/${id}/${action}`); }
  webhooks() { return this.request<{ webhooks: unknown[] }>("GET", "/webhooks"); }
  createWebhook(input: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", "/webhooks", input); }
  updateWebhook(id: string, patch: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", `/webhooks/${id}`, patch); }
  deleteWebhook(id: string) { return this.request<Record<string, unknown>>("POST", `/webhooks/${id}/delete`); }
  webhookDeliveries(id: string) { return this.request<{ deliveries: unknown[] }>("GET", `/webhooks/${id}/deliveries`); }
  dailyReport() { return this.request<{ report: unknown }>("GET", "/reports/daily"); }
  members() { return this.request<{ members: unknown[] }>("GET", "/members"); }
  routines() { return this.request<{ routines: unknown[]; groups: unknown[]; accounts: unknown[] }>("GET", "/routines"); }
  createRoutine(input: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", "/routines", input); }
  updateRoutine(id: string, patch: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", `/routines/${id}`, patch); }
  assignRoutine(id: string, target: { group_ids?: string[]; account_ids?: string[] }) { return this.request<Record<string, unknown>>("POST", `/routines/${id}/assign`, target); }
  insights(days = 30) { return this.request<{ insights: unknown }>("GET", `/analytics/insights?days=${days}`); }
  contentItems(opts: { status?: string; roots?: boolean; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.status) q.set("status", opts.status);
    if (opts.roots) q.set("roots", "1");
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return this.request<{ items: unknown[] }>("GET", `/content${qs ? `?${qs}` : ""}`);
  }
  createVariations(itemId: string, groupIds: string[]) {
    return this.request<Record<string, unknown>>("POST", `/content/${itemId}/variants`, { group_ids: groupIds });
  }
  tasks(status?: string, limit = 100) {
    const q = new URLSearchParams({ limit: String(limit), ...(status ? { status } : {}) });
    return this.request<{ tasks: unknown[] }>("GET", `/tasks?${q}`);
  }

  /** Файл с диска → presigned URL → PUT байтов напрямую в хранилище → публичная ссылка. */
  async uploadFile(filePath: string): Promise<UploadResult> {
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw new ApiError(`файл не найден: ${filePath}`, 400);
    const contentType = contentTypeFor(filePath);
    const presign = await this.request<{ upload_url: string; file_url: string }>("POST", "/media/upload-url", {
      filename: basename(filePath), size: info.size, content_type: contentType,
    });
    const blob = await openAsBlob(filePath, { type: contentType });
    const put = await this.fetchFn(presign.upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
    if (!put.ok) throw new ApiError(`хранилище отклонило файл: HTTP ${put.status}`, put.status);
    return { file_url: presign.file_url, size: info.size, content_type: contentType };
  }
}
