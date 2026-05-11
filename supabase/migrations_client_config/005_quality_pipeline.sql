-- ════════════════════════════════════════════════════════════════════════
-- Скоринг лидов + воронка с CAPI-событиями
-- Запускай в SQL Editor нового проекта (szfgdruhlebfvcmlvxdk).
-- ════════════════════════════════════════════════════════════════════════

-- 1. pipelines — справочник воронок (одна на клиента)
create table if not exists public.pipelines (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references public.clients_config(id) on delete cascade,
  name          text not null,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists pipelines_client_idx on public.pipelines(client_id);

-- 2. pipeline_stages — этапы воронки, у каждого CAPI-привязка и дельта скора
create table if not exists public.pipeline_stages (
  id             uuid primary key default gen_random_uuid(),
  pipeline_id    uuid not null references public.pipelines(id) on delete cascade,
  position       integer not null,
  name           text not null,
  capi_event     text,                       -- Lead | Schedule | CompleteRegistration | Purchase | Subscribe | null
  score_delta    integer not null default 0, -- сколько добавить к ai_score при попадании сюда
  value_field    text,                       -- какую колонку leads_crm взять как event_value (purchase_value, lifetime_value, ...)
  is_target      boolean not null default false,  -- этот этап = «целевой» лид (для отчётов)
  is_paid        boolean not null default false,  -- этап = оплата
  created_at     timestamptz not null default now()
);
create unique index if not exists pipeline_stages_position_key on public.pipeline_stages(pipeline_id, position);
create index if not exists pipeline_stages_pipeline_idx on public.pipeline_stages(pipeline_id);

-- 3. leads_crm — расширяем под этапы + CAPI таймстампы
alter table public.leads_crm
  add column if not exists pipeline_id           uuid references public.pipelines(id) on delete set null,
  add column if not exists pipeline_stage_id     uuid references public.pipeline_stages(id) on delete set null,
  add column if not exists stage_updated_at      timestamptz,
  add column if not exists schedule_at           timestamptz,
  add column if not exists purchase_value        numeric,
  add column if not exists capi_schedule_sent_at timestamptz,
  add column if not exists capi_purchase_sent_at timestamptz,
  add column if not exists score_label           text,                 -- spam | cold | warm | hot | customer | paid
  add column if not exists confirmation_score    numeric default 0,
  add column if not exists city_confirmed        boolean default false,
  add column if not exists service_confirmed     boolean default false,
  add column if not exists appointment_confirmed boolean default false;
create index if not exists leads_crm_pipeline_stage_idx on public.leads_crm(pipeline_stage_id);
create index if not exists leads_crm_score_label_idx on public.leads_crm(score_label);

-- 4. lead_status_history — лог переходов по этапам (для аналитики и отката)
create table if not exists public.lead_status_history (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads_crm(id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages(id) on delete set null,
  to_stage_id   uuid references public.pipeline_stages(id) on delete set null,
  changed_by    text,
  changed_at    timestamptz not null default now(),
  capi_event    text,
  capi_sent     boolean not null default false,
  notes         text
);
create index if not exists lead_status_history_lead_idx on public.lead_status_history(lead_id, changed_at desc);

-- 5. RLS off (workflow ходит под service_role)
alter table public.pipelines           disable row level security;
alter table public.pipeline_stages     disable row level security;
alter table public.lead_status_history disable row level security;

-- ════════════════════════════════════════════════════════════════════════
-- Seed: дефолтная воронка для «Мир без границ»
-- ════════════════════════════════════════════════════════════════════════

with c as (
  select id from public.clients_config where ad_account_id = 'act_987225436848235' limit 1
),
new_pipeline as (
  insert into public.pipelines (client_id, name, is_default)
  select id, 'Основная воронка', true from c
  on conflict do nothing
  returning id
),
pid as (
  select id from new_pipeline
  union all
  select p.id from public.pipelines p join c on p.client_id = c.id where p.is_default
  limit 1
)
insert into public.pipeline_stages (pipeline_id, position, name, capi_event, score_delta, value_field, is_target, is_paid)
select pid.id, position, name, capi_event, score_delta, value_field, is_target, is_paid
from pid, (values
  (1, 'Новые',                     'Lead',                 20, null,             false, false),
  (2, 'Дозвонился',                 null,                  10, null,             false, false),
  (3, 'Заинтересован',              null,                  15, null,             false, false),
  (4, 'Записан на диагностику',    'Schedule',             30, null,             true,  false),
  (5, 'Пришёл на диагностику',     'CompleteRegistration', 10, null,             false, false),
  (6, 'Оплатил',                   'Purchase',             20, 'purchase_value', true,  true),
  (7, 'Курс пройден',              'Subscribe',             5, null,             false, false),
  (8, 'Отказ / закрытый',           null,                  -10, null,            false, false)
) as s(position, name, capi_event, score_delta, value_field, is_target, is_paid)
on conflict (pipeline_id, position) do nothing;
