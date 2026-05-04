import { normalizePhone } from "./telephony";

/**
 * Open WhatsApp chat with a given phone, optionally pre-filling text.
 * Uses wa.me universal link — works without any API integration.
 */
export function openWhatsApp(phone: string, text?: string) {
  const digits = normalizePhone(phone).replace(/^\+/, "");
  if (!digits) return false;
  const url = new URL(`https://wa.me/${digits}`);
  if (text && text.trim()) url.searchParams.set("text", text.trim());
  window.open(url.toString(), "_blank", "noopener,noreferrer");
  return true;
}