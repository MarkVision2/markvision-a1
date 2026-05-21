# ТЗ: AI РОП — полная функциональность

> Документ для команды Lovable. Описывает backend-часть фичи AI РОП.
> Frontend и UX-каркас уже реализованы в этой ветке
> (`claude/ai-analytics-feature-RxEzz`) — Lovable нужно дорастить их данными
> и интеграциями.

## 0. Что уже сделано на фронте

В разделе **AI РОП** (`/sales-ai`) добавлено **9 вкладок** вместо 5:

| Вкладка | Статус | Что есть | Что нужно от Lovable |
|---------|--------|----------|----------------------|
| Обзор | ✅ Работает | KPI, горящие лиды, лидерборд | — |
| Звонки | 🟡 Демо-разбор | Структура UI, KPI из CRM, демо-карточка анализа звонка | Расшифровка + анализ реальных записей |
| Чаты | 🟡 Демо-разбор | Структура UI, KPI, топ-темы, демо-разбор переписки | Анализ реальных WhatsApp/Instagram чатов |
| Менеджеры | ✅ Базовый AI | Карточки с рейтингом, кнопка «Глубокий анализ» через Lovable AI | Расширить данными по звонкам/чатам |
| Тренажёр | ✅ Текстовый | Сценарии, чат-симуляция, оценка через Lovable AI | Голосовой режим (опц.), хранение в БД |
| Скрипты | ✅ Работает | CRUD + AI-генерация, localStorage | Перенести в Supabase, эффективность из аналитики |
| Контент-план | ✅ Работает | CRUD + AI-генерация, localStorage | Перенести в Supabase, источник = реальные чаты |
| Инсайты ИИ | ✅ Базово | Эвристики на CRM-данных | Заменить на глубокий LLM-анализ |
| Настройки | ✅ Работает | localStorage | Перенести в Supabase, чтобы шарить по проекту |

Все данные сейчас хранятся в `localStorage` через `src/lib/aiRopStorage.ts`.
Этот файл — единая точка перехвата: меняете `read`/`write` на supabase-вызовы
и весь UI начинает работать с базой без изменений в компонентах.

## 1. Бизнес-логика

### 1.1 Кто такой AI РОП

ИИ-руководитель отдела продаж клиники. Делает то же, что живой РОП:

1. **Слушает все звонки** менеджеров с клиентами.
2. **Читает все переписки** в WhatsApp, Instagram, Telegram.
3. **Ставит оценку** каждому разговору и каждой переписке (0-100).
4. **Оценивает менеджеров** интегрально: SLA, дозвон, конверсия, скрипты, эмпатия.
5. **Предлагает новые скрипты** на основе того, что работает в реальных диалогах.
6. **Генерирует контент-план** из вопросов и возражений клиентов.
7. **Помечает SLA-нарушения** в реальном времени.
8. **Тренирует администраторов** в режиме игры «пациент vs админ».

### 1.2 Тон и стиль

Настраивается в `Настройки → Тон обратной связи`:
- `strict` — строгий, акцент на ошибках
- `neutral` — сухие факты
- `supportive` — мягкий, с похвалой

### 1.3 Источники данных

- **CRM** — лиды, стадии, события (уже есть в `leads`, `events`)
- **Sipuni / другая телефония** — записи звонков (новая интеграция)
- **GreenAPI** — переписки WhatsApp (уже есть webhook)
- **Instagram Direct** — будущее
- **Lovable AI Gateway** (`google/gemini-2.5-flash`) — LLM для всех анализов

---

## 2. База данных (миграции)

### 2.1 `ai_rop_settings`
Хранит конфигурацию РОПа на проект.

```sql
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
```

RLS: пользователь видит/правит только настройки проектов, в которых состоит.
Структура полей **точно совпадает** с типом `RopSettings` в `src/lib/aiRopStorage.ts`.

### 2.2 `ai_rop_scripts`
Библиотека скриптов.

```sql
create type ai_script_category as enum (
  'greeting','objection_price','objection_no_time','objection_thinking',
  'closing','follow_up','missed_call','custom'
);
create type ai_script_source as enum ('manual','ai');

create table public.ai_rop_scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  category ai_script_category not null,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  source ai_script_source not null default 'manual',
  usage_count int not null default 0,
  effectiveness numeric,  -- 0..100, NULL пока не считали
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ai_rop_scripts(project_id, category);
alter table public.ai_rop_scripts enable row level security;
```

### 2.3 `ai_rop_content_ideas`
Идеи контент-плана.

```sql
create type content_format as enum ('reels','post','story','article','video');
create type content_priority as enum ('high','mid','low');
create type content_status as enum ('idea','in_progress','published','rejected');

create table public.ai_rop_content_ideas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  format content_format not null,
  priority content_priority not null default 'mid',
  status content_status not null default 'idea',
  hook text,
  body text,
  audience text,
  cta text,
  based_on text,  -- источник идеи
  source_lead_ids uuid[] default '{}', -- ссылки на лидов, из чьих чатов взято
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_rop_content_ideas enable row level security;
```

### 2.4 `ai_rop_call_analyses`
Результат анализа звонка.

```sql
create table public.ai_rop_call_analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  manager_id uuid references auth.users(id),
  -- Источник
  call_recording_url text,           -- ссылка на запись (S3/Supabase Storage)
  transcript text,                   -- расшифровка целиком
  transcript_segments jsonb,         -- [{speaker:'manager'|'lead', start, end, text}]
  duration_sec int,
  call_at timestamptz not null,
  -- Оценка ИИ
  overall_score int check (overall_score between 0 and 100),
  criteria jsonb,  -- [{name, score, note}]
  strengths text[],
  weaknesses text[],
  main_mistake text,
  recommended_script_id uuid references public.ai_rop_scripts(id),
  -- Тематика
  topics text[],         -- вытащенные темы разговора
  objections text[],     -- найденные возражения
  -- Метаданные
  ai_model text,
  processed_at timestamptz not null default now()
);
create index on public.ai_rop_call_analyses(project_id, call_at desc);
create index on public.ai_rop_call_analyses(manager_id, call_at desc);
alter table public.ai_rop_call_analyses enable row level security;
```

### 2.5 `ai_rop_chat_analyses`
Анализ переписки (один диалог = одна запись, переоценивается по мере прихода новых сообщений).

```sql
create table public.ai_rop_chat_analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  manager_id uuid references auth.users(id),
  channel text,  -- 'whatsapp' | 'instagram' | 'telegram'
  -- Метрики
  message_count int,
  first_response_min int,            -- минут до первого ответа менеджера
  avg_response_min numeric,
  -- Оценка
  overall_score int check (overall_score between 0 and 100),
  criteria jsonb,
  strengths text[],
  weaknesses text[],
  -- Тематика
  topics text[],
  objections text[],
  -- Флаги
  flag_price_without_qualification boolean default false,
  flag_no_closing boolean default false,
  flag_ghosted_by_manager boolean default false,
  ai_model text,
  processed_at timestamptz not null default now(),
  unique(lead_id)  -- одна оценка на лид, обновляется
);
alter table public.ai_rop_chat_analyses enable row level security;
```

### 2.6 `ai_rop_manager_scores`
Снимки оценок менеджеров (для динамики).

```sql
create table public.ai_rop_manager_scores (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  manager_id uuid references auth.users(id) on delete cascade,
  -- Период
  period_start date not null,
  period_end date not null,
  -- Итоги
  overall_score int,
  sla_score int,
  dial_score int,
  conversion_score int,
  scripts_score int,
  empathy_score int,
  -- Детализация
  leads_assigned int,
  leads_paid int,
  calls_total int,
  calls_avg_score numeric,
  chats_total int,
  chats_avg_score numeric,
  -- ИИ-разбор
  ai_report text,
  ai_recommendations text[],
  generated_at timestamptz not null default now()
);
create index on public.ai_rop_manager_scores(manager_id, period_end desc);
alter table public.ai_rop_manager_scores enable row level security;
```

### 2.7 `ai_rop_trainer_sessions`
История тренировок.

```sql
create type trainer_channel as enum ('phone','whatsapp','instagram');
create type trainer_role as enum ('patient','lead');

create table public.ai_rop_trainer_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  scenario_id text not null,        -- из enum фронта (TRAINER_SCENARIOS)
  scenario_title text not null,
  scenario_role trainer_role not null,
  scenario_channel trainer_channel not null,
  difficulty text not null,
  messages jsonb not null default '[]', -- [{id, role, content, at}]
  voice_recording_url text,         -- для голосового тренажёра
  score int,
  feedback text,
  improvements text[],
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.ai_rop_trainer_sessions enable row level security;
```

### 2.8 RLS — общая логика

Все таблицы должны давать доступ юзерам, которые состоят в `project_users`
(или аналогичный membership-механизм проекта). Образец policy:

```sql
create policy "Project members can read"
on public.ai_rop_scripts for select
using (
  exists (
    select 1 from public.project_users pu
    where pu.project_id = ai_rop_scripts.project_id
      and pu.user_id = auth.uid()
  )
);
```

---

## 3. Edge functions

Все функции принимают JWT, проверяют через `requireUser` (см. `_lib/auth.ts`),
работают через `LOVABLE_API_KEY` и модель `google/gemini-2.5-flash`.

### 3.1 `ai-rop-chat` (расширение существующего `report-ai-chat`)

**Что есть сейчас:** `report-ai-chat` принимает `{ mode, question, ... }`.
Фронтенд тренажёра, скриптов, контент-плана и анализа менеджеров **уже сейчас**
работает через него (в режиме `mode: "question"`).

**Что улучшить:**
- Принимать `system_prompt` из `ai_rop_settings`, не зашивать в коде.
- Поддерживать `mode: "trainer-reply"`, `mode: "score"`, `mode: "script"`,
  `mode: "content"`, `mode: "manager"` — каждый со своей системной инструкцией.
- Логировать запросы в `ai_rop_logs` для аудита.

### 3.2 `ai-rop-analyze-call` (новая)

**Триггер:** webhook от телефонии или ручной запуск.
**Вход:**
```json
{
  "lead_id": "uuid",
  "recording_url": "https://...",
  "duration_sec": 272,
  "manager_id": "uuid",
  "call_at": "ISO"
}
```
**Что делает:**
1. Скачивает запись.
2. Расшифровывает через Whisper (OpenAI) или другой ASR. Lovable AI Gateway
   уже умеет `openai/whisper-1` — использовать его.
3. Делит на сегменты по спикерам (diarization). Если diarization недоступен —
   эвристика по чередованию.
4. Передаёт транскрипт + чек-лист из `ai_rop_settings.watch_list` в LLM.
5. Получает JSON со структурой:
   ```json
   {
     "overall_score": 73,
     "criteria": [
       {"name":"Приветствие по скрипту","score":90,"note":"..."},
       ...
     ],
     "strengths": ["..."],
     "weaknesses": ["..."],
     "main_mistake": "...",
     "topics": ["имплантация","цена"],
     "objections": ["дорого"]
   }
   ```
6. Сохраняет в `ai_rop_call_analyses`.
7. Если `criteria` содержит низкий балл по «отработка возражения» — создаёт идею
   нового скрипта в `ai_rop_scripts` (если `auto_suggest_scripts = true`).

### 3.3 `ai-rop-analyze-chat` (новая)

**Триггер:** при каждом новом сообщении менеджера в чате (после ответа лиду),
плюс по расписанию для дожима. Дёргается из `greenapi-webhook` после сохранения
сообщения.

**Что делает:**
1. Берёт все сообщения по `lead_id`.
2. Считает метрики: время первого ответа, среднее время, кол-во сообщений.
3. Подсовывает LLM весь диалог + чек-лист из `watch_list` (для чатов).
4. Парсит JSON с оценкой.
5. Апсёртит запись в `ai_rop_chat_analyses` (PK = `lead_id`).
6. Если `flag_price_without_qualification` — создаёт задачу или уведомление
   в `notifications`.

### 3.4 `ai-rop-score-manager` (новая)

**Триггер:** ежедневно ночью + по запросу с фронта (кнопка «Глубокий анализ»).

**Что делает:**
1. Берёт всех менеджеров проекта.
2. Для каждого:
   - Считает базовые метрики (`leads_assigned`, `paid`, `conversion`,
     SLA из `events`).
   - Берёт средний балл по `ai_rop_call_analyses` и `ai_rop_chat_analyses`
     за период.
   - Считает интегральный балл (формула в `src/components/sales-ai/AiRopManagersAnalysis.tsx`,
     функция `computeAiScore` — расширить).
   - Просит LLM написать разбор (4-5 предложений) + 2-3 рекомендации.
3. Кладёт строку в `ai_rop_manager_scores`.

**На фронте**: компонент `AiRopManagersAnalysis` уже умеет показывать
`reports[m.member.id]` — нужно подменить вызов `analyzeManager` на чтение
последней строки из `ai_rop_manager_scores`.

### 3.5 `ai-rop-generate-script` (новая)

**Триггер:** кнопка «Сгенерировать ИИ» в скриптах + автозапуск раз в день
при `auto_suggest_scripts = true`.

**Что делает:**
1. Берёт `ai_rop_call_analyses` и `ai_rop_chat_analyses` за последние 7 дней.
2. Группирует по `objections`. Находит самое частое возражение, где средний
   балл по `criteria[name='отработка возражения']` низкий.
3. Берёт реальные удачные фрагменты разговоров, где такое возражение
   отработали хорошо (high score).
4. Просит LLM скомпилировать новый скрипт на основе этих примеров.
5. Сохраняет в `ai_rop_scripts` с `source = 'ai'`.

### 3.6 `ai-rop-generate-content` (новая)

**Триггер:** кнопка «Сгенерировать идею» + автозапуск раз в неделю.

**Что делает:**
1. Берёт топ-10 повторяющихся `topics` и `objections` из чатов и звонков
   за последние 30 дней.
2. Просит LLM создать идею контента, используя самые частые вопросы клиентов.
3. Сохраняет в `ai_rop_content_ideas` с `based_on = "Топ-вопрос за 30 дней"`,
   `source_lead_ids = [список лидов]`.

### 3.7 `ai-rop-trainer-voice` (новая, опц.)

**Назначение:** голосовой тренажёр — ИИ говорит голосом, пользователь отвечает
голосом, после разговора получает оценку.

**Стек:**
- **ASR:** Whisper (через Lovable AI Gateway).
- **TTS:** ElevenLabs (рекомендую) или OpenAI TTS.
- **LLM:** Lovable AI Gateway (Gemini Flash).
- **Транспорт:** WebRTC + Supabase Realtime (для стриминга), или простой
  HTTP с записью на стороне фронта и батчевой обработкой.

**MVP-флоу:**
1. Фронт стартует запись микрофона.
2. На end-of-speech фронт отправляет аудио-чанк в edge function.
3. Функция: Whisper → текст → LLM ответ → TTS → MP3 → фронт играет.
4. По окончании сессии фронт вызывает `ai-rop-score-trainer`, получает
   оценку и feedback.

**Альтернатива для будущего:** OpenAI Realtime API — речь-в-речь в одно
соединение, низкая задержка, дороже. Lovable должны решить.

---

## 4. Интеграции

### 4.1 Sipuni (или другая телефония)

**Что нужно:** webhook о завершении звонка с URL записи.

В Sipuni это настраивается через `Интеграции → Уведомления → URL для CDR`.

В нашем приложении уже есть `sipuni-call` (исходящий звонок).
**Добавить** `sipuni-cdr-webhook` — приёмник, который:
1. Принимает POST от Sipuni с `recording_url`, `duration`, `caller_id`,
   `called_id`, `started_at`.
2. Находит лид по `phone`.
3. Сохраняет `call_made` event с `payload.recording_url` и `payload.duration`.
4. Кладёт задачу в очередь `ai-rop-analyze-call`.

### 4.2 GreenAPI

Уже работает: `greenapi-webhook` создаёт лиды и кладёт сообщения.

**Дополнить:**
- После сохранения исходящего сообщения менеджера — триггер `ai-rop-analyze-chat`
  по `lead_id`.
- Триггер аккуратный (дебаунс 30 сек, не на каждое сообщение).

### 4.3 Instagram Direct

Не в MVP. Когда будет — повторить логику GreenAPI.

---

## 5. UI: что подключить после миграции

После того как Lovable выкатит миграции и edge functions:

1. **Перенести `aiRopStorage.ts`** на Supabase:
   - `getRopSettings()` → `supabase.from('ai_rop_settings').select().single()`
   - `saveRopSettings()` → `upsert`
   - Аналогично для `getScripts`, `getContentIdeas`, `getTrainerSessions`.
   - Сделать через React Query, чтобы UI обновлялся реактивно.

2. **`AiRopManagersAnalysis`**: вместо `analyzeManager()` (который сейчас
   синхронно зовёт LLM) — читать последний снимок из `ai_rop_manager_scores`.

3. **`AiRopCallsAnalysis`**: вместо демо-карточки — отдельный route
   `/sales-ai/call/:id` с реальным разбором из `ai_rop_call_analyses`.
   Демо-блок оставить только для пустого состояния.

4. **`AiRopChatsAnalysis`**: аналогично — реальные оценки из
   `ai_rop_chat_analyses`. Топ-темы — `select topic, count(*) from ai_rop_chat_analyses
   cross join unnest(topics) as topic ... group by topic order by count desc`.

5. **`AiRopTrainer`**: при наличии `voice_recording_url` — показывать плеер.
   Кнопку «🎙 Голосовой режим» — открывать новый компонент `VoiceTrainerSession`.

---

## 6. Метрики успеха (для понимания «получилось ли»)

- ≥80% звонков длительностью >30 сек получают AI-разбор в течение 5 минут.
- ≥90% чатов с активностью получают AI-оценку в течение часа.
- При включённом `auto_suggest_scripts` — РОП сам выдаёт ≥1 новый скрипт
  в неделю на основе реальных диалогов.
- При включённом `auto_generate_content` — ≥3 идеи контента в неделю.
- Оценки менеджеров обновляются ежедневно.

---

## 7. Порядок выкатки

1. Миграции (раздел 2).
2. `ai-rop-chat` (расширить существующую `report-ai-chat`).
3. Подмена `aiRopStorage.ts` на Supabase — фронт начнёт хранить настройки/скрипты
   в БД.
4. `ai-rop-analyze-chat` + триггер из `greenapi-webhook` — оценка переписок.
5. `ai-rop-analyze-call` + `sipuni-cdr-webhook` — оценка звонков (требует
   подключения CDR в Sipuni).
6. `ai-rop-score-manager` (cron + on-demand).
7. `ai-rop-generate-script` + `ai-rop-generate-content` (cron).
8. (Опц.) `ai-rop-trainer-voice` — голосовой тренажёр.

---

## 8. Что НЕ делаем в этой итерации

- Голосовой бот, который сам звонит лидам (это уже не РОП, это лид-генерация).
- Автоматические ответы клиентам без участия менеджера. РОП **советует**,
  а не **отвечает**.
- Принудительные KPI-штрафы. Только показываем нарушения, решения принимает
  владелец клиники.

---

## 9. Стоимость и квоты

Lovable AI Gateway тарифицирует токены. Учесть:

- Анализ одного звонка (~5 мин) ≈ 3-4К токенов транскрипта + 1К ответ ≈ ¢5-10.
- Анализ чата (≈20 сообщений) ≈ 1К токенов ≈ ¢1-2.
- Анализ менеджера (раз в день) ≈ 2К токенов ≈ ¢2-4.

Для клиники с 50 лидов/день и 20 звонков/день — порядка $30-60/мес на
LLM-инференс. Whisper и TTS — отдельно. Это уровень приемлемого.

Для очень больших клиентов стоит добавить дешёвую модель (`gemini-2.5-flash-lite`)
для скоринга чатов и оставить полную модель только для звонков и менеджеров.
