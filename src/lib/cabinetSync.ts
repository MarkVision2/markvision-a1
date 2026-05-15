/**
 * Dual-write: после изменения в `ad_cabinets` (main supabase) синхронно
 * пишем в `client_configs` (client config supabase, проект szfgdruhlebfvcmlvxdk).
 * Туда смотрят n8n воркфлоу и content factory.
 *
 * Если client config supabase не сконфигурирован (нет VITE_CLIENT_SUPABASE_*),
 * операции тихо пропускаются — приложение продолжает работать с одним БД.
 *
 * Ошибки sync НЕ роняют основную операцию: пишем в console.error и тост,
 * но callback к фронту получает успех (main supabase запись уже прошла).
 *
 * ВАЖНО: правильная таблица называется `client_configs` (множественное число
 * configs), а PK — `cabinet_id` (не `id`). Внутри той же таблицы лежит
 * `access_token` — отдельной таблицы для секретов нет.
 */
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { toast } from "sonner";
import type { AdCabinet } from "@/types/ads";

interface SyncedClientRow {
  cabinet_id: string;
  name: string;
  type: AdCabinet["type"];
  daily_budget: number | null;
  city: string | null;
  ad_account_id: string | null;
  page_id: string | null;
  page_name: string | null;
  instagram_id: string | null;
  access_token: string | null;
  telegram_group_id: string | null;
  whatsapp_number: string | null;
  pixel_id: string | null;
  pixel_event: string | null;
  website_url: string | null;
  brief: string | null;
}

const emptyToNull = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
};

const toClientRow = (c: AdCabinet): SyncedClientRow => ({
  cabinet_id: c.id,
  name: (c.name ?? "").trim() || "Без названия",
  type: c.type,
  daily_budget: c.dailyBudget ?? null,
  city: emptyToNull(c.city),
  ad_account_id: emptyToNull(c.adAccountId),
  page_id: emptyToNull(c.pageId),
  page_name: emptyToNull(c.pageName),
  instagram_id: emptyToNull(c.instagramId),
  access_token: emptyToNull(c.accessToken),
  telegram_group_id: emptyToNull(c.telegramGroupId),
  whatsapp_number: emptyToNull(c.whatsappNumber),
  pixel_id: emptyToNull(c.pixelId),
  pixel_event: emptyToNull(c.pixelEvent),
  website_url: emptyToNull(c.websiteUrl),
  brief: emptyToNull(c.brief),
});

/** Upsert строки в client_configs (всё включая access_token в одной таблице). */
export async function syncCabinetToClientConfig(c: AdCabinet): Promise<void> {
  if (!clientConfigSupabase) return;
  const sb = clientConfigSupabase;
  const row = toClientRow(c);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb.from("client_configs") as any).upsert(row, {
      onConflict: "cabinet_id",
    });
    if (error) throw error;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[cabinet-sync] не удалось зеркалить в client_configs:", e);
    toast.error("Кабинет сохранён, но синк в client config упал", {
      description: e instanceof Error ? e.message : "Неизвестная ошибка",
    });
  }
}

/** Удаление зеркала в client_configs. */
export async function deleteCabinetFromClientConfig(id: string): Promise<void> {
  if (!clientConfigSupabase) return;
  const sb = clientConfigSupabase;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb.from("client_configs") as any).delete().eq("cabinet_id", id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[cabinet-sync] не удалось удалить зеркало в client_configs:", e);
  }
}
