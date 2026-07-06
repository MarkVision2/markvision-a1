-- Данные «Аск Мед», отсутствующие в CSV-экспорте (проект + кабинет)
INSERT INTO public.projects (
  id, name, domain, initials, is_primary, created_by, created_at, updated_at, intake_token, creative_username
) VALUES (
  'cac7a9a2-d867-4558-8b9d-323e9098a985',
  'Аск Мед',
  NULL,
  'AM',
  FALSE,
  'f2be79d8-2d06-474d-9343-4b3e6ebba19f',
  '2026-06-01T00:00:00+00:00',
  '2026-06-30T00:00:00+00:00',
  'demoAskMedSzfg01',
  NULL
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ad_cabinets (
  id, project_id, name, external_id, online, type, spend, leads, lead_cost, sales, revenue,
  created_by, created_at, updated_at, currency, provider, days_of_week, timezone
) VALUES (
  'fe4779a3-ac4a-42ad-9f40-fdabd42b031b',
  'cac7a9a2-d867-4558-8b9d-323e9098a985',
  'Meta Ads — Аск Мед (демо)',
  'act_demo_ask_med',
  TRUE,
  'Демо',
  0, 0, 0, 0, 0,
  'f2be79d8-2d06-474d-9343-4b3e6ebba19f',
  '2026-06-01T00:00:00+00:00',
  '2026-06-30T00:00:00+00:00',
  'KZT',
  'meta',
  ARRAY[1,2,3,4,5,6,7],
  'Asia/Almaty'
) ON CONFLICT (id) DO NOTHING;
