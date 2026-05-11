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

  // Реклама убыточна
  if (totals.spend > 0 && totals.romi < 0) {
    out.push({
      level: "critical",
      title: "Период убыточный",
      message: `Окупаемость рекламы ${Math.round(totals.romi)}%. Расходы превышают выручку.`,
      recommendation: "Проверьте источники заявок, оффер и путь клиента до оплаты.",
    });
  }

  // Стоимость заявки выросла
  if (prev && prev.cpl > 0 && totals.cpl > 0) {
    const d = pct(totals.cpl, prev.cpl);
    if (d >= 20) {
      out.push({
        level: d >= 40 ? "critical" : "warning",
        title: `Стоимость заявки выросла на ${Math.round(d)}%`,
        message: `Сейчас ${Math.round(totals.cpl).toLocaleString("ru-RU")} ₸ за заявку против ${Math.round(prev.cpl).toLocaleString("ru-RU")} ₸ ранее.`,
        recommendation: "Проверьте рекламу и качество обращений: цена растет, значит нужно быстро найти слабый источник.",
      });
    }
  }

  // Доля кликов ниже нормы
  if (totals.impressions > 1000 && totals.ctr > 0 && totals.ctr < 0.8) {
    out.push({
      level: "warning",
      title: `Мало кликов из показов: ${totals.ctr.toFixed(2)}%`,
      message: "Люди видят рекламу, но редко переходят дальше.",
      recommendation: "Проверьте оффер, текст и посадочную страницу: первое касание не убеждает аудиторию.",
    });
  }

  // Конверсия заявка → оплата просела
  if (prev) {
    const cur = totals.totalLeads > 0 ? totals.sales / totals.totalLeads : 0;
    const prevCr = prev.totalLeads > 0 ? prev.sales / prev.totalLeads : 0;
    if (prevCr > 0 && cur < prevCr) {
      const drop = ((prevCr - cur) / prevCr) * 100;
      if (drop >= 15) {
        out.push({
          level: drop >= 30 ? "critical" : "warning",
          title: `Заявки хуже доходят до оплаты: -${Math.round(drop)}%`,
          message: `${(cur * 100).toFixed(1)}% против ${(prevCr * 100).toFixed(1)}% ранее.`,
          recommendation: "Проверьте скорость ответа, звонки и скрипт продаж.",
        });
      }
    }
  }

  // Перегрев бюджета: расход растёт, заявки падают
  if (prev && prev.spend > 0 && prev.totalLeads > 0) {
    const dSpend = pct(totals.spend, prev.spend);
    const dLeads = pct(totals.totalLeads, prev.totalLeads);
    if (dSpend >= 15 && dLeads <= -10) {
      out.push({
        level: "critical",
        title: "Перегрев бюджета",
        message: `Расход +${Math.round(dSpend)}%, а заявки ${Math.round(dLeads)}%.`,
        recommendation: "Сократите бюджет на слабых источниках и перераспределите деньги туда, где заявки дешевле.",
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
