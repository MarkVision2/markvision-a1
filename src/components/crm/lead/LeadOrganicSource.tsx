import { useEffect, useState } from "react";
import { ExternalLink, Film, Hash, Instagram } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/types/crm";

interface OrganicSource {
  codeword: string;
  reelUrl: string | null;
  reelId: string | null;
  occurredAt: string;
  igHandle: string | null;
  attribution: "explicit" | "late_match" | null;
}

// Если лид пришёл по органическому код-слову — показываем «Reel → код-слово»
// над UTM-полосой. Источник данных: events.event_type='lead' join codewords +
// project_instagram_accounts.
export function LeadOrganicSource({ lead }: { lead: Lead }) {
  const [src, setSrc] = useState<OrganicSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("instagram_organic_events")
        .select("codeword, reel_url, reel_id, occurred_at, ig_account_id, payload")
        .eq("lead_id", lead.id)
        .eq("event_type", "lead")
        .order("occurred_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const row = (data ?? [])[0] as
        | { codeword: string | null; reel_url: string | null; reel_id: string | null; occurred_at: string; ig_account_id: string | null; payload: Record<string, unknown> | null }
        | undefined;
      if (!row?.codeword) { setSrc(null); return; }
      let igHandle: string | null = null;
      if (row.ig_account_id) {
        const { data: acc } = await supabase
          .from("project_instagram_accounts")
          .select("handle")
          .eq("id", row.ig_account_id)
          .maybeSingle();
        igHandle = (acc as { handle?: string } | null)?.handle ?? null;
      }
      if (cancelled) return;
      setSrc({
        codeword: row.codeword,
        reelUrl: row.reel_url,
        reelId: row.reel_id,
        occurredAt: row.occurred_at,
        igHandle,
        attribution: (row.payload?.attribution as "explicit" | "late_match" | undefined) ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [lead.id]);

  if (!src) return null;

  return (
    <div className="rounded-2xl border border-pink-500/30 bg-pink-500/5 p-3.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-pink-600">
        <Instagram className="h-3.5 w-3.5" /> Источник: органический Instagram
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1">
          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono font-semibold">{src.codeword}</span>
        </span>
        {src.igHandle && (
          <a
            href={`https://instagram.com/${src.igHandle}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <Instagram className="h-3.5 w-3.5 text-muted-foreground" />@{src.igHandle}
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
        )}
        {src.reelUrl && (
          <a
            href={src.reelUrl}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <Film className="h-3.5 w-3.5 text-muted-foreground" />Reel
            <ExternalLink className="h-3 w-3 opacity-50" />
          </a>
        )}
        {src.attribution === "late_match" && (
          <span className="text-[11px] text-muted-foreground">атрибуция по контакту</span>
        )}
      </div>
    </div>
  );
}
