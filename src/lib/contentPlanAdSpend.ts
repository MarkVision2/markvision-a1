import { supabase } from "@/integrations/supabase/client";

/** Нормализация подписи для сопоставления organic post ↔ Meta creative body. */
export function normalizeAdCaptionKey(text: string | null | undefined, maxLen = 48): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»""„]/g, '"')
    .trim()
    .slice(0, maxLen);
}

async function sumSpendByAdIds(
  projectId: string,
  adToMedia: Map<string, string>,
  out: Map<string, number>,
): Promise<void> {
  if (adToMedia.size === 0) return;
  const adIds = Array.from(adToMedia.keys());
  const CHUNK = 100;
  for (let i = 0; i < adIds.length; i += CHUNK) {
    const chunk = adIds.slice(i, i + CHUNK);
    const { data: daily, error: dErr } = await supabase
      .from("meta_creative_daily" as never)
      .select("ad_id, spend")
      .eq("project_id", projectId)
      .in("ad_id", chunk);
    if (dErr || !Array.isArray(daily)) continue;
    for (const row of daily as unknown as Array<{ ad_id: string; spend: number | string | null }>) {
      const media = adToMedia.get(String(row.ad_id));
      if (!media) continue;
      const spend = Number(row.spend ?? 0);
      if (!Number.isFinite(spend) || spend <= 0) continue;
      out.set(media, (out.get(media) ?? 0) + spend);
    }
  }
}

/**
 * Сумма spend (₸) из meta_creative_daily по ads, привязанным к органическим
 * Instagram media через source_instagram_media_id / effective_instagram_media_id.
 * Fallback: совпадение primary_text креатива с подписью поста (content_plan / IG).
 */
export async function loadMetaAdSpendByIgMedia(
  projectId: string,
  igMediaIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = Array.from(new Set(igMediaIds.map((x) => String(x).trim()).filter(Boolean)));
  if (!projectId || ids.length === 0) return out;

  // 1) Прямая связка Graph: source / effective instagram media id
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
    if (error) break;
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
  await sumSpendByAdIds(projectId, adToMedia, out);

  const unmatched = ids.filter((id) => !out.has(id) || (out.get(id) ?? 0) <= 0);
  if (unmatched.length === 0) {
    for (const [k, v] of out) out.set(k, Math.round(v));
    return out;
  }

  // 2) Fallback по подписи поста ↔ body креатива
  const captionByMedia = new Map<string, string>();

  const { data: planRows } = await supabase
    .from("content_plan_items" as never)
    .select("ig_media_id, description, title")
    .eq("project_id", projectId)
    .in("ig_media_id", unmatched);
  for (const row of (planRows ?? []) as unknown as Array<{
    ig_media_id: string | null;
    description: string | null;
    title: string | null;
  }>) {
    if (!row.ig_media_id) continue;
    const key = normalizeAdCaptionKey(row.description || row.title);
    if (key.length >= 20) captionByMedia.set(String(row.ig_media_id), key);
  }

  const stillNeed = unmatched.filter((id) => !captionByMedia.has(id));
  if (stillNeed.length > 0) {
    const { data: igRows } = await supabase
      .from("instagram_media" as never)
      .select("media_id, caption")
      .eq("project_id", projectId)
      .in("media_id", stillNeed);
    for (const row of (igRows ?? []) as unknown as Array<{ media_id: string; caption: string | null }>) {
      const key = normalizeAdCaptionKey(row.caption);
      if (key.length >= 20) captionByMedia.set(String(row.media_id), key);
    }
  }

  if (captionByMedia.size === 0) {
    for (const [k, v] of out) out.set(k, Math.round(v));
    return out;
  }

  // Индекс caption → media (только уникальные ключи — иначе неоднозначность)
  const keyToMedia = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [media, key] of captionByMedia) {
    if (ambiguous.has(key)) continue;
    if (keyToMedia.has(key)) {
      keyToMedia.delete(key);
      ambiguous.add(key);
      continue;
    }
    keyToMedia.set(key, media);
  }

  const { data: allCreatives } = await supabase
    .from("meta_creatives" as never)
    .select("ad_id, primary_text")
    .eq("project_id", projectId)
    .not("primary_text", "is", null);

  const captionAdToMedia = new Map<string, string>();
  for (const c of (allCreatives ?? []) as unknown as Array<{ ad_id: string; primary_text: string | null }>) {
    const bodyKey = normalizeAdCaptionKey(c.primary_text);
    if (bodyKey.length < 20) continue;
    // Exact prefix match on normalized keys
    let media: string | undefined;
    for (const [capKey, mid] of keyToMedia) {
      if (bodyKey.startsWith(capKey) || capKey.startsWith(bodyKey.slice(0, Math.min(capKey.length, bodyKey.length)))) {
        // Require strong overlap: shared prefix ≥ 28 chars or exact start
        const shared = Math.min(capKey.length, bodyKey.length);
        const a = capKey.slice(0, shared);
        const b = bodyKey.slice(0, shared);
        if (a === b && shared >= 28) {
          media = mid;
          break;
        }
      }
    }
    if (!media || !c.ad_id) continue;
    // Не перетираем уже найденную Graph-связку другого media
    if (adToMedia.has(String(c.ad_id))) continue;
    captionAdToMedia.set(String(c.ad_id), media);
  }

  await sumSpendByAdIds(projectId, captionAdToMedia, out);

  for (const [k, v] of out) out.set(k, Math.round(v));
  return out;
}

/** Meta spend wins when > 0; otherwise keep manual content_plan_items.ad_spend. */
export function resolveContentPlanAdSpend(manual: number, meta: number | undefined): number {
  if (meta != null && meta > 0) return meta;
  return Number.isFinite(manual) && manual > 0 ? manual : 0;
}
