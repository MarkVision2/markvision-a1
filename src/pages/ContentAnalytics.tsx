import { useMemo, useState } from "react";
import { Camera, Copy, ExternalLink, Hash, Instagram, Loader2, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";
import { InstagramOrganicFunnel } from "@/components/dashboard/InstagramOrganicFunnel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InstagramAnalyticsPanel } from "@/components/content/InstagramAnalyticsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCodewordLeads,
  useCodewordStats,
  useInstagramCodewords,
  useInstagramOrganic,
} from "@/hooks/useInstagramOrganic";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { ContentTrendChart } from "@/pages/content-analytics/ContentTrendChart";
import { cn } from "@/lib/utils";
import { igOrganicBotLink } from "@/lib/igOrganicLinks";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

export default function ContentAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "instagram" ? "instagram" : "codewords";
  const setActiveTab = (tab: string) => {
    setSearchParams(tab === "instagram" ? { tab: "instagram" } : {}, { replace: true });
  };

  const [range, setRange] = useState<ReportPeriodRange>(() => currentMonthRange());
  const { events, funnel, loading, error } = useInstagramOrganic(range);
  const { stats, loading: statsLoading } = useCodewordStats();
  const { items, add, loading: wordsLoading } = useInstagramCodewords();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailCodewordId, setDetailCodewordId] = useState<string | null>(null);
  const { rows: leadRows, loading: leadsLoading } = useCodewordLeads(detailCodewordId);

  const [draft, setDraft] = useState({
    codeword: "",
    reelUrl: "",
    targetUrl: "",
    thumbnailUrl: "",
    caption: "",
  });
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    return stats.reduce(
      (acc, s) => ({
        sales: acc.sales + s.sales,
        revenue: acc.revenue + s.revenue,
      }),
      { sales: 0, revenue: 0 },
    );
  }, [stats]);

  const handleAdd = async () => {
    if (!draft.codeword.trim()) {
      toast.error("Введите код-слово");
      return;
    }
    if (!draft.targetUrl.trim()) {
      toast.error("Укажите Target URL — страницу оффера");
      return;
    }
    setSaving(true);
    try {
      await add({
        codeword: draft.codeword,
        shortId: null,
        reelId: null,
        reelUrl: draft.reelUrl || null,
        thumbnailUrl: draft.thumbnailUrl || null,
        caption: draft.caption || null,
        publishedAt: null,
        targetUrl: draft.targetUrl,
        active: true,
      });
      setDraft({ codeword: "", reelUrl: "", targetUrl: "", thumbnailUrl: "", caption: "" });
      setDialogOpen(false);
      toast.success("Код-слово добавлено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const copyShort = (shortId: string | null, codeword: string) => {
    if (!shortId) {
      toast.error("short_id появится после применения миграции в Supabase");
      return;
    }
    void navigator.clipboard.writeText(igOrganicBotLink(shortId));
    toast.success(`Ссылка для бота (${codeword}) скопирована`);
  };

  const selectedStat = stats.find((s) => s.codewordId === detailCodewordId) ?? null;

  return (
    <PageContainer>
      <PageHeader
        icon={Hash}
        title="Контент-аналитика"
        description="Код-слова в DM и статистика Instagram Business: охват, Reels, аудитория и продажи в CRM."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker range={range} onChange={setRange} />
            {activeTab === "codewords" && (
              <Button className="gap-2" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Добавить код-слово
              </Button>
            )}
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 grid h-11 w-full max-w-lg grid-cols-2">
          <TabsTrigger value="codewords" className="gap-2">
            <Hash className="h-4 w-4" />
            Код-слова
          </TabsTrigger>
          <TabsTrigger value="instagram" className="gap-2">
            <Instagram className="h-4 w-4" />
            Instagram аналитика
          </TabsTrigger>
        </TabsList>

        <TabsContent value="codewords">
      {error && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className={cn(loading && "opacity-60 pointer-events-none")}>
          <InstagramOrganicFunnel funnel={funnel} topCodewords={stats} />
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Продажи CRM (период)
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{fmtNum(totals.sales)}</div>
          <div className="text-xs text-muted-foreground">оплаченных лидов</div>
          <div className="mt-3 text-lg font-bold tabular-nums text-success">{fmtTenge(totals.revenue)}</div>
          <div className="text-xs text-muted-foreground">выручка</div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Продажи считаются по лидам из событий <code className="rounded bg-secondary px-1">lead</code> с{" "}
            <code className="rounded bg-secondary px-1">paid=true</code> в CRM.
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 text-sm font-semibold">Динамика за период</div>
        <ContentTrendChart events={events} />
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <h2 className="text-sm font-semibold">Код-слова и воронка</h2>
          <span className="text-xs text-muted-foreground">{stats.length} шт.</span>
        </div>
        {statsLoading || wordsLoading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : stats.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Camera className="mx-auto mb-2 h-6 w-6 text-pink-500" />
            Создайте первое код-слово — затем настройте n8n на{" "}
            <Link to="/settings" className="text-primary underline-offset-2 hover:underline">
              webhook intake
            </Link>
            .
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2">Код-слово</th>
                  <th className="px-4 py-2 text-right">DM</th>
                  <th className="px-4 py-2 text-right">Клики</th>
                  <th className="px-4 py-2 text-right">Заявки</th>
                  <th className="px-4 py-2 text-right">Продажи</th>
                  <th className="px-4 py-2 text-right">Выручка</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={s.codewordId}
                    className="border-b border-border/20 hover:bg-secondary/20"
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono font-semibold">«{s.codeword}»</div>
                      {s.reelUrl && (
                        <a
                          href={s.reelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline"
                        >
                          Reel <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtNum(s.codewordDms)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtNum(s.linkClicks)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtNum(s.leads)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtNum(s.sales)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtTenge(s.revenue)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          onClick={() => copyShort(s.shortId, s.codeword)}
                        >
                          <Copy className="h-3 w-3" />
                          Ссылка
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setDetailCodewordId(s.codewordId)}
                        >
                          Лиды
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

        </TabsContent>

        <TabsContent value="instagram" className="mt-0 focus-visible:outline-none">
          <InstagramAnalyticsPanel range={range} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Новое код-слово</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Код-слово (как пишут в DM)</Label>
              <Input
                placeholder="smile"
                value={draft.codeword}
                onChange={(e) => setDraft((d) => ({ ...d, codeword: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reel URL</Label>
              <Input
                placeholder="https://www.instagram.com/reel/..."
                value={draft.reelUrl}
                onChange={(e) => setDraft((d) => ({ ...d, reelUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Target URL (лендинг оффера)</Label>
              <Input
                placeholder="https://landing.example/offer"
                value={draft.targetUrl}
                onChange={(e) => setDraft((d) => ({ ...d, targetUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Превью (URL картинки)</Label>
              <Input
                value={draft.thumbnailUrl}
                onChange={(e) => setDraft((d) => ({ ...d, thumbnailUrl: e.target.value }))}
              />
            </div>
            <Button onClick={handleAdd} disabled={saving} className="mt-2 gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailCodewordId} onOpenChange={(v) => !v && setDetailCodewordId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Лиды — «{selectedStat?.codeword ?? ""}»</DialogTitle>
          </DialogHeader>
          {leadsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : leadRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока нет заявок по этому код-слову.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {leadRows.map((r) => (
                <li
                  key={r.leadId}
                  className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.phone}</div>
                  </div>
                  <div className="text-right text-xs">
                    {r.paid ? (
                      <span className="font-semibold text-success">{fmtTenge(r.amount)}</span>
                    ) : (
                      <span className="text-muted-foreground">не оплачен</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {items.length > 0 && (
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Шаблон ответа бота: «Спасибо! Лови ссылку:» + короткая ссылка из колонки «Ссылка».
          Полная настройка — в{" "}
          <Link to="/settings" className="underline-offset-2 hover:underline">
            Настройки → Instagram organic
          </Link>
          .
        </p>
      )}
    </PageContainer>
  );
}
