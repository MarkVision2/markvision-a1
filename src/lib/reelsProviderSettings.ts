import { supabase } from "@/integrations/supabase/client";

export type ReelsProvider = "pexels" | "kie";

export interface ReelsProviderState {
  connected: boolean;
  key_hint: string;
  enabled: boolean;
  updated_at: string;
}

export type ReelsProviderStatus = Partial<Record<ReelsProvider, ReelsProviderState>>;

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("reels-project-settings", { body });
  if (error) {
    // FunctionsHttpError прячет тело ответа в context — достаём реальную причину
    // (например «Kie.ai: ключ не принят»), а не общий «non-2xx status code».
    const context = (error as { context?: Response }).context;
    let detail = "";
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null);
      if (payload && typeof payload.error === "string") detail = payload.error;
    }
    throw detail ? new Error(detail) : error;
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function fetchReelsProviderStatus(projectId: string): Promise<ReelsProviderStatus> {
  if (!projectId) return {};
  const data = await call({ action: "status", project_id: projectId });
  return (data.providers ?? {}) as ReelsProviderStatus;
}

export async function saveReelsProviderKey(
  projectId: string,
  provider: ReelsProvider,
  apiKey: string,
): Promise<void> {
  await call({ action: "save", project_id: projectId, provider, api_key: apiKey });
}

export async function removeReelsProviderKey(
  projectId: string,
  provider: ReelsProvider,
): Promise<void> {
  await call({ action: "remove", project_id: projectId, provider });
}
