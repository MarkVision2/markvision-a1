-- Вебхук Instagram может доставить одно и то же событие комментария дважды
-- (Meta официально не гарантирует ровно однократную доставку). Раньше
-- ig-webhook проверял "уже обработано?" через SELECT, а вставлял запись
-- только после публичного ответа и приватного DM — между проверкой и
-- вставкой было большое окно гонки (несколько await к Graph API), из-за чего
-- два почти одновременных вебхука оба проходили проверку и оба постили
-- публичный ответ. Уникальный constraint на external_id + переход на
-- "застолбить строку insert'ом до всех действий" в коде убирают гонку.
create unique index if not exists instagram_organic_events_external_id_key
  on instagram_organic_events (external_id)
  where external_id is not null;
