import { useEffect, useRef, useState } from "react";
import { Copy, Eye, Loader2, MessageCircle, MousePointerClick, Play, RefreshCw, ShoppingBag, Target, TrendingUp, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";
import { useCreativeFunnel } from "@/hooks/useCreativeFunnel";

const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

interface Props {
  row: MetaCreativeRow;
  campaignName?: string | null;
  goalLabel?: string | null;
  isWhatsApp?: boolean;
  range: { from: Date; to: Date };
  onClose: () => void;
}

function MetricBox({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums", accent)}>{value}</div>
    </div>
  );
}

export function CreativeExpanded({ row, campaignName, goalLabel, isWhatsApp, range, onClose }: Props) {
  const { data: funnel } = useCreativeFunnel(row.adId, range);
  const isVideo = row.creativeType === "video";
  const [videoUrl, setVideoUrl] = useState<string | null>(row.videoUrl);
  const [refreshing, setRefreshing] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { setVideoUrl(row.videoUrl); setVideoError(false); }, [row.id, row.videoUrl]);

  const refreshVideo = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-creative-refresh", {
        body: { ad_id: row.adId },
      });
      if (error) throw error;
      const url = (data as { video_url?: string })?.video_url;
      if (!url) throw new Error("Не удалось получить ссылку на видео");
      setVideoUrl(url);
      setVideoError(false);
      toast.success("Превью видео обновлено");
      // Force reload
      requestAnimationFrame(() => videoRef.current?.load());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось обновить превью");
    } finally {
      setRefreshing(false);
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(row.adId).catch(() => {});
    toast.success("ID объявления скопирован");
  };

  const romiClass = row.romi >= 0 ? "text-success" : "text-destructive";
  const poster = row.thumbnailUrl || row.imageUrl || undefined;

  return (
    <div className="col-span-full overflow-hidden rounded-2xl border border-primary/40 bg-card/80 shadow-xl ring-1 ring-primary/20 animate-fade-in-up">
      <div className="grid gap-0 lg:grid-cols-[minmax(280px,420px)_1fr]">
        {/* Media */}
        <div className="relative aspect-[9/16] w-full bg-black lg:aspect-auto">
          {isVideo && videoUrl && !videoError ? (
            <video
              ref={videoRef}
              src={videoUrl}
              poster={poster}
              controls
              playsInline
              preload="none"
              className="h-full w-full object-contain"
              onError={() => setVideoError(true)}
            />
          ) : poster ? (
            <img src={poster} alt={row.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground">
              <Play className="h-10 w-10" />
            </div>
          )}
          {isVideo && (videoError || !videoUrl) && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-background/85 p-2 text-xs backdrop-blur">
              <span className="text-muted-foreground">
                {videoError ? "Ссылка на видео истекла" : "Видео ещё не загружено"}
              </span>
              <Button size="sm" variant="outline" onClick={refreshVideo} disabled={refreshing} className="h-7">
                {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Обновить
              </Button>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {goalLabel && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-primary">
                    <Target className="h-3 w-3" /> {goalLabel}
                  </span>
                )}
                {isWhatsApp && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-1.5 py-0.5 text-success">
                    <MessageCircle className="h-3 w-3" /> WhatsApp
                  </span>
                )}
                {(row.effectiveStatus ?? "").toUpperCase() === "ACTIVE" ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-1.5 py-0.5 text-success">● Активно</span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5">{row.effectiveStatus ?? "—"}</span>
                )}
              </div>
              <h3 className="text-base font-bold leading-tight">{row.name || "Без названия"}</h3>
              {campaignName && (
                <div className="text-xs text-muted-foreground">Кампания: <span className="text-foreground">{campaignName}</span></div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {(row.headline || row.primaryText) && (
            <div className="space-y-2 rounded-lg border border-border/40 bg-secondary/20 p-3">
              {row.headline && (
                <div className="text-sm font-semibold">{row.headline}</div>
              )}
              {row.primaryText && (
                <div className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{row.primaryText}</div>
              )}
              {row.cta && (
                <div className="inline-flex rounded-md bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                  {row.cta}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricBox label="Расход" value={row.spend > 0 ? fmtTenge(row.spend) : "—"} />
            <MetricBox label="Показы" value={fmtNum(row.impressions)} />
            <MetricBox label="Клики" value={fmtNum(row.clicks)} />
            <MetricBox label="CTR" value={row.ctr > 0 ? `${row.ctr.toFixed(2)}%` : "—"} />
            <MetricBox label={isWhatsApp ? "Сообщения" : "Заявки"} value={fmtNum(isWhatsApp ? row.messages : row.leads)} accent="text-success" />
            <MetricBox label="Цена результата" value={row.cpl > 0 ? fmtTenge(row.cpl) : "—"} />
            <MetricBox label="CPM" value={row.cpm > 0 ? fmtTenge(row.cpm) : "—"} />
            <MetricBox label="CPC" value={row.cpc > 0 ? fmtTenge(row.cpc) : "—"} />
            <MetricBox
              label="ROMI"
              value={row.spend > 0 ? `${row.romi >= 0 ? "+" : ""}${Math.round(row.romi)}%` : "—"}
              accent={row.spend > 0 ? romiClass : undefined}
            />
          </div>

          {/* === Сквозная аналитика CRM === */}
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
              <TrendingUp className="h-3.5 w-3.5" />
              Сквозная аналитика
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricBox label="Лидов CRM" value={fmtNum(row.crmLeads)} />
              <MetricBox label="Продаж" value={fmtNum(row.crmSales)} accent="text-success" />
              <MetricBox label="Выручка CRM" value={fmtTenge(row.crmRevenue)} accent="text-success" />
              <MetricBox
                label="ROMI CRM"
                value={row.spend > 0 ? `${row.crmRomi >= 0 ? "+" : ""}${Math.round(row.crmRomi)}%` : "—"}
                accent={row.spend > 0 ? (row.crmRomi >= 0 ? "text-success" : "text-destructive") : undefined}
              />
              <MetricBox label="CPL CRM" value={row.crmCpl > 0 ? fmtTenge(row.crmCpl) : "—"} />
              <MetricBox label="CPS (цена продажи)" value={row.crmCps > 0 ? fmtTenge(row.crmCps) : "—"} />
              <MetricBox label="Средний чек" value={row.crmAvgCheck > 0 ? fmtTenge(row.crmAvgCheck) : "—"} />
              <MetricBox
                label="Прибыль"
                value={row.spend > 0 ? fmtTenge(row.crmProfit) : "—"}
                accent={row.spend > 0 ? (row.crmProfit >= 0 ? "text-success" : "text-destructive") : undefined}
              />
            </div>

            {/* Воронка по этапам пайплайна */}
            {funnel && funnel.stages.length > 0 && funnel.total_leads > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Воронка по этапам
                </div>
                {funnel.stages.map((s) => {
                  const pct = funnel.total_leads > 0 ? (s.count / funnel.total_leads) * 100 : 0;
                  return (
                    <div key={s.stage_id} className="flex items-center gap-2 text-xs">
                      <div className="w-32 shrink-0 truncate text-muted-foreground" title={s.title}>
                        {s.title}
                      </div>
                      <div className="relative h-5 flex-1 overflow-hidden rounded bg-secondary/40">
                        <div
                          className={cn(
                            "h-full transition-all",
                            s.is_terminal && s.key === "paid" ? "bg-success" : s.is_terminal ? "bg-destructive/60" : "bg-primary/60",
                          )}
                          style={{ width: `${Math.max(pct, s.count > 0 ? 4 : 0)}%` }}
                        />
                        <div className="absolute inset-0 flex items-center justify-end px-2 text-[10px] font-bold tabular-nums">
                          {s.count} · {pct.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Последние лиды с этого креатива */}
            {funnel && funnel.recent_leads.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Users className="h-3 w-3" />
                  Последние лиды ({funnel.total_leads})
                </div>
                <div className="space-y-1">
                  {funnel.recent_leads.slice(0, 6).map((l) => (
                    <a
                      key={l.id}
                      href={`/crm?lead=${l.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card/60 px-2 py-1 text-xs hover:border-primary/40"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">{l.name}</span>
                        <span className="ml-2 text-muted-foreground">{l.phone}</span>
                      </span>
                      {l.paid ? (
                        <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
                          Оплата · {fmtTenge(l.amount)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {new Date(l.created_at).toLocaleDateString("ru-RU")}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {(!funnel || funnel.total_leads === 0) && (
              <div className="rounded-md border border-dashed border-border/60 bg-card/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                В CRM пока нет лидов с этого креатива.{" "}
                {isWhatsApp
                  ? "Для CTWA-кампаний атрибуция придёт автоматически с первым входящим WhatsApp."
                  : "Проверьте, что в UTM лендинга есть utm_content={{ad.id}} или передаётся ad_id."}
              </div>
            )}
          </div>

          {(row.purchases > 0 || row.revenue > 0) && (
            <div className="grid grid-cols-2 gap-2">
              <MetricBox label="Meta-покупок" value={fmtNum(row.purchases)} />
              <MetricBox label="Meta-выручка" value={fmtTenge(row.revenue)} accent="text-success" />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
            <div className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> {fmtNum(row.impressions)}</span>
              <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3 w-3" /> {fmtNum(row.clicks)}</span>
              {row.purchases > 0 && (
                <span className="inline-flex items-center gap-1"><ShoppingBag className="h-3 w-3" /> {fmtNum(row.purchases)}</span>
              )}
            </div>
            <button onClick={copyId} className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 hover:bg-secondary/40">
              <Copy className="h-3 w-3" /> ID {row.adId}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
