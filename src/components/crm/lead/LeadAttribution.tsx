import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Megaphone, ExternalLink, Image as ImageIcon, Video, Layers, Play, BarChart3, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Lead } from "@/types/crm";
import { cn } from "@/lib/utils";

interface CreativeInfo {
  adId: string;
  name: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  posterUrl: string | null;
  videoUrl?: string | null;
  creativeType: string | null;
  effectiveStatus: string | null;
  campaignName?: string | null;
}

/**
 * Блок «Откуда пришёл лид» — показывает конкретный креатив Meta
 * (превью + название + кампания) с прямым переходом в карточку креатива
 * и в воронку по этому креативу.
 */
export function LeadAttribution({ lead }: { lead: Lead }) {
  const [info, setInfo] = useState<CreativeInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const adId = lead.metaAdId ?? null;
  const campaignId = lead.metaCampaignId ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!adId && !campaignId) {
      setInfo(null);
      return;
    }
    setLoading(true);
    (async () => {
      let creative: CreativeInfo | null = null;
      let creativeCampaignId: string | null = null;
      if (adId) {
        const { data, error } = await supabase
          .from("meta_creatives")
          .select("ad_id,name,thumbnail_url,image_url,video_url,creative_type,effective_status,campaign_id")
          .eq("ad_id", adId)
          .maybeSingle();
        if (error) console.warn("[LeadAttribution] meta_creatives fetch failed", error);
        if (data) {
          creative = {
            adId: data.ad_id,
            name: data.name,
            thumbnailUrl: data.thumbnail_url,
            imageUrl: data.image_url,
            posterUrl: data.thumbnail_url,
            videoUrl: data.video_url,
            creativeType: data.creative_type,
            effectiveStatus: data.effective_status,
          };
          creativeCampaignId = data.campaign_id ?? null;
        }
      }
      const campId = creativeCampaignId ?? campaignId;
      if (campId) {
        const { data: camp, error: campError } = await supabase
          .from("meta_campaigns")
          .select("name")
          .eq("campaign_id", campId)
          .maybeSingle();
        if (campError) console.warn("[LeadAttribution] meta_campaigns fetch failed", campError);
        if (camp && creative) creative.campaignName = camp.name;
        else if (camp && !creative) {
          creative = {
            adId: "",
            name: null,
            thumbnailUrl: null,
            imageUrl: null,
            posterUrl: null,
            creativeType: null,
            effectiveStatus: null,
            campaignName: camp.name,
          };
        }
      }
      if (!cancelled) {
        setInfo(creative);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [adId, campaignId, reloadKey]);

  if (!adId && !campaignId) return null;

  const thumb = info?.imageUrl || info?.thumbnailUrl || info?.posterUrl || null;
  const isVideo = info?.creativeType === "video";
  const isCarousel = info?.creativeType === "carousel";
  const TypeIcon = isVideo ? Video : isCarousel ? Layers : ImageIcon;
  const creativeHref = adId ? `/ads?tab=creatives&ad=${adId}` : null;
  const funnelHref = adId ? `/analytics/creatives?ad=${adId}` : null;
  const missingCreative = !!adId && !info?.name && !loading;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("meta-structure-sync", {});
      if (error) throw new Error(error.message);
      toast.success("Креативы синхронизированы");
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-primary/30 bg-primary/5">
      <div className="flex items-center gap-1.5 px-3 pt-2.5 text-[10px] uppercase tracking-wider text-primary">
        <Megaphone className="h-3 w-3" />
        Откуда пришёл лид
        {lead.paid && <span className="ml-1 rounded bg-success/15 px-1 text-success">и продажа</span>}
      </div>

      <div className="flex items-start gap-3 px-3 py-2.5">
        {/* Preview tile — clickable */}
        {creativeHref ? (
          <Link
            to={creativeHref}
            title="Открыть креатив"
            className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-secondary/40 ring-1 ring-border/40 transition hover:ring-primary"
          >
            {thumb ? (
              <img
                src={thumb}
                alt={info?.name ?? "creative"}
                className="h-full w-full object-cover transition group-hover:scale-105"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <TypeIcon className="h-7 w-7 text-muted-foreground/50" />
              </div>
            )}
            {isVideo && (
              <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-90 transition group-hover:opacity-100">
                <Play className="h-6 w-6 fill-white text-white drop-shadow" />
              </span>
            )}
            <span className="absolute right-1 bottom-1 grid h-4 w-4 place-items-center rounded bg-background/85 backdrop-blur">
              <TypeIcon className="h-2.5 w-2.5" />
            </span>
          </Link>
        ) : (
          <div className="grid h-20 w-20 shrink-0 place-items-center rounded-md bg-secondary/40 ring-1 ring-border/40">
            <TypeIcon className="h-7 w-7 text-muted-foreground/50" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-semibold leading-tight" title={info?.name ?? undefined}>
            {loading
              ? "Загружаем креатив…"
              : (info?.name || (adId ? `Креатив ${adId}` : "Креатив не найден"))}
          </div>
          {info?.campaignName && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground" title={info.campaignName}>
              Кампания: <span className="text-foreground/90">{info.campaignName}</span>
            </div>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
            {adId && (
              <code className="rounded bg-secondary/60 px-1 py-0.5 tabular-nums" title="ID объявления Meta">
                ad.id {adId}
              </code>
            )}
            {info?.effectiveStatus && (
              <span className={cn(
                "rounded px-1 py-0.5 font-bold uppercase",
                info.effectiveStatus === "ACTIVE" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
              )}>
                {info.effectiveStatus}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {creativeHref && (
              <Link
                to={creativeHref}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
              >
                Открыть креатив <ExternalLink className="h-3 w-3" />
              </Link>
            )}
            {funnelHref && (
              <Link
                to={funnelHref}
                className="inline-flex items-center gap-1 rounded-md bg-secondary/70 px-2 py-1 text-[11px] font-semibold hover:bg-secondary"
              >
                <BarChart3 className="h-3 w-3" /> Воронка
              </Link>
            )}
            {missingCreative && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-1 rounded-md bg-warning/20 px-2 py-1 text-[11px] font-semibold text-warning hover:bg-warning/30 disabled:opacity-60"
              >
                <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
                {syncing ? "Синхронизируем…" : "Подтянуть из Meta"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-primary/20 bg-primary/5 px-3 py-1.5 text-[10px] text-muted-foreground">
        {lead.paid
          ? <>Лид оплатил {lead.paidAt ? new Date(lead.paidAt).toLocaleDateString("ru-RU") : ""} — выручка зачисляется этому креативу в «Воронке по креативам».</>
          : <>Когда лид оплатит, продажа автоматически привяжется к этому креативу.</>}
      </div>
    </div>
  );
}
