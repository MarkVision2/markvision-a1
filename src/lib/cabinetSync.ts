/**
 * Dual-write: после изменения в `ad_cabinets` (main supabase) синхронно
 * пишем в `clients_config` + `clients_secrets` (client config supabase,
 * проект szfgdruhlebfvcmlvxdk). Туда смотрят n8n воркфлоу и content factory.
 *
 * Если client config supabase не сконфигурирован (нет VITE_CLIENT_SUPABASE_*),
 * операции тихо пропускаются — приложение продолжает работать с одним БД.
 *
 * Ошибки sync НЕ роняют основную операцию: пишем в console.error и тост,
 * но callback к фронту получает успех (main supabase запись уже прошла).
 */
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { toast } from "sonner";
import type { AdCabinet } from "@/types/ads";

interface SyncedClientRow {
  id: string;
  client_name: string;
  is_active: boolean;
  type: AdCabinet["type"];
  daily_budget: number | null;
  currency: string;
  city: string | null;
  ad_account_id: string | null;
  page_id: string | null;
  page_name: string | null;
  instagram_id: string | null;
  whatsapp_number: string | null;
  telegram_group_id: string | null;
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
  id: c.id,
  client_name: (c.name ?? "").trim(),
  is_active: !!c.online,
  type: c.type,
  daily_budget: c.dailyBudget ?? null,
  currency: c.currency ?? "KZT",
  city: emptyToNull(c.city),
  ad_account_id: emptyToNull(c.adAccountId),
  page_id: emptyToNull(c.pageId),
  page_name: emptyToNull(c.pageName),
  instagram_id: emptyToNull(c.instagramId),
  whatsapp_number: emptyToNull(c.whatsappNumber),
  telegram_group_id: emptyToNull(c.telegramGroupId),
  pixel_id: emptyToNull(c.pixelId),
  pixel_event: emptyToNull(c.pixelEvent),
  website_url: emptyToNull(c.websiteUrl),
  brief: emptyToNull(c.brief),
});

/** Upsert строки в clients_config + clients_secrets (если есть fb_token). */
export async function syncCabinetToClientConfig(c: AdCabinet): Promise<void> {
  if (!clientConfigSupabase) return;
  const sb = clientConfigSupabase;
  const row = toClientRow(c);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb.from("clients_config") as any).upsert(row, {
      onConflict: "id",
    });
    if (error) throw error;

    if (c.accessToken && c.accessToken.trim().length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: secErr } = await (sb.from("clients_secrets") as any).upsert(
        {
          client_id: c.id,
          fb_token: c.accessToken,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id" },
      );
      if (secErr) throw secErr;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[cabinet-sync] не удалось зеркалить в client config:", e);
    toast.error("Кабинет сохранён, но синк в client config упал", {
      description: e instanceof Error ? e.message : "Неизвестная ошибка",
    });
  }
}

/** Удаление зеркала в clients_config (и связанные secrets). */
export async function deleteCabinetFromClientConfig(id: string): Promise<void> {
  if (!clientConfigSupabase) return;
  const sb = clientConfigSupabase;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb.from("clients_secrets") as any).delete().eq("client_id", id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb.from("clients_config") as any).delete().eq("id", id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[cabinet-sync] не удалось удалить зеркало в client config:", e);
  }
}
