// Движок отправки рассылок.
//
// WhatsApp — реальная отправка через edge function greenapi-proxy, последовательно
// с троттлингом (чтобы не упереться в лимиты Green-API и не словить бан номера).
// SMS — пока не подключён провайдер: вернём понятную ошибку, кампания сохранится
// как запланированная.

import { supabase } from "@/integrations/supabase/client";
import { renderMessage, type BroadcastChannel, type BroadcastContact, type BroadcastResult } from "./broadcastStore";

const THROTTLE_MS = 1200; // пауза между сообщениями

const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export class SmsNotConnectedError extends Error {
  constructor() {
    super("SMS-провайдер не подключён");
    this.name = "SmsNotConnectedError";
  }
}

/** Одна WhatsApp-отправка через greenapi-proxy. Бросает при ошибке.
 *  Если передан buttonUrl — уходит interactive URL-кнопка (CTA). */
export async function sendWhatsAppMessage(
  phone: string,
  message: string,
  opts?: { buttonUrl?: string; buttonText?: string; header?: string },
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("greenapi-proxy", {
    body: {
      action: "sendMessage",
      phone,
      message,
      buttonUrl: opts?.buttonUrl || undefined,
      buttonText: opts?.buttonText || undefined,
      header: opts?.header || undefined,
    },
  });
  if (error) throw new Error(error.message || "Ошибка отправки");
  const res = data as { ok?: boolean; status?: number; error?: string } | null;
  if (!res?.ok) {
    throw new Error(res?.error || `Green-API вернул статус ${res?.status ?? "?"}`);
  }
}

export type SendProgress = {
  index: number;
  total: number;
  result: BroadcastResult;
};

export type SendOptions = {
  channel: BroadcastChannel;
  contacts: BroadcastContact[];
  title: string;
  message: string;
  /** Колбэк прогресса после каждого получателя. */
  onProgress?: (p: SendProgress) => void;
  /** Возвращает true, если нужно прервать рассылку. */
  shouldCancel?: () => boolean;
  throttleMs?: number;
};

export type SendSummary = {
  results: BroadcastResult[];
  sent: number;
  failed: number;
  canceled: boolean;
};

/**
 * Последовательно отправляет сообщение каждому получателю с троттлингом.
 * Не бросает на единичных ошибках — копит их в результатах.
 */
export async function runBroadcast(opts: SendOptions): Promise<SendSummary> {
  const { channel, contacts, title, message, onProgress, shouldCancel } = opts;
  const throttle = opts.throttleMs ?? THROTTLE_MS;

  if (channel === "sms") {
    throw new SmsNotConnectedError();
  }

  const results: BroadcastResult[] = [];
  let sent = 0;
  let failed = 0;
  let canceled = false;

  for (let i = 0; i < contacts.length; i++) {
    if (shouldCancel?.()) {
      canceled = true;
      break;
    }
    const c = contacts[i];
    const text = renderMessage(title, message, c);
    let result: BroadcastResult;
    try {
      await sendWhatsAppMessage(c.phone, text);
      sent++;
      result = { phone: c.phone, name: c.name, status: "sent", at: new Date().toISOString() };
    } catch (e) {
      failed++;
      result = {
        phone: c.phone,
        name: c.name,
        status: "failed",
        error: e instanceof Error ? e.message : "Ошибка",
        at: new Date().toISOString(),
      };
    }
    results.push(result);
    onProgress?.({ index: i, total: contacts.length, result });

    if (i < contacts.length - 1 && !shouldCancel?.()) {
      await delay(throttle);
    }
  }

  return { results, sent, failed, canceled };
}
