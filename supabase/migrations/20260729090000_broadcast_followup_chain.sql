-- Догоняющие рассылки (follow-up цепочки): связь дочерней кампании с исходной.
-- Даёт «цепочку» рассылок — вторая волна по тем, кто не отреагировал на первую.
alter table public.broadcast_campaigns
  add column if not exists parent_campaign_id uuid;

create index if not exists broadcast_campaigns_parent_idx
  on public.broadcast_campaigns (parent_campaign_id)
  where parent_campaign_id is not null;
