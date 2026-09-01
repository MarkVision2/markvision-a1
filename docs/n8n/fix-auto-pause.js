// ── FIX: PROJECT_ID / CLIENT_CONFIG_ID ─────────────────────────────────────
// Раньше обе переменные использовались (строки с scoring_insights и capi_outbox),
// но нигде не объявлялись. Из-за этого на кабинете с выгоранием креатива нода
// падала с ReferenceError, а отправка Purchase в CAPI молча глохла в try/catch.
// Тянем их из client_configs по ad_account_id — там же, откуда Set Accounts
// берёт accountId.
let PROJECT_ID = null;
let CLIENT_CONFIG_ID = null;
try {
  const _acc = String(accountId || '');
  if (_acc) {
    const _bare = _acc.replace(/^act_/, '');
    const _variants = [_acc, 'act_' + _bare, _bare];
    const _seen = new Set();
    for (const _v of _variants) {
      if (!_v || _seen.has(_v)) continue;
      _seen.add(_v);
      const _rows = await this.helpers.httpRequest({
        method: 'GET',
        url: `${SUPABASE_URL}/rest/v1/client_configs`
          + `?ad_account_id=eq.${encodeURIComponent(_v)}`
          + `&select=id,project_id&limit=1&${authParam}`,
        headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
        json: true,
        timeout: 10000,
      });
      const _row = Array.isArray(_rows) ? _rows[0] : null;
      if (_row) {
        CLIENT_CONFIG_ID = _row.id || null;
        PROJECT_ID = _row.project_id || _row.id || null;
        break;
      }
    }
  }
} catch (e) {
  // кабинет не нашёлся или Supabase недоступен — обе останутся null,
  // зависимые ветки просто не выполнятся, нода не упадёт
}
// ── /FIX ───────────────────────────────────────────────────────────────────
