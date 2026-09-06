-- Social Content Factory OS, Phase 4: политика AI проекта и происхождение заданий.
--
--   1. publish_project_settings.ai_policy — manual | assisted | automatic:
--      manual    — публикации, поставленные через API/MCP (AI-агентом), ждут согласования человека;
--      assisted  — до ai_daily_limit публикаций в сутки уходят сами, остальное — на согласование;
--      automatic — без ворот (как раньше).
--   2. publish_jobs.origin — кто поставил задание ('api' для API/MCP; NULL — интерфейс, конвейер, кампания).
--      Задание на согласовании: status = manual_review, error_code = 'awaiting_approval'.
--
-- Идемпотентна. Ничего не удаляет.

ALTER TABLE public.publish_project_settings
  ADD COLUMN IF NOT EXISTS ai_policy      text    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS ai_daily_limit integer NOT NULL DEFAULT 10;

ALTER TABLE public.publish_project_settings DROP CONSTRAINT IF EXISTS publish_project_settings_ai_policy_check;
ALTER TABLE public.publish_project_settings ADD CONSTRAINT publish_project_settings_ai_policy_check
  CHECK (ai_policy IN ('manual', 'assisted', 'automatic'));
ALTER TABLE public.publish_project_settings DROP CONSTRAINT IF EXISTS publish_project_settings_ai_daily_limit_check;
ALTER TABLE public.publish_project_settings ADD CONSTRAINT publish_project_settings_ai_daily_limit_check
  CHECK (ai_daily_limit BETWEEN 0 AND 10000);

COMMENT ON COLUMN public.publish_project_settings.ai_policy IS
  'Политика AI (docs/MCP.md): manual — публикации через API/MCP ждут согласования; assisted — до ai_daily_limit в сутки автоматически; automatic — без ворот.';
COMMENT ON COLUMN public.publish_project_settings.ai_daily_limit IS
  'assisted: сколько публикаций через API/MCP в сутки уходят без согласования.';

ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS origin text;
COMMENT ON COLUMN public.publish_jobs.origin IS
  'Кто поставил задание: api — публичный API / MCP (AI-агент); NULL — интерфейс, конвейер, кампания. По origin = api считается суточный лимит политики assisted.';

CREATE INDEX IF NOT EXISTS publish_jobs_origin_day_idx
  ON public.publish_jobs (project_id, created_at) WHERE origin = 'api';
CREATE INDEX IF NOT EXISTS publish_jobs_awaiting_idx
  ON public.publish_jobs (project_id) WHERE status = 'manual_review' AND error_code = 'awaiting_approval';
