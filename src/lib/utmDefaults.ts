/**
 * Стандартный UTM-шаблон для Meta Ads.
 * КРИТИЧНО: utm_content={{ad.id}} — по нему лиды атрибутируются к креативу
 * в сквозной аналитике (см. greenapi-webhook + lead-intake).
 */
export const DEFAULT_META_UTM_TEMPLATE =
  "utm_source=meta&utm_medium={{placement}}&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";
