-- CTA-кнопка WhatsApp + joined_at для invite-кликов.

alter table public.broadcast_campaigns
  add column if not exists cta_label text;

alter table public.broadcast_recipients
  add column if not exists joined_at timestamptz;

comment on column public.broadcast_campaigns.cta_label is
  'Подпись URL-кнопки WhatsApp (sendInteractiveButtons); пусто → авто по target_url';

comment on column public.broadcast_recipients.joined_at is
  'Клик по invite WhatsApp (прокси «в группе») или ручная отметка';
