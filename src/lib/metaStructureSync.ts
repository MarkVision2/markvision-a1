const META_SYNC_FUNCTION = "meta-structure-sync";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export interface MetaStructureSyncResult {
  ok: boolean;
  since: string;
  until: string;
  count?: number;
  results?: Array<{
    ok: boolean;
    cabinet: string;
    since?: string;
    until?: string;
    campaigns?: number;
    creatives?: number;
    campaign_daily?: number;
    creative_daily?: number;
    error?: string;
  }>;
  error?: string;
}

async function readResponseMessage(response: Response) {
  const text = await response.text();
  if (!text) return response.statusText || "Пустой ответ сервера";
  try {
    const body = JSON.parse(text) as { error?: string; message?: string; code?: string };
    return body.error || body.message || body.code || text;
  } catch {
    return text;
  }
}

export async function syncMetaStructure(params: { since: string; until: string }) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase не настроен: нет URL или publishable key");
  }

  const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${META_SYNC_FUNCTION}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      credentials: "omit",
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
        "content-type": "application/json",
        "x-client-info": "markvision-meta-sync",
      },
      body: JSON.stringify(params),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "браузер заблокировал запрос";
    throw new Error(`Не удалось отправить запрос в Meta-синхронизацию: ${message}`);
  }

  if (!response.ok) {
    const message = await readResponseMessage(response);
    throw new Error(`Meta-синхронизация вернула ошибку ${response.status}: ${message}`);
  }

  const data = (await response.json().catch(() => null)) as MetaStructureSyncResult | null;
  if (!data) throw new Error("Meta-синхронизация вернула пустой ответ");
  if (data.ok === false) throw new Error(data.error || "Meta-синхронизация не выполнена");

  return data;
}
