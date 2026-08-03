/**
 * Dual-write: после изменения в `ad_cabinets` зеркалим в `client_configs`
 * (тот же проект szfgdruhlebfvcmlvxdk). Туда смотрят n8n и content factory.
 *
 * Пишем через основной supabase-клиент (JWT пользователя) — отдельный
 * anon-клиент без сессии падал на RLS (`new row violates row-level security`).
 *
 * PK — `cabinet_id`. access_token лежит в той же таблице.
 */
import { supabase } from "@/integrations/supabase/client";
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
  type: c.type === "Агентский" ? "Агентский" : "Личный",
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
  if (!c?.id) return;
  const row = toClientRow(c);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("client_configs" as any) as any).upsert(row, {
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
  if (!id) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("client_configs" as any) as any)
      .delete()
      .eq("cabinet_id", id);
    if (error) throw error;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[cabinet-sync] не удалось удалить зеркало в client_configs:", e);
  }
}
