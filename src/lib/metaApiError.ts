/** Человекочитаемые ошибки Meta Graph / Marketing API. */
export function humanizeMetaApiError(raw: string | null | undefined): string {
  const msg = String(raw ?? "").trim();
  if (!msg) return "Не удалось получить данные из Meta";

  if (
    /#200/i.test(msg)
    || /ads_management or ads_read/i.test(msg)
    || /Ad account owner has NOT grant/i.test(msg)
  ) {
    return (
      "У токена нет доступа к рекламному кабинету (нужны права ads_read / ads_management). "
      + "Откройте Настройки → Meta → переподключите Facebook под админом кабинета "
      + "и заново выдайте доступ к этому Ad Account. Затем обновите синхронизацию."
    );
  }

  if (/session has been invalidated|expired|OAuthException.*190/i.test(msg) || /\(#190\)/.test(msg)) {
    return "Токен Meta истёк или сброшен. Переподключите Facebook в Настройки → Meta.";
  }

  if (/rate limit|request limit|too many calls/i.test(msg)) {
    return "Meta временно ограничила запросы. Повторите синхронизацию через несколько минут.";
  }

  return msg.startsWith("Meta:") ? msg : `Meta: ${msg}`;
}
