/** Discover Facebook Page / Instagram used by an ad account from live creatives. */
const META_API_VERSION = "v21.0";

export type InferredCabinetAssets = {
  page_id: string | null;
  page_name: string | null;
  instagram_id: string | null;
  pixel_id: string | null;
  pixel_event: string | null;
  website_url: string | null;
};

async function metaGet(path: string, token: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const url =
    `https://graph.facebook.com/${META_API_VERSION}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  return r.json().catch(() => ({}));
}

function normalizeActId(id: string): string {
  const t = String(id ?? "").trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

/**
 * When promote_pages / adspixels are empty (common for partner / poorly linked
 * Business Manager setups), recover page + IG (+ optional pixel) from recent ads.
 */
export async function inferCabinetAssetsFromAds(
  actId: string,
  token: string,
): Promise<InferredCabinetAssets> {
  const act = normalizeActId(actId);
  const out: InferredCabinetAssets = {
    page_id: null,
    page_name: null,
    instagram_id: null,
    pixel_id: null,
    pixel_event: null,
    website_url: null,
  };
  if (!act || !token) return out;

  const pageCounts = new Map<string, number>();
  const igCounts = new Map<string, number>();
  const pixelCounts = new Map<string, { count: number; event: string | null }>();

  const ads = await metaGet(
    `/${act}/ads?fields=id,name,status,creative{object_story_spec,actor_id},adset{promoted_object}&limit=50`,
    token,
  );
  for (const ad of ads?.data ?? []) {
    const cr = ad?.creative ?? {};
    const oss = cr?.object_story_spec ?? {};
    const pageId = String(oss?.page_id || cr?.actor_id || "").trim();
    if (pageId) pageCounts.set(pageId, (pageCounts.get(pageId) ?? 0) + 1);
    const ig = String(oss?.instagram_user_id || oss?.instagram_actor_id || "").trim();
    if (ig) igCounts.set(ig, (igCounts.get(ig) ?? 0) + 1);
    const po = ad?.adset?.promoted_object ?? {};
    const pixelId = String(po?.pixel_id || "").trim();
    if (pixelId) {
      const prev = pixelCounts.get(pixelId) ?? { count: 0, event: null };
      pixelCounts.set(pixelId, {
        count: prev.count + 1,
        event: po?.custom_event_type ? String(po.custom_event_type) : prev.event,
      });
    }
  }

  // Also scan adsets directly (covers paused creatives / incomplete ad objects).
  const adsets = await metaGet(
    `/${act}/adsets?fields=id,promoted_object&limit=50`,
    token,
  );
  for (const set of adsets?.data ?? []) {
    const po = set?.promoted_object ?? {};
    const pageId = String(po?.page_id || "").trim();
    if (pageId) pageCounts.set(pageId, (pageCounts.get(pageId) ?? 0) + 1);
    const pixelId = String(po?.pixel_id || "").trim();
    if (pixelId) {
      const prev = pixelCounts.get(pixelId) ?? { count: 0, event: null };
      pixelCounts.set(pixelId, {
        count: prev.count + 1,
        event: po?.custom_event_type ? String(po.custom_event_type) : prev.event,
      });
    }
  }

  const topKey = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  out.page_id = topKey(pageCounts);
  out.instagram_id = topKey(igCounts);
  const topPixel = [...pixelCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (topPixel) {
    out.pixel_id = topPixel[0];
    out.pixel_event = topPixel[1].event;
  }

  if (out.page_id) {
    const page = await metaGet(
      `/${out.page_id}?fields=id,name,website,instagram_business_account{id,username}`,
      token,
    );
    if (page?.name) out.page_name = String(page.name);
    if (page?.website) out.website_url = String(page.website);
    const igFromPage = page?.instagram_business_account?.id;
    if (!out.instagram_id && igFromPage) out.instagram_id = String(igFromPage);
  }

  if (!out.page_name && out.page_id) {
    const camps = await metaGet(
      `/${act}/campaigns?fields=name&limit=5`,
      token,
    );
    const firstName = String(camps?.data?.[0]?.name ?? "");
    // "InDesign / 11.11 / Трафик / Инст" → "InDesign"
    const hint = firstName.split("/")[0]?.trim();
    out.page_name = hint || `Страница ${out.page_id}`;
  }

  return out;
}
