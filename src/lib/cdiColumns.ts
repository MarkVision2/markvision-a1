/** Колонки cabinet_daily_insights для чтения (с fallback без manual_spend/leads). */

export const CDI_SELECT_LEGACY =
  "date, spend, impressions, clicks, leads, revenue, currency, crm_diagnostics, manual_diagnostics, crm_sales, manual_sales, crm_revenue, manual_revenue, crm_diagnostic_revenue, manual_diagnostic_revenue";

export const CDI_SELECT_WITH_AD_MANUAL =
  `${CDI_SELECT_LEGACY}, manual_spend, manual_leads, link_clicks, messages`;

export const CDI_SELECT_REPORT_LEGACY =
  "cabinet_id, external_id, date, spend, impressions, clicks, leads, crm_sales, manual_sales, crm_revenue, manual_revenue, crm_diagnostics, manual_diagnostics, crm_diagnostic_revenue, manual_diagnostic_revenue";

export const CDI_SELECT_REPORT_WITH_AD_MANUAL =
  `${CDI_SELECT_REPORT_LEGACY}, manual_spend, manual_leads, link_clicks, messages`;

export function cdiMissingAdManualColumns(message: string): boolean {
  // link_clicks / messages добавлены миграцией 20260903120000 — до её применения
  // читаем без них, иначе весь запрос падал бы на неизвестной колонке.
  return /manual_spend|manual_leads|link_clicks|messages/i.test(message);
}
