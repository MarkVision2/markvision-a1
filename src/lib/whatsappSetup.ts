/** CRM ingress — Green API must point here (single webhook URL). */
export function getCrmWebhookUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
  return `${base}/functions/v1/greenapi-webhook`;
}

export function isValidBotWebhookUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "169.254.169.254") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const WHATSAPP_SETUP_STEPS = [
  { id: "bind", title: "Привязать инстанс к проекту", hint: "idInstance + apiToken из Green API Console" },
  { id: "auth", title: "Авторизовать WhatsApp", hint: "QR-код или код по номеру телефона" },
  { id: "webhook", title: "Webhook CRM", hint: "Green API → наш greenapi-webhook" },
  { id: "bot", title: "Бот n8n (опционально)", hint: "Копия событий на ваш workflow" },
] as const;
