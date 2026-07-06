#!/usr/bin/env node
/**
 * Экспорт данных Lovable (mekwfbqmsqiborjdrjxc) БЕЗ пароля БД.
 * Нужен service role key (обходит RLS).
 *
 * Где взять ключ:
 *   Lovable → Project Settings → Secrets / Environment Variables
 *   → SUPABASE_SERVICE_ROLE_KEY (или Service Role в панели Supabase-интеграции)
 *
 * Запуск:
 *   export LOVABLE_SERVICE_ROLE_KEY="eyJ..."
 *   node scripts/migrate-to-szfg/03-export-lovable-rest.mjs
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const URL =
  process.env.LOVABLE_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://mekwfbqmsqiborjdrjxc.supabase.co';

const KEY =
  process.env.LOVABLE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const OUT_DIR =
  process.env.OUT_DIR ||
  path.join(__dirname, '../../tmp', `lovable-dump-${new Date().toISOString().slice(0, 10)}`);

const TABLES = [
  'projects',
  'project_members',
  'user_active_project',
  'pipelines',
  'pipeline_stages',
  'loss_reasons',
  'ad_cabinets',
  'cabinet_daily_insights',
  'meta_campaigns',
  'meta_campaign_daily',
  'meta_creatives',
  'meta_creative_daily',
  'leads',
  'lead_status_history',
  'communications',
  'tasks',
  'deals',
  'events',
  'rnp_daily',
  'automation_settings',
  'fx_rates',
  'instagram_accounts',
  'instagram_codewords',
  'instagram_organic_events',
  'instagram_media',
  'instagram_daily',
  'instagram_demographics',
  'phone_attribution',
  'capi_outbox',
  'project_briefs',
  'finance_plans',
  'report_subscriptions',
  'quick_replies',
  'profiles',
  'user_roles',
];

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const inner = value.map((v) => {
      if (v === null) return 'NULL';
      if (typeof v === 'number') return String(v);
      return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    });
    return `'{${inner.join(',')}}'`;
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function rowsToSql(table, rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  return rows
    .map((row) => {
      const vals = cols.map((c) => sqlLiteral(row[c]));
      return `INSERT INTO public."${table}" (${colList}) VALUES (${vals.join(', ')});`;
    })
    .join('\n');
}

async function fetchAll(supabase, table) {
  const rows = [];
  const pageSize = 500;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function main() {
  if (!KEY) {
    console.error(`
❌ Нужен LOVABLE_SERVICE_ROLE_KEY (service role, НЕ sb_publishable_...).

Где искать в Lovable:
  1. Project Settings → Secrets / Environment Variables
  2. Или: Settings → Integrations → Supabase → Service role key
  3. Или в GitHub → repo Secrets → SUPABASE_SERVICE_ROLE_KEY

Формат: длинный JWT eyJhbGciOiJIUzI1NiIs...
`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const supabase = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Export REST: ${URL}`);
  console.log(`→ ${OUT_DIR}\n`);

  const summary = [];

  for (const table of TABLES) {
    process.stdout.write(`  ${table} ... `);
    try {
      const rows = await fetchAll(supabase, table);
      const sql = rowsToSql(table, rows);
      const file = path.join(OUT_DIR, `${table}.sql`);
      if (sql) fs.writeFileSync(file, `${sql}\n`);
      summary.push({ table, rows: rows.length });
      console.log(rows.length);
    } catch (e) {
      summary.push({ table, rows: 0, error: e.message });
      console.log(`skip (${e.message})`);
    }
  }

  console.log('\n--- итого ---');
  for (const s of summary) {
    if (s.error) console.log(`  ${s.table}: ошибка — ${s.error}`);
    else if (s.rows > 0) console.log(`  ${s.table}: ${s.rows}`);
  }

  console.log(`
⚠️  auth.users — отдельно (invite в szfg или экспорт из Dashboard).
Storage creative-posters — скопировать вручную при необходимости.

Импорт:
  export SUPABASE_DB_PASSWORD='...'
  ./scripts/migrate-to-szfg/04-import-data.sh ${OUT_DIR}
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
