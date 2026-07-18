import { useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Download,
  FileBarChart2,
  LayoutDashboard,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useReportData } from "@/hooks/useReportData";
import { AiChatBar } from "@/components/reports/AiChatBar";
import { AiSummary } from "@/components/reports/AiSummary";
import { AutoSendDialog } from "@/components/reports/AutoSendDialog";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";
import { MarketingPage } from "@/components/reports/MarketingPage";
import { CreativesPage } from "@/components/reports/CreativesPage";
import { UnitEconomicsPage } from "@/components/reports/UnitEconomicsPage";
import { ReportExecutiveOverview } from "@/components/reports/ReportExecutiveOverview";
import type { ReportPeriodRange } from "@/hooks/useReportData";

export default function Reports() {
  const [range, setRange] = useState<ReportPeriodRange>(() => currentMonthRange());
  const [cabinetId, setCabinetId] = useState("all");
  const { cabinets } = usePersonalCabinets();
  const [compare, setCompare] = useState(true);
  const [exporting, setExporting] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  const { data, loading, error } = useReportData(cabinetId, range, compare);

  const rangeLabel = useMemo(
    () => `${format(range.from, "d MMM", { locale: ru })} – ${format(range.to, "d MMM yyyy", { locale: ru })}`,
    [range],
  );

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function onExport() {
    if (!printRef.current) return;
    setExporting(true);
    try {
      const { exportReportPdf } = await import("@/lib/exportReportPdf");
      await exportReportPdf(
        printRef.current,
        `report-${format(range.from, "yyyy-MM-dd")}-${format(range.to, "yyyy-MM-dd")}.pdf`,
      );
      toast.success("PDF готов");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать PDF");
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        icon={FileBarChart2}
        title="AI Отчётность"
        description={`${rangeLabel} · Meta + CRM + продажи`}
      />

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card/30 p-3">
        <Select value={cabinetId} onValueChange={setCabinetId}>
          <SelectTrigger className="h-10 w-[200px] rounded-xl border-border/60 bg-card/40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">📊 Все кабинеты</SelectItem>
            {cabinets.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <PeriodPicker range={range} onChange={setRange} />

        <div className="flex h-10 items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-4">
          <Switch checked={compare} onCheckedChange={setCompare} />
          <span className="text-sm">Сравнение</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <AutoSendDialog />
          <Button
            onClick={onExport}
            disabled={exporting || !data}
            className="h-10 gap-2 rounded-xl bg-success text-success-foreground hover:bg-success/90"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Скачать PDF
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <AiChatBar data={data} rangeLabel={rangeLabel} />
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="mt-10 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем отчёт...
        </div>
      )}

      {data && (
        <>
          <nav className="sticky top-2 z-20 mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-border/60 bg-background/85 p-2 shadow-lg shadow-black/10 backdrop-blur-xl">
            {[
              { id: "report-overview", label: "Обзор", icon: LayoutDashboard },
              { id: "report-ai", label: "AI-разбор", icon: Sparkles },
              { id: "report-marketing", label: "Маркетинг", icon: BarChart3 },
              { id: "report-creatives", label: "Креативы и каналы", icon: Target },
              { id: "report-economics", label: "Юнит-экономика", icon: FileBarChart2 },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => scrollToSection(id)}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </nav>

          <div id="report-overview" className="mt-5 scroll-mt-20">
            <ReportExecutiveOverview data={data} comparing={compare} />
          </div>

          <div id="report-ai" className="mt-5 scroll-mt-20">
            <AiSummary data={data} rangeLabel={rangeLabel} />
          </div>

          <div ref={printRef} className="mt-6 space-y-6">
            <div id="report-marketing" className="scroll-mt-20">
              <MarketingPage data={data} rangeLabel={rangeLabel} comparing={compare} />
            </div>
            <div id="report-creatives" className="scroll-mt-20">
              <CreativesPage data={data} rangeLabel={rangeLabel} />
            </div>
            <div id="report-economics" className="scroll-mt-20">
              <UnitEconomicsPage data={data} rangeLabel={rangeLabel} />
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
