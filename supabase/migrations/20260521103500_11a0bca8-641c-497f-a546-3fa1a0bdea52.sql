
-- Enums
do $$ begin
  create type public.ai_script_category as enum (
    'greeting','objection_price','objection_no_time','objection_thinking',
    'closing','follow_up','missed_call','custom'
  );
exception when duplicate_object then null; end $$;

do $$ begin create type public.ai_script_source as enum ('manual','ai');
exception when duplicate_object then null; end $$;

do $$ begin create type public.content_format as enum ('reels','post','story','article','video');
exception when duplicate_object then null; end $$;

do $$ begin create type public.content_priority as enum ('high','mid','low');
exception when duplicate_object then null; end $$;

do $$ begin create type public.content_status as enum ('idea','in_progress','published','rejected');
exception when duplicate_object then null; end $$;

do $$ begin create type public.trainer_channel as enum ('phone','whatsapp','instagram');
exception when duplicate_object then null; end $$;

do $$ begin create type public.trainer_role as enum ('patient','lead');
exception when duplicate_object then null; end $$;

-- 2.1 ai_rop_settings
create table public.ai_rop_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  system_prompt text not null,
  watch_list text[] not null default '{}',
  sla_first_response_min int not null default 5,
  sla_callback_hours int not null default 2,
  sla_chat_idle_hours int not null default 4,
  kpi_min_conversion_pct numeric not null default 10,
  kpi_min_dial_pct numeric not null default 70,
  kpi_max_reject_pct numeric not null default 30,
  tone text not null default 'neutral' check (tone in ('strict','neutral','supportive')),
  auto_suggest_scripts boolean not null default true,
  auto_flag_sla boolean not null default true,
  auto_generate_content boolean not null default true,
  auto_score_calls boolean not null default true,
  auto_score_chats boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id)
);
alter table public.ai_rop_settings enable row level security;

-- 2.2 ai_rop_scripts
create table public.ai_rop_scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  category public.ai_script_category not null,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  source public.ai_script_source not null default 'manual',
  usage_count int not null default 0,
  effectiveness numeric,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_rop_scripts_project_category_idx on public.ai_rop_scripts(project_id, category);
alter table public.ai_rop_scripts enable row level security;

-- 2.3 ai_rop_content_ideas
create table public.ai_rop_content_ideas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  format public.content_format not null,
  priority public.content_priority not null default 'mid',
  status public.content_status not null default 'idea',
  hook text,
  body text,
  audience text,
  cta text,
  based_on text,
  source_lead_ids uuid[] default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_rop_content_ideas enable row level security;

-- 2.4 ai_rop_call_analyses
create table public.ai_rop_call_analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  manager_id uuid references auth.users(id),
  call_recording_url text,
  transcript text,
  transcript_segments jsonb,
  duration_sec int,
  call_at timestamptz not null,
  overall_score int check (overall_score between 0 and 100),
  criteria jsonb,
  strengths text[],
  weaknesses text[],
  main_mistake text,
  recommended_script_id uuid references public.ai_rop_scripts(id),
  topics text[],
  objections text[],
  ai_model text,
  processed_at timestamptz not null default now()
);
create index ai_rop_call_analyses_project_idx on public.ai_rop_call_analyses(project_id, call_at desc);
create index ai_rop_call_analyses_manager_idx on public.ai_rop_call_analyses(manager_id, call_at desc);
alter table public.ai_rop_call_analyses enable row level security;

-- 2.5 ai_rop_chat_analyses
create table public.ai_rop_chat_analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  manager_id uuid references auth.users(id),
  channel text,
  message_count int,
  first_response_min int,
  avg_response_min numeric,
  overall_score int check (overall_score between 0 and 100),
  criteria jsonb,
  strengths text[],
  weaknesses text[],
  topics text[],
  objections text[],
  flag_price_without_qualification boolean default false,
  flag_no_closing boolean default false,
  flag_ghosted_by_manager boolean default false,
  ai_model text,
  processed_at timestamptz not null default now(),
  unique(lead_id)
);
alter table public.ai_rop_chat_analyses enable row level security;

-- 2.6 ai_rop_manager_scores
create table public.ai_rop_manager_scores (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  manager_id uuid references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  overall_score int,
  sla_score int,
  dial_score int,
  conversion_score int,
  scripts_score int,
  empathy_score int,
  leads_assigned int,
  leads_paid int,
  calls_total int,
  calls_avg_score numeric,
  chats_total int,
  chats_avg_score numeric,
  ai_report text,
  ai_recommendations text[],
  generated_at timestamptz not null default now()
);
create index ai_rop_manager_scores_idx on public.ai_rop_manager_scores(manager_id, period_end desc);
alter table public.ai_rop_manager_scores enable row level security;

-- 2.7 ai_rop_trainer_sessions
create table public.ai_rop_trainer_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  scenario_id text not null,
  scenario_title text not null,
  scenario_role public.trainer_role not null,
  scenario_channel public.trainer_channel not null,
  difficulty text not null,
  messages jsonb not null default '[]'::jsonb,
  voice_recording_url text,
  score int,
  feedback text,
  improvements text[],
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.ai_rop_trainer_sessions enable row level security;

-- updated_at triggers
create trigger ai_rop_settings_updated_at before update on public.ai_rop_settings
  for each row execute function public.update_updated_at_column();
create trigger ai_rop_scripts_updated_at before update on public.ai_rop_scripts
  for each row execute function public.update_updated_at_column();
create trigger ai_rop_content_ideas_updated_at before update on public.ai_rop_content_ideas
  for each row execute function public.update_updated_at_column();

-- RLS policies — use existing user_can_access_project() (admin OR project creator).
-- ai_rop_settings
create policy "rop_settings_select" on public.ai_rop_settings for select
  using (public.user_can_access_project(project_id));
create policy "rop_settings_insert" on public.ai_rop_settings for insert
  with check (public.user_can_access_project(project_id));
create policy "rop_settings_update" on public.ai_rop_settings for update
  using (public.user_can_access_project(project_id));
create policy "rop_settings_delete" on public.ai_rop_settings for delete
  using (public.user_can_access_project(project_id));

-- ai_rop_scripts
create policy "rop_scripts_select" on public.ai_rop_scripts for select
  using (public.user_can_access_project(project_id));
create policy "rop_scripts_insert" on public.ai_rop_scripts for insert
  with check (public.user_can_access_project(project_id));
create policy "rop_scripts_update" on public.ai_rop_scripts for update
  using (public.user_can_access_project(project_id));
create policy "rop_scripts_delete" on public.ai_rop_scripts for delete
  using (public.user_can_access_project(project_id));

-- ai_rop_content_ideas
create policy "rop_content_select" on public.ai_rop_content_ideas for select
  using (public.user_can_access_project(project_id));
create policy "rop_content_insert" on public.ai_rop_content_ideas for insert
  with check (public.user_can_access_project(project_id));
create policy "rop_content_update" on public.ai_rop_content_ideas for update
  using (public.user_can_access_project(project_id));
create policy "rop_content_delete" on public.ai_rop_content_ideas for delete
  using (public.user_can_access_project(project_id));

-- ai_rop_call_analyses
create policy "rop_calls_select" on public.ai_rop_call_analyses for select
  using (public.user_can_access_project(project_id));
create policy "rop_calls_insert" on public.ai_rop_call_analyses for insert
  with check (public.user_can_access_project(project_id));
create policy "rop_calls_update" on public.ai_rop_call_analyses for update
  using (public.user_can_access_project(project_id));
create policy "rop_calls_delete" on public.ai_rop_call_analyses for delete
  using (public.user_can_access_project(project_id));

-- ai_rop_chat_analyses
create policy "rop_chats_select" on public.ai_rop_chat_analyses for select
  using (public.user_can_access_project(project_id));
create policy "rop_chats_insert" on public.ai_rop_chat_analyses for insert
  with check (public.user_can_access_project(project_id));
create policy "rop_chats_update" on public.ai_rop_chat_analyses for update
  using (public.user_can_access_project(project_id));
create policy "rop_chats_delete" on public.ai_rop_chat_analyses for delete
  using (public.user_can_access_project(project_id));

-- ai_rop_manager_scores
create policy "rop_mscores_select" on public.ai_rop_manager_scores for select
  using (public.user_can_access_project(project_id));
create policy "rop_mscores_insert" on public.ai_rop_manager_scores for insert
  with check (public.user_can_access_project(project_id));
create policy "rop_mscores_update" on public.ai_rop_manager_scores for update
  using (public.user_can_access_project(project_id));
create policy "rop_mscores_delete" on public.ai_rop_manager_scores for delete
  using (public.user_can_access_project(project_id));

-- ai_rop_trainer_sessions — личные сессии пользователя в рамках проекта
create policy "rop_trainer_select" on public.ai_rop_trainer_sessions for select
  using (user_id = auth.uid() or public.user_can_access_project(project_id));
create policy "rop_trainer_insert" on public.ai_rop_trainer_sessions for insert
  with check (user_id = auth.uid() and (project_id is null or public.user_can_access_project(project_id)));
create policy "rop_trainer_update" on public.ai_rop_trainer_sessions for update
  using (user_id = auth.uid());
create policy "rop_trainer_delete" on public.ai_rop_trainer_sessions for delete
  using (user_id = auth.uid());
