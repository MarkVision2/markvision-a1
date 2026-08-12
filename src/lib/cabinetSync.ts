/**
 * Зеркало кабинета в `client_configs` ВНЕШНЕГО клиентского проекта
 * (туда смотрят n8n и контент-завод).
 *
 * Раньше запись шла напрямую из браузера в основной проект — там таблицы
 * client_configs нет, поэтому upsert молча падал и кабинеты не появлялись.
 * Теперь запись идёт через edge-функцию `client-config-sync`, которая пишет
 * сервисным ключом внешнего проекта.
 */
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AdCabinet } from "@/types/ads";

async function callSync(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("client-config-sync", { body });
  const payloadError = (data as { error?: string } | null)?.error;
  if (error || payloadError) {
    throw new Error(payloadError || (error instanceof Error ? error.message : "unknown"));
  }
}

/** Upsert строки в client_configs (всё включая access_token в одной таблице). */
export async function syncCabinetToClientConfig(c: AdCabinet): Promise<void> {
  if (!c?.id) return;
  try {
    await callSync({ cabinet_id: c.id, action: "upsert" });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[cabinet-sync] не удалось зеркалить в client_configs:", e);
    toast.error("Кабинет сохранён, но синк в client config упал", {
      description: e instanceof Error ? e.message : "Неизвестная ошибка",
    });
  }
}

/** Удаление зеркала в client_configs. */
export async function deleteCabinetFromClientConfig(
  id: string,
  projectId?: string | null,
): Promise<void> {
  if (!id) return;
  try {
    await callSync({ cabinet_id: id, action: "delete", project_id: projectId ?? undefined });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[cabinet-sync] не удалось удалить зеркало в client_configs:", e);
  }
}
