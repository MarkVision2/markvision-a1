import { useMemo, useRef, useState } from "react";
import { Bell, Download, Loader2 } from "lucide-react";
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
    <main className="container max-w-7xl py-8 animate-fade-in-up">
      {/* Top bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="text-2xl font-bold tracking-tight whitespace-nowrap">
          AI Отчётность
        </div>
        <div className="flex flex-1 items-center gap-3">
          <AiChatBar data={data} rangeLabel={rangeLabel} />
          <button className="grid h-12 w-12 place-items-center rounded-2xl border border-border/60 bg-card/40 hover:bg-secondary/50">
            <Bell className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card/30 p-3">
        <Select value={cabinetId} onValueChange={setCabinetId}>
          <SelectTrigger className="h-12 w-[200px] rounded-2xl border-border/60 bg-card/40">
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

        <div className="flex h-12 items-center gap-3 rounded-2xl border border-border/60 bg-card/40 px-4">
          <Switch checked={compare} onCheckedChange={setCompare} />
          <span className="text-sm">Сравнение</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <AutoSendDialog />
          <Button
            onClick={onExport}
            disabled={exporting || !data}
            className="h-12 gap-2 rounded-2xl bg-success text-success-foreground hover:bg-success/90"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Скачать PDF
          </Button>
        </div>
      </div>

      {/* AI Summary */}
      <div className="mt-6">
        <AiSummary data={data} rangeLabel={rangeLabel} />
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Report pages */}
      {loading && !data && (
        <div className="mt-10 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем отчёт...
        </div>
      )}

      {data && (
        <div ref={printRef} className="mt-6 space-y-6">
          <MarketingPage data={data} rangeLabel={rangeLabel} comparing={compare} />
          <CreativesPage data={data} rangeLabel={rangeLabel} />
          <UnitEconomicsPage data={data} rangeLabel={rangeLabel} />
        </div>
      )}
    </main>
  );
}
