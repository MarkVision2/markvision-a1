-- Атрибуция лида к рассылке: кто пришёл в CRM через рассылку (source='broadcast')
-- и из какой именно кампании. Аналитика CRM по источнику «Рассылка» + воронка.
alter table public.leads add column if not exists broadcast_campaign_id uuid;

create index if not exists leads_broadcast_campaign_idx
  on public.leads (broadcast_campaign_id) where broadcast_campaign_id is not null;
