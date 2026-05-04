/**
 * Telephony layer with 3 providers configurable in admin:
 *  - tel    → системный звонок (tel:)
 *  - sip    → SIP-URI для софтфона (sip:)
 *  - sipuni → click-to-call через edge function sipuni-call
 */
import { supabase } from "@/integrations/supabase/client";

export type DialProvider = "tel" | "sip" | "sipuni";

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
  cachedProvider = ["tel", "sip", "sipuni"].includes(p) ? p : "tel";
  cachedAt = Date.now();
  return cachedProvider;
}

export function invalidateTelephonyCache() {
  cachedProvider = null;
  cachedAt = 0;
}

function openUri(uri: string) {
  window.location.href = uri;
}

/** Initiate a call. Always falls back to tel: on failure. */
export async function dial(phone: string, opts?: { leadId?: string }): Promise<DialResult> {
  const digits = normalizePhone(phone);
  if (!phone || digits.length < 4) {
    return { ok: false, provider: "tel", error: "Нет корректного номера" };
  }

  const provider = await getTelephonyProvider();

  if (provider === "tel") {
    openUri(`tel:${digits}`);
    return { ok: true, provider: "tel" };
  }

  if (provider === "sip") {
    openUri(`sip:${digits}`);
    return { ok: true, provider: "sip" };
  }

  // sipuni
  try {
    const { data, error } = await supabase.functions.invoke("sipuni-call", {
      body: { phone: digits, leadId: opts?.leadId },
    });
    if (error || !data?.ok) {
      openUri(`tel:${digits}`);
      return {
        ok: true,
        provider: "tel",
        warning: `Sipuni: ${(data?.error as string) ?? error?.message ?? "ошибка"}. Открыт системный звонок.`,
      };
    }
    return { ok: true, provider: "sipuni" };
  } catch (e) {
    openUri(`tel:${digits}`);
    return {
      ok: true,
      provider: "tel",
      warning: "Sipuni недоступен — открыт системный звонок.",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}