// ── FIX: PROJECT_ID / CLIENT_CONFIG_ID ─────────────────────────────────────
// Раньше обе переменные использовались (строки с scoring_insights и capi_outbox),
// но нигде не объявлялись. Из-за этого на кабинете с выгоранием креатива нода
// падала с ReferenceError, а отправка Purchase в CAPI молча глохла в try/catch.
//
// Берём их из ad_cabinets по external_id (= act_...). Именно там лежат
// project_id и id кабинета; в client_configs таких колонок нет вовсе —
// там есть только cabinet_id, ссылающийся на ad_cabinets.id.
// Проверено на всех 11 кабинетах: 6 из 9 уникальных аккаунтов резолвятся
// (включая act_160496776998817, на котором нода падала), у остальных строки
// в ad_cabinets пока нет — там обе переменные останутся null и зависимые
// ветки просто пропустятся.
let PROJECT_ID = null;
let CLIENT_CONFIG_ID = null;
try {
  const _acc = String(accountId || '');
  if (_acc) {
    const _bare = _acc.replace(/^act_/, '');
    const _seen = new Set();
    for (const _v of [_acc, 'act_' + _bare, _bare]) {
      if (!_v || _seen.has(_v)) continue;
      _seen.add(_v);
      const _rows = await this.helpers.httpRequest({
        method: 'GET',
        url: `${SUPABASE_URL}/rest/v1/ad_cabinets`
          + `?external_id=eq.${encodeURIComponent(_v)}`
          + `&select=id,project_id&limit=1&${authParam}`,
        headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
        json: true,
        timeout: 10000,
      });
      const _row = Array.isArray(_rows) ? _rows[0] : null;
      if (_row && _row.project_id) {
        CLIENT_CONFIG_ID = _row.id || null;
        PROJECT_ID = _row.project_id;
        break;
      }
    }
  }
} catch (e) {
  // кабинет не нашёлся или Supabase недоступен — обе останутся null,
  // зависимые ветки просто не выполнятся, нода не упадёт
}
// ── /FIX ───────────────────────────────────────────────────────────────────
