/**
 * Слой телефонии.
 *
 * Binotel подключается НА УРОВНЕ ПРОЕКТА: у каждого проекта своя АТС, и если она
 * подключена — звонок идёт через неё, минуя глобальный выбор. Остальные варианты
 * остаются общими для всех проектов:
 *  - tel    → системный звонок (tel:)
 *  - sip    → SIP-URI для софтфона (sip:)
 *  - sipuni → click-to-call через edge function sipuni-call
 */
import { supabase } from "@/integrations/supabase/client";

export type DialProvider = "tel" | "sip" | "sipuni" | "binotel";

export type DialResult = {
  ok: boolean;
  provider: DialProvider;
  warning?: string;
  error?: string;
};

export function normalizePhone(raw: string): string {
  return (raw ?? "").replace(/[^\d+]/g, "");
}

let cachedProvider: DialProvider | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

export async function getTelephonyProvider(): Promise<DialProvider> {
  if (cachedProvider && Date.now() - cachedAt < CACHE_MS) return cachedProvider;
  const { data } = await (supabase.from("automation_settings" as any) as any)
    .select("telephony_provider").eq("id", true).single();
  const p = (data?.telephony_provider as DialProvider) ?? "tel";
  cachedProvider = ["tel", "sip", "sipuni", "binotel"].includes(p) ? p : "tel";
  cachedAt = Date.now();
  return cachedProvider;
}

/** Подключён ли Binotel в проекте. Кэш на проект, чтобы не дёргать базу на каждый клик. */
const binotelByProject = new Map<string, { value: boolean; at: number }>();

export async function projectHasBinotel(projectId?: string | null): Promise<boolean> {
  if (!projectId) return false;
  const hit = binotelByProject.get(projectId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const { data } = await (supabase.from("project_binotel_settings_safe" as any) as any)
    .select("enabled, credentials_present").eq("project_id", projectId).maybeSingle();
  const value = Boolean(data?.enabled && data?.credentials_present);
  binotelByProject.set(projectId, { value, at: Date.now() });
  return value;
}

/** Какой провайдер сработает для лида этого проекта. */
export async function resolveDialProvider(projectId?: string | null): Promise<DialProvider> {
  if (await projectHasBinotel(projectId)) return "binotel";
  return getTelephonyProvider();
}

export function invalidateTelephonyCache() {
  cachedProvider = null;
  cachedAt = 0;
  binotelByProject.clear();
}

function openUri(uri: string) {
  window.location.href = uri;
}

/** Initiate a call. Always falls back to tel: on failure. */
export async function dial(
  phone: string,
  opts?: { leadId?: string; projectId?: string | null },
): Promise<DialResult> {
  const digits = normalizePhone(phone);
  if (!phone || digits.length < 4) {
    return { ok: false, provider: "tel", error: "Нет корректного номера" };
  }

  const provider = await resolveDialProvider(opts?.projectId);

  if (provider === "tel") {
    openUri(`tel:${digits}`);
    return { ok: true, provider: "tel" };
  }

  if (provider === "sip") {
    openUri(`sip:${digits}`);
    return { ok: true, provider: "sip" };
  }

  // АТС (sipuni / binotel): звонок инициирует бэкенд, при любой осечке — tel:
  const pbx = provider === "binotel"
    ? { fn: "binotel-call", label: "Binotel" }
    : { fn: "sipuni-call", label: "Sipuni" };

  try {
    const { data, error } = await supabase.functions.invoke(pbx.fn, {
      body: { phone: digits, leadId: opts?.leadId },
    });
    if (error || !data?.ok) {
      openUri(`tel:${digits}`);
      return {
        ok: true,
        provider: "tel",
        warning: `${pbx.label}: ${(data?.detail as string) ?? (data?.error as string) ?? error?.message ?? "ошибка"}. Открыт системный звонок.`,
      };
    }
    return { ok: true, provider };
  } catch (e) {
    openUri(`tel:${digits}`);
    return {
      ok: true,
      provider: "tel",
      warning: `${pbx.label} недоступен — открыт системный звонок.`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}