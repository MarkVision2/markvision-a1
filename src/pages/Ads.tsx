import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Film,
  LayoutGrid,
  Megaphone,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Target,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import AddCabinetDialog from "@/components/ads/AddCabinetDialog";
import CreateCampaignDialog from "@/components/ads/CreateCampaignDialog";
import CabinetRow from "@/components/ads/CabinetRow";
import { AdsCreativesPanel } from "@/components/ads/AdsCreativesPanel";
import { CampaignsWorkspace } from "@/components/ads/CampaignsWorkspace";
import { PeriodPicker, monthRange } from "@/components/dashboard/PeriodPicker";
import { META_STRUCTURE_QUERY_KEY } from "@/hooks/useMetaDashboard";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { humanizeMetaApiError } from "@/lib/metaApiError";
import { cn } from "@/lib/utils";

const SEARCH_THRESHOLD = 3;

const Ads = () => {
  const queryClient = useQueryClient();
  const { activeId: projectId } = useProjectsStore();
  const { cabinets, addCabinet, updateCabinet, removeCabinet } = useCabinetsStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "cabinets";
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addInitialStep, setAddInitialStep] = useState<"pick" | "configure">("pick");
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [period, setPeriod] = useState<ReportPeriodRange>(() => monthRange(new Date()));
  const monthCursor = period.from;

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const filtered = useMemo(
    () =>
      cabinets.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [cabinets, query],
  );

  const active = cabinets.filter((c) => c.online).length;
  const showSearch = cabinets.length > SEARCH_THRESHOLD;
  const soleMetaCabinet =
    cabinets.filter((c) => {
      const p = (c.provider ?? "meta").toLowerCase();
      return p === "meta" || p === "facebook";
    }).length === 1;

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    void queryClient.invalidateQueries({ queryKey: [META_STRUCTURE_QUERY_KEY, projectId] });
    toast.success("Данные обновлены");
  };

  const openCreatives = (campaignName?: string) => {
    setSearchParams((sp) => {
      sp.set("tab", "creatives");
      if (campaignName) sp.set("q", campaignName);
      else sp.delete("q");
      return sp;
    }, { replace: true });
  };

  const handleToggleOnline = (id: string) => {
    const c = cabinets.find((x) => x.id === id);
    if (!c) return;
    updateCabinet(id, { online: !c.online });
    toast.success(c.online ? "Кабинет на паузе" : "Кабинет запущен");
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Megaphone}
        iconAccent="primary"
        title="Управление рекламой"
        description={
          cabinets.length === 0
            ? "Подключите Meta-кабинет и запускайте кампании из одного места"
            : (
              <>
                {cabinets.length}{" "}
                {cabinets.length === 1 ? "кабинет" : cabinets.length < 5 ? "кабинета" : "кабинетов"}
                {" · "}
                <span className="text-success">{active} активн.</span>
              </>
            )
        }
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex w-full flex-wrap items-center gap-2 sm:justify-end">
              <PeriodPicker range={period} onChange={setPeriod} className="w-full justify-between sm:w-auto sm:justify-start" />
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl border-border/50 bg-card/40"
                aria-label="Обновить"
                onClick={handleRefresh}
                title="Обновить данные"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => setCampaignOpen(true)}
                className="h-10 gap-2 rounded-xl bg-success px-4 text-white hover:bg-success/90"
              >
                <Rocket className="h-4 w-4" />
                Создать кампанию
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                onClick={() => {
                  setAddInitialStep("pick");
                  setAddOpen(true);
                }}
                className="h-9 gap-2 rounded-xl border border-primary/35 bg-primary/10 px-3 text-primary hover:bg-primary/20"
              >
                <Zap className="h-3.5 w-3.5" />
                Подключить Meta
              </Button>
              <Button
                onClick={() => {
                  setAddInitialStep("configure");
                  setAddOpen(true);
                }}
                variant="ghost"
                className="h-9 gap-1.5 rounded-xl px-3 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Вручную
              </Button>
            </div>
          </div>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) =>
          setSearchParams((sp) => {
            sp.set("tab", v);
            return sp;
          }, { replace: true })
        }
        className="mt-6"
      >
        <div className="border-b border-border/50">
          <TabsList className="scrollbar-none h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0 touch-pan-x">
            {(
              [
                { id: "cabinets", label: "Кабинеты", icon: LayoutGrid },
                { id: "creatives", label: "Креативы", icon: Film },
                { id: "campaigns", label: "Кампании", icon: Target },
              ] as const
            ).map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className={cn(
                  "relative gap-2 rounded-none border-b-2 border-transparent bg-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground shadow-none",
                  "hover:text-foreground",
                  "data-[state=active]:border-success data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="cabinets" className="mt-5 space-y-3">
          {showSearch && (
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по кабинетам…"
                className="h-10 rounded-xl border-border/50 bg-card/50 pl-10"
              />
            </div>
          )}
          {filtered.map((c) => (
            <CabinetRow
              key={`${c.id}-${refreshKey}`}
              cabinet={c}
              expanded={!!expanded[c.id]}
              onToggle={() => toggleExpanded(c.id)}
              monthCursor={monthCursor}
              onToggleOnline={handleToggleOnline}
              onRemove={removeCabinet}
              soleMetaCabinet={soleMetaCabinet}
            />
          ))}
          {filtered.length === 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-dashed border-border/50 bg-gradient-to-b from-card/50 to-transparent px-6 py-14 text-center">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_70%)]" />
              <div className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Megaphone className="h-6 w-6" />
              </div>
              <h3 className="relative mt-4 text-base font-semibold">
                {cabinets.length === 0 ? "Подключите первый кабинет" : "Кабинеты не найдены"}
              </h3>
              <p className="relative mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                {cabinets.length === 0
                  ? "Выберите рекламный аккаунт Meta — метрики и запуск кампаний появятся здесь"
                  : "Попробуйте изменить поисковый запрос"}
              </p>
              {cabinets.length === 0 && (
                <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    onClick={() => {
                      setAddInitialStep("pick");
                      setAddOpen(true);
                    }}
                    className="h-11 gap-2 rounded-xl bg-success px-5 text-white hover:bg-success/90"
                  >
                    <Zap className="h-4 w-4" />
                    Подключить из Meta
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAddInitialStep("configure");
                      setAddOpen(true);
                    }}
                    className="h-11 gap-2 rounded-xl border-border/50"
                  >
                    <Plus className="h-4 w-4" />
                    Ввести вручную
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="creatives" className="mt-5">
          <AdsCreativesPanel range={period} />
        </TabsContent>

        <TabsContent value="campaigns" className="mt-5">
          <CampaignsWorkspace
            range={period}
            onCreateCampaign={() => setCampaignOpen(true)}
            onOpenCreatives={openCreatives}
          />
        </TabsContent>
      </Tabs>

      <AddCabinetDialog
        key={addOpen ? addInitialStep : "closed"}
        open={addOpen}
        onOpenChange={setAddOpen}
        initialStep={addInitialStep}
        existingActIds={cabinets
          .map((c) => c.adAccountId || c.externalId || "")
          .filter(Boolean)}
        onCreate={async (c) => {
          try {
            const newId = await addCabinet(c);
            toast.success("Кабинет добавлен");
            if (newId && (c.adAccountId || c.externalId)) {
              toast.message("Подтягиваем статистику из Meta…");
              const today = new Date();
              const since = new Date(today.getFullYear(), today.getMonth(), 1)
                .toISOString().slice(0, 10);
              const until = today.toISOString().slice(0, 10);
              supabase.functions.invoke("meta-daily-sync", {
                body: { cabinet_id: newId, since, until },
              }).then(({ data, error }) => {
                if (error) {
                  toast.error("Sync ошибка: " + error.message);
                  return;
                }
                const r = (data?.results ?? [])[0];
                if (r?.ok) {
                  toast.success(
                    `Статистика загружена: ${r.days} дн., ${r.leads} лидов, расход ${Math.round(r.spend)}`,
                  );
                  setRefreshKey((k) => k + 1);
                } else if (r) {
                  toast.error(humanizeMetaApiError(r.error || "не удалось получить данные"));
                }
              });
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Не удалось добавить кабинет");
          }
        }}
      />
      <CreateCampaignDialog
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        cabinets={cabinets}
      />
    </PageContainer>
  );
};

export default Ads;
