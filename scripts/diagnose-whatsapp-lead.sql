-- Lovable → Supabase → SQL Editor (MarkVision mekwfbqmsqiborjdrjxc)
-- Диагностика: лид создаётся webhook'ом, но не виден в CRM UI?

-- 1) Лид существует? Кому принадлежит?
SELECT id, phone, project_id, assigned_to, created_by, stage_id, pipeline_id, channel, created_at
  FROM public.leads
 WHERE id = '13a65fe0-0464-46b0-a043-f13510754690';

-- 2) Сообщения сохранены?
SELECT id, lead_id, direction, content, channel, created_at
  FROM public.communications
 WHERE lead_id = '13a65fe0-0464-46b0-a043-f13510754690'
 ORDER BY created_at;

-- 3) Инстанс Green API привязан к проекту?
SELECT project_id, id_instance, bot_webhook_url, connected
  FROM public.whatsapp_config
 WHERE id_instance = '7107618939';

-- 4) Первый этап воронки проекта (куда должен попасть новый лид)
SELECT ps.id AS stage_id, ps.title, ps.order_index, p.id AS pipeline_id, p.project_id
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
 WHERE p.project_id = (
   SELECT project_id FROM public.whatsapp_config WHERE id_instance = '7107618939' LIMIT 1
 )
 ORDER BY p.is_default DESC, p.created_at, ps.order_index
 LIMIT 3;

-- 5) Видит ли текущий пользователь лид? (замените UUID на свой auth.users.id)
-- SELECT public.user_can_access_project('cceb9a86-687b-4417-9b4e-d106bd8cc79c'::uuid);

-- Интерпретация:
-- • lead есть, communications есть, project_id совпадает с whatsapp_config → чинить RLS (scripts/fix-whatsapp-leads-visibility.sql)
-- • lead есть, но project_id NULL или другой проект → чинить whatsapp_config.id_instance → project_id
-- • assigned_to/created_by NULL у старых лидов → backfill в fix-whatsapp-leads-visibility.sql
-- • lead нет → проблема на стороне webhook / бота (до CRM)
