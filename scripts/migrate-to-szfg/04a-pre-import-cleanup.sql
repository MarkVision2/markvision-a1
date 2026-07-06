-- Перед повторным импортом: убрать авто-воронки и дать влезть Lovable pipeline_id
SET session_replication_role = replica;

DELETE FROM public.pipeline_stages ps
USING public.pipelines p
WHERE ps.pipeline_id = p.id
  AND p.project_id IN (
    SELECT id FROM public.projects
    WHERE name IN ('MarkVision AI', 'Аск Мед')
  )
  AND p.id NOT IN (
    '3f6f3900-e6d1-427f-ab62-0d2cd6f6e4de'  -- Lovable MarkVision pipeline
  );

DELETE FROM public.pipelines p
WHERE p.project_id IN (
    SELECT id FROM public.projects WHERE name IN ('MarkVision AI', 'Аск Мед')
  )
  AND p.id NOT IN (
    '3f6f3900-e6d1-427f-ab62-0d2cd6f6e4de'
  );

SET session_replication_role = DEFAULT;
