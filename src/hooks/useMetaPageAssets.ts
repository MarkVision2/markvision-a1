import { useCallback, useEffect, useRef, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AssetKind = "whatsapp" | "pixels" | "pixel_events" | "lead_forms" | "pages" | "instagram";

export interface WhatsAppItem {
  id: string;
  display_phone_number: string;
  verified_name?: string;
}
export interface PixelItem {
  id: string;
  name: string;
  last_fired_time: string | null;
}
export interface PixelEventItem {
  name: string;
  count: number;
}
export interface LeadFormItem {
  id: string;
  name: string;
  status: string;
  leads_count: number;
}
export interface PageItem {
  id: string;
  name: string;
  category?: string;
  picture?: string;
  website?: string;
  instagram_id?: string;
  instagram_username?: string;
}
export interface InstagramItem {
  id: string;
  username?: string;
  name?: string;
}

const FALLBACK_PIXEL_EVENTS: PixelEventItem[] = [
  "Lead",
  "Purchase",
  "Contact",
  "CompleteRegistration",
  "Subscribe",
  "SubmitApplication",
  "AddToCart",
  "InitiateCheckout",
  "ViewContent",
  "Schedule",
].map((name) => ({ name, count: 0 }));

async function parseInvokeError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await (error.context as Response).json();
      if (body && typeof body === "object") {
        const detail =
          (body as { details?: { message?: string } }).details?.message ??
          (body as { error?: unknown }).error;
        if (detail) return String(detail);
      }
    } catch {
      /* ignore */
    }
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Ошибка запроса";
}

type ItemMap = {
  whatsapp: WhatsAppItem;
  pixels: PixelItem;
  pixel_events: PixelEventItem;
  lead_forms: LeadFormItem;
  pages: PageItem;
  instagram: InstagramItem;
};

interface Params {
  kind: AssetKind;
  actId?: string;
  pageId?: string;
  pixelId?: string;
  enabled?: boolean;
}

// 60s in-memory cache
const cache = new Map<string, { ts: number; data: any[] }>();
const TTL = 60_000;

export function useMetaPageAssets<K extends AssetKind>({
  kind,
  actId,
  pageId,
  pixelId,
  enabled = true,
}: Params & { kind: K }) {
  const [data, setData] = useState<ItemMap[K][]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const cacheKey = `${kind}|${actId ?? ""}|${pageId ?? ""}|${pixelId ?? ""}`;

  const fetchData = useCallback(
    async (force = false) => {
      if (!enabled) return;
      // Validate required params per kind
      if (kind === "whatsapp" && !pageId) return;
      if (kind === "pixels" && !actId) return;
      if (kind === "pixel_events" && (!pixelId || !actId)) return;
      if (kind === "lead_forms" && !pageId) return;
      if (kind === "pages" && !actId) return;

      const cached = cache.get(cacheKey);
      if (!force && cached && Date.now() - cached.ts < TTL) {
        setData(cached.data);
        return;
      }

      const myId = ++reqIdRef.current;
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ kind });
      if (actId) params.set("actId", actId);
      if (pageId) params.set("pageId", pageId);
      if (pixelId) params.set("pixelId", pixelId);

      const { data: resp, error: invokeErr } = await supabase.functions.invoke(
        `meta-page-assets?${params.toString()}`,
        { method: "GET" },
      );

      if (myId !== reqIdRef.current) return;

      if (invokeErr) {
        // Events list is optional UX: show standard Meta events so the wizard
        // stays usable even if the edge call fails (auth/Meta/network).
        if (kind === "pixel_events") {
          setError(null);
          setData(FALLBACK_PIXEL_EVENTS as ItemMap[K][]);
          setLoading(false);
          return;
        }
        setError(await parseInvokeError(invokeErr));
        setData([]);
        setLoading(false);
        return;
      }
      if (resp?.error) {
        if (kind === "pixel_events") {
          setError(null);
          setData(FALLBACK_PIXEL_EVENTS as ItemMap[K][]);
          setLoading(false);
          return;
        }
        const detail =
          resp.details?.message ?? resp.error ?? "Ошибка Meta API";
        setError(String(detail));
        setData([]);
        setLoading(false);
        return;
      }

      const items = (resp?.items ?? []) as ItemMap[K][];
      cache.set(cacheKey, { ts: Date.now(), data: items });
      setData(items);
      setLoading(false);
    },
    [cacheKey, kind, actId, pageId, pixelId, enabled],
  );

  useEffect(() => {
    fetchData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, enabled]);

  return { data, isLoading, error, refetch: () => fetchData(true) };
}
