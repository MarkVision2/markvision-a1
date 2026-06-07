import {
  Eye, Flame, MapPin,
  ShoppingCart, Target, TrendingUp, Users, Wallet,
} from "lucide-react";
import type { ReportData } from "@/hooks/useReportData";
import { deltaPct } from "@/hooks/useReportData";
import { KpiCard } from "./KpiCard";
import { SectionTitle } from "./SectionTitle";
import { ReportPageWrapper } from "./ReportPageWrapper";
import { ReportConversionFunnel } from "./ReportConversionFunnel";
import { fmtMetricTenge, fmtNum, fmtTenge } from "./reportFormat";

interface Props {
  data: ReportData;
  rangeLabel: string;
  comparing: boolean;
}

export function MarketingPage({ data, rangeLabel, comparing }: Props) {
  const { totals, prev } = data;

  return (
    <ReportPageWrapper
      title="Маркетинговый отчёт"
      rangeLabel={rangeLabel}
      pageNumber={1}
      pageTotal={3}
      rightLabel="Маркетинг · Воронка"
    >
      <SectionTitle>Ключевые показатели</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Wallet} label="Расходы на рекламу" hint="сколько потратили за период" value={fmtTenge(totals.spend)} delta={deltaPct(totals.spend, prev?.spend)} comparing={comparing} invertDelta />
        <KpiCard icon={Users} label="Заявки" hint="лиды Meta + CRM без кабинета" value={fmtNum(totals.totalLeads)} delta={deltaPct(totals.totalLeads, prev?.totalLeads)} comparing={comparing} />
        <KpiCard icon={Target} label="Стоимость заявки" hint="расход ÷ заявки (CPL)" value={fmtTenge(totals.cpl)} delta={deltaPct(totals.cpl, prev?.cpl)} comparing={comparing} invertDelta />
        <KpiCard icon={Eye} label="Диагностики" hint="сколько человек дошли до визита" value={fmtNum(totals.visits)} delta={deltaPct(totals.visits, prev?.visits)} comparing={comparing} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={TrendingUp} label="Выручка CRM" hint="оплаты + диагностики (таблица показателей)" value={fmtTenge(totals.revenue)} delta={deltaPct(totals.revenue, prev?.revenue)} comparing={comparing} />
        <KpiCard icon={MapPin} label="Стоимость диагностики" hint="расход ÷ диагностики (CPD)" value={fmtMetricTenge(totals.cpv, totals.visits > 0)} delta={deltaPct(totals.cpv, prev?.cpv)} comparing={comparing} invertDelta />
        <KpiCard icon={ShoppingCart} label="Продажи" hint="оплаченные сделки" value={fmtNum(totals.sales)} delta={deltaPct(totals.sales, prev?.sales)} comparing={comparing} />
        <KpiCard icon={Flame} label="Стоимость клиента" hint="расход ÷ продажи (CAC)" value={fmtMetricTenge(totals.cac, totals.sales > 0)} delta={deltaPct(totals.cac, prev?.cac)} comparing={comparing} emphasized invertDelta />
      </div>

      <div className="mt-8">
        <SectionTitle>Воронка конверсии</SectionTitle>
        <ReportConversionFunnel totals={totals} />
      </div>
    </ReportPageWrapper>
  );
}

export { reportFmt } from "./reportFormat";