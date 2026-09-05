/** Общий безопасный GET/POST JSON для коннекторов: сеть отвалилась — это не «пост не найден». */
export async function callJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown; networkError?: string }> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, networkError: e instanceof Error ? e.message : String(e) };
  }
}

/** Ошибка Meta Graph (Instagram / Threads) из тела ответа. */
export function graphError(body: unknown): { code: number; message: string } | null {
  const err = (body as { error?: { code?: number; message?: string } } | null)?.error;
  if (!err || typeof err !== "object") return null;
  return { code: Number(err.code ?? 0), message: String(err.message ?? "") };
}

/** Граф Instagram по форме токена: Instagram Login → graph.instagram.com, Page token → graph.facebook.com. */
export function instagramGraph(token: string): string {
  return /^IG/i.test(token) ? "https://graph.instagram.com/v21.0" : "https://graph.facebook.com/v21.0";
}
