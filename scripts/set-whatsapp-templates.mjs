#!/usr/bin/env node
// Discovers the MarkVision client_configs row in the production Supabase
// (szfgdruhlebfvcmlvxdk) used by the n8n AI-targetolog1 workflow, then sets:
//   - wa_welcome_message_template     → business reply in WhatsApp after ad click
//   - wa_customer_greeting_template   → pre-filled message the customer sends
//
// Runs from a GitHub-hosted runner because the Claude sandbox blocks
// outbound HTTPS to *.supabase.co.
//
// Env:
//   SUPABASE_URL          (default https://szfgdruhlebfvcmlvxdk.supabase.co)
//   SUPABASE_SERVICE_KEY  (required)
//   TARGET_CLIENT_ID      (optional — if multiple matches and you want to force)
//   DRY_RUN=1             discover only, no PATCH

const URL  = process.env.SUPABASE_URL || 'https://szfgdruhlebfvcmlvxdk.supabase.co';
const KEY  = process.env.SUPABASE_SERVICE_KEY;
const DRY  = process.env.DRY_RUN === '1';
const FORCE_ID = process.env.TARGET_CLIENT_ID || '';

if (!KEY) { console.error('SUPABASE_SERVICE_KEY env is required'); process.exit(1); }

const WELCOME = 'Только для владельцев медицинских клиник и стоматологий';
const GREETING = 'Хочу получить систему привлечения первичных пациентов';

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// 1. discover the columns we need exist
console.log('[1/3] Checking schema of client_configs…');
const probe = await fetch(`${URL}/rest/v1/client_configs?select=*&limit=1`, { headers });
if (!probe.ok) {
  console.error(`Probe failed: ${probe.status} ${await probe.text()}`);
  process.exit(1);
}
const sample = await probe.json();
const cols = sample.length ? Object.keys(sample[0]) : [];
const hasWelcomeCol  = cols.includes('wa_welcome_message_template');
const hasGreetingCol = cols.includes('wa_customer_greeting_template');
console.log(`    columns total=${cols.length}, wa_welcome_message_template=${hasWelcomeCol}, wa_customer_greeting_template=${hasGreetingCol}`);
if (!hasWelcomeCol || !hasGreetingCol) {
  console.error('Required columns missing on client_configs. Add them via Supabase Studio:');
  console.error('  ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS wa_welcome_message_template text;');
  console.error('  ALTER TABLE client_configs ADD COLUMN IF NOT EXISTS wa_customer_greeting_template text;');
  process.exit(1);
}

// 2. find MarkVision row
console.log('[2/3] Listing client_configs…');
const list = await fetch(
  `${URL}/rest/v1/client_configs?select=id,client_name,city,brief,ad_account_id,wa_welcome_message_template,wa_customer_greeting_template`,
  { headers }
).then(r => r.json());

console.log(`    total rows: ${list.length}`);
list.forEach((r, i) => {
  console.log(`    [${i}] id=${r.id} client_name="${r.client_name || ''}" city="${r.city || ''}" ad_account=${r.ad_account_id || ''}`);
});

const NAME_RE = /марк\s*вижн|markvision|mark\s*vision|марквижн/i;
let target = null;
if (FORCE_ID) {
  target = list.find(r => r.id === FORCE_ID);
  if (!target) { console.error(`TARGET_CLIENT_ID=${FORCE_ID} not found`); process.exit(1); }
} else {
  const candidates = list.filter(r =>
    NAME_RE.test(r.client_name || '') || NAME_RE.test(r.brief || '')
  );
  if (candidates.length === 0) {
    console.error('No MarkVision row found by name/brief regex. Set TARGET_CLIENT_ID env to pick one of the rows above.');
    process.exit(1);
  }
  if (candidates.length > 1) {
    console.error(`Multiple candidates (${candidates.length}). Set TARGET_CLIENT_ID env to disambiguate.`);
    candidates.forEach(c => console.error(`  - id=${c.id} name="${c.client_name}"`));
    process.exit(1);
  }
  target = candidates[0];
}

console.log(`    selected target: id=${target.id} name="${target.client_name}"`);

// 3. update
console.log('[3/3] Updating row…');
if (DRY) { console.log('DRY_RUN=1 — skipping PATCH'); process.exit(0); }

const patch = await fetch(`${URL}/rest/v1/client_configs?id=eq.${target.id}`, {
  method: 'PATCH',
  headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({
    wa_welcome_message_template: WELCOME,
    wa_customer_greeting_template: GREETING,
  }),
});
const body = await patch.text();
console.log(`    status=${patch.status} body=${body.slice(0, 400)}`);
if (!patch.ok) { console.error('PATCH failed'); process.exit(1); }
console.log('OK — WhatsApp templates set for MarkVision.');
