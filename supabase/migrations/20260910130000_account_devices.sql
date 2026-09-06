-- Устройство аккаунта: связь карточки аккаунта с облачным телефоном PhoneGrid.
--
-- Публикация идёт через официальные API площадок и телефона не требует, но завести
-- аккаунт, прогреть его и восстановить доступ можно только с устройства. Чтобы не держать
-- второй кабинет, телефон и прогрев видны в карточке аккаунта MarkVision, а PhoneGrid
-- остаётся движком под капотом (docs/PHONEGRID-VS-OWN.md).
--
-- Никаких паролей от площадок здесь не хранится и храниться не должно: вход в приложение
-- делает человек руками на самом телефоне, платформа знает только id устройства.

alter table public.publish_accounts
  add column if not exists device_provider    text,
  add column if not exists device_phone_id    text,
  add column if not exists device_phone_name  text,
  add column if not exists warmup_started_at  timestamptz,
  add column if not exists warmup_last_run_at timestamptz,
  add column if not exists warmup_last_state  text;

comment on column public.publish_accounts.device_provider is
  'Поставщик устройства: phonegrid. NULL — аккаунт заведён без облачного телефона.';
comment on column public.publish_accounts.device_phone_id is
  'Id облачного телефона у поставщика. Пароли площадок не хранятся — вход делает человек на устройстве.';
comment on column public.publish_accounts.warmup_started_at is
  'Начало прогрева. День прогрева считается от неё; с 15-го дня аккаунт готов к публикации.';
comment on column public.publish_accounts.warmup_last_state is
  'Итог последнего прогона RPA: выполнена / ошибка + причина. Для карточки аккаунта.';

-- Одно устройство — один аккаунт: на телефоне живёт ровно один аккаунт площадки,
-- иначе площадка связывает их между собой по отпечатку устройства.
create unique index if not exists publish_accounts_device_uniq
  on public.publish_accounts (device_provider, device_phone_id)
  where device_phone_id is not null;
