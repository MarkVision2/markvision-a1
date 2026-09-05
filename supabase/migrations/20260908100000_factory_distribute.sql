-- Контент-завод: раскладка пачки «один ролик → один аккаунт».
--   publish_videos.topic_key — ключ темы: ролики с одним ключом не ставятся в один день
--   и, пока есть выбор, в один аккаунт (docs/TZ-content-factory-network.md, §4.6).
--   publish_videos.batch_id  — пачка производства, чтобы сводить статистику по прогону.

ALTER TABLE public.publish_videos
  ADD COLUMN IF NOT EXISTS topic_key text,
  ADD COLUMN IF NOT EXISTS batch_id text;

COMMENT ON COLUMN public.publish_videos.topic_key IS
  'Ключ темы для раскладки пачки: одна тема — разные дни и разные аккаунты (publish-intake action=distribute).';
COMMENT ON COLUMN public.publish_videos.batch_id IS
  'Пачка контент-завода (work/factory/<batch>), к которой относится ролик.';

CREATE INDEX IF NOT EXISTS publish_videos_batch_idx
  ON public.publish_videos (project_id, batch_id)
  WHERE batch_id IS NOT NULL;
