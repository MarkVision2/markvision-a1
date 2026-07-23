import { supabase } from "@/integrations/supabase/client";

/**
 * Сумма spend (₸) из meta_creative_daily по ads, привязанным к органическим
 * Instagram media через source_instagram_media_id / effective_instagram_media_id.
 */
export async function loadMetaAdSpendByIgMedia(
  projectId: string,
  igMediaIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = Array.from(new Set(igMediaIds.map((x) => String(x).trim()).filter(Boolean)));
  if (!projectId || ids.length === 0) return out;

  // PostgREST .in.() — id как строки; чанками, чтобы не раздувать URL.
  const CHUNK = 80;
  const creativeRows: Array<{
    ad_id: string;
    source_instagram_media_id: string | null;
    effective_instagram_media_id: string | null;
  }> = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const listed = chunk.map((id) => `"${id.replace(/"/g, "")}"`).join(",");
    const { data: creatives, error } = await supabase
      .from("meta_creatives" as never)
      .select("ad_id, source_instagram_media_id, effective_instagram_media_id")
      .eq("project_id", projectId)
      .or(
        [
          `source_instagram_media_id.in.(${listed})`,
          `effective_instagram_media_id.in.(${listed})`,
        ].join(","),
      );
    if (error) return out;
    if (Array.isArray(creatives)) {
      creativeRows.push(
        ...(creatives as unknown as Array<{
          ad_id: string;
          source_instagram_media_id: string | null;
          effective_instagram_media_id: string | null;
        }>),
      );
    }
  }

  if (creativeRows.length === 0) return out;

  const adToMedia = new Map<string, string>();
  for (const c of creativeRows) {
    const media =
      (c.source_instagram_media_id && ids.includes(String(c.source_instagram_media_id))
        ? String(c.source_instagram_media_id)
        : null) ??
      (c.effective_instagram_media_id && ids.includes(String(c.effective_instagram_media_id))
        ? String(c.effective_instagram_media_id)
        : null);
    if (!media || !c.ad_id) continue;
    adToMedia.set(String(c.ad_id), media);
  }
  if (adToMedia.size === 0) return out;

  const adIds = Array.from(adToMedia.keys());
  const { data: daily, error: dErr } = await supabase
    .from("meta_creative_daily" as never)
    .select("ad_id, spend")
    .eq("project_id", projectId)
    .in("ad_id", adIds);

  if (dErr || !Array.isArray(daily)) return out;

  for (const row of daily as unknown as Array<{ ad_id: string; spend: number | string | null }>) {
    const media = adToMedia.get(String(row.ad_id));
    if (!media) continue;
    const spend = Number(row.spend ?? 0);
    if (!Number.isFinite(spend) || spend <= 0) continue;
    out.set(media, (out.get(media) ?? 0) + spend);
  }

  // Round to tenge
  for (const [k, v] of out) out.set(k, Math.round(v));
  return out;
}

/** Meta spend wins when > 0; otherwise keep manual content_plan_items.ad_spend. */
export function resolveContentPlanAdSpend(manual: number, meta: number | undefined): number {
  if (meta != null && meta > 0) return meta;
  return Number.isFinite(manual) && manual > 0 ? manual : 0;
}
