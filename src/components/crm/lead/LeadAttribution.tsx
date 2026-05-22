import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Megaphone, ExternalLink, Image as ImageIcon, Video, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/types/crm";
import { cn } from "@/lib/utils";

interface CreativeInfo {
  adId: string;
  name: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  posterUrl: string | null;
  creativeType: string | null;
  effectiveStatus: string | null;
  campaignName?: string | null;
}

/**
 * Блок «Откуда пришёл лид» — показывает конкретный креатив Meta (картинка/видео + название),
 * кампанию и кнопку перехода в карточку креатива. Если оплата произошла — этот же креатив
 * считается источником продажи.
 */
export function LeadAttribution({ lead }: { lead: Lead }) {
  const [info, setInfo] = useState<CreativeInfo | null>(null);
  const [loading, setLoading] = useState(false);

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
          .select("ad_id,name,thumbnail_url,image_url,poster_url,creative_type,effective_status,campaign_id")
          .eq("ad_id", adId)
          .maybeSingle();
        if (error) console.warn("[LeadAttribution] meta_creatives fetch failed", error);
        if (data) {
          creative = {
            adId: data.ad_id,
            name: data.name,
            thumbnailUrl: data.thumbnail_url,
            imageUrl: data.image_url,
            posterUrl: data.poster_url,
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
  }, [adId, campaignId]);

  // Нет ad_id и нет campaign_id — атрибуции к Meta нет, ничего не показываем
  if (!adId && !campaignId) return null;

  const thumb = info?.posterUrl || info?.imageUrl || info?.thumbnailUrl || null;
  const Icon = info?.creativeType === "video" ? Video : info?.creativeType === "carousel" ? Layers : ImageIcon;

  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
        <Megaphone className="h-3 w-3" />
        Откуда пришёл лид {lead.paid && <span className="ml-1 rounded bg-success/15 px-1 text-success">и продажа</span>}
      </div>

      <div className="mt-2 flex items-start gap-2.5">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-secondary/40 ring-1 ring-border/40">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Icon className="h-5 w-5 text-muted-foreground/50" />
            </div>
          )}
          <span className="absolute right-0.5 bottom-0.5 grid h-4 w-4 place-items-center rounded bg-background/80 backdrop-blur">
            <Icon className="h-2.5 w-2.5" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-xs font-semibold leading-tight" title={info?.name ?? undefined}>
            {loading ? "Загружаем креатив…" : (info?.name || (adId ? `Креатив ${adId}` : "Креатив не найден в синхр."))}
          </div>
          {info?.campaignName && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground" title={info.campaignName}>
              Кампания: <span className="text-foreground/80">{info.campaignName}</span>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
            {adId && (
              <code className="rounded bg-secondary/60 px-1 tabular-nums" title="ID объявления Meta">
                ad.id {adId}
              </code>
            )}
            {info?.effectiveStatus && (
              <span className={cn(
                "rounded px-1 font-bold uppercase",
                info.effectiveStatus === "ACTIVE" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
              )}>
                {info.effectiveStatus}
              </span>
            )}
            {adId && (
              <Link
                to={`/ads?tab=creatives&ad=${adId}`}
                className="inline-flex items-center gap-0.5 rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary hover:bg-primary/25"
              >
                Открыть креатив <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            )}
            {adId && (
              <Link
                to={`/analytics/creatives`}
                className="inline-flex items-center gap-0.5 rounded bg-secondary/60 px-1.5 py-0.5 font-semibold hover:bg-secondary"
              >
                Воронка по креативу
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 border-t border-primary/20 pt-1.5 text-[10px] text-muted-foreground">
        {lead.paid
          ? <>Лид оплатил {lead.paidAt ? new Date(lead.paidAt).toLocaleDateString("ru-RU") : ""} — выручка автоматически зачисляется этому креативу в «Воронке по креативам».</>
          : <>Когда лид оплатит, продажа автоматически привяжется к этому креативу.</>}
      </div>
    </div>
  );
}
