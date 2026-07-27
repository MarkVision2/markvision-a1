-- Трекинг вступления в WhatsApp-группу.
-- group_id — chatId группы (…@g.us), к которой ведёт рассылка;
-- joined_at — когда получатель реально появился в составе группы (детект по
-- getGroupData в broadcast-group-sync). Отдельный timestamp: не меняет статус
-- доставки, чтобы не ломать кумулятивную воронку.
alter table public.broadcast_campaigns add column if not exists group_id text;
alter table public.broadcast_recipients add column if not exists joined_at timestamptz;

-- Быстрый матч участников группы по телефону в рамках проекта.
create index if not exists broadcast_recipients_project_phone_idx
  on public.broadcast_recipients (project_id, phone);

-- Кампании с привязкой к группе (для воркера group-sync).
create index if not exists broadcast_campaigns_group_idx
  on public.broadcast_campaigns (group_id) where group_id is not null;
