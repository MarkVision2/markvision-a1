import type { ReportTotals } from "@/hooks/useReportData";

export type AlertLevel = "critical" | "warning" | "ok";

export interface DashAlert {
  level: AlertLevel;
  title: string;
  message: string;
  recommendation?: string;
}

function pct(cur: number, prev: number): number {
  if (prev === 0) return cur === 0 ? 0 : 100;
  return ((cur - prev) / prev) * 100;
}

export function buildAlerts(totals: ReportTotals, prev?: ReportTotals): DashAlert[] {
  const out: DashAlert[] = [];

  // ROMI убыточный
  if (totals.spend > 0 && totals.romi < 0) {
    out.push({
      level: "critical",
      title: "Период убыточный",
      message: `ROMI = ${Math.round(totals.romi)}%. Расходы превышают выручку.`,
      recommendation: "Отключите худшие кампании, пересмотрите офер и креативы.",
    });
  }

  // CPL вырос
  if (prev && prev.cpl > 0 && totals.cpl > 0) {
    const d = pct(totals.cpl, prev.cpl);
    if (d >= 20) {
      out.push({
        level: d >= 40 ? "critical" : "warning",
        title: `CPL вырос на ${Math.round(d)}%`,
        message: `Стоимость лида ${Math.round(totals.cpl).toLocaleString("ru-RU")} $ против ${Math.round(prev.cpl).toLocaleString("ru-RU")} $ ранее.`,
        recommendation: "Проверь креативы и аудитории — выгорает связка.",
      });
    }
  }

  // CTR ниже нормы
  if (totals.impressions > 1000 && totals.ctr > 0 && totals.ctr < 0.8) {
    out.push({
      level: "warning",
      title: `CTR ${totals.ctr.toFixed(2)}% — ниже нормы`,
      message: "Креатив не цепляет аудиторию.",
      recommendation: "Обнови оффер/визуал, протестируй 2–3 новых креатива.",
    });
  }

  // Конверсия лид → продажа просела
  if (prev) {
    const cur = totals.totalLeads > 0 ? totals.sales / totals.totalLeads : 0;
    const prevCr = prev.totalLeads > 0 ? prev.sales / prev.totalLeads : 0;
    if (prevCr > 0 && cur < prevCr) {
      const drop = ((prevCr - cur) / prevCr) * 100;
      if (drop >= 15) {
        out.push({
          level: drop >= 30 ? "critical" : "warning",
          title: `Конверсия лид → продажа упала на ${Math.round(drop)}%`,
          message: `${(cur * 100).toFixed(1)}% против ${(prevCr * 100).toFixed(1)}% ранее.`,
          recommendation: "Слушай звонки, проверь скрипт и скорость обработки заявок.",
        });
      }
    }
  }

  // Перегрев бюджета: расход растёт, лиды падают
  if (prev && prev.spend > 0 && prev.totalLeads > 0) {
    const dSpend = pct(totals.spend, prev.spend);
    const dLeads = pct(totals.totalLeads, prev.totalLeads);
    if (dSpend >= 15 && dLeads <= -10) {
      out.push({
        level: "critical",
        title: "Перегрев бюджета",
        message: `Расход +${Math.round(dSpend)}%, а лиды ${Math.round(dLeads)}%.`,
        recommendation: "Сократи ставки/бюджеты на убыточных группах объявлений.",
      });
    }
  }

  if (out.length === 0) {
    out.push({
      level: "ok",
      title: "Метрики в норме",
      message: "Критичных отклонений за период не найдено.",
    });
  }

  return out;
}