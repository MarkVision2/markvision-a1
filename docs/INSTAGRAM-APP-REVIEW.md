# Meta App Review: права Instagram Login для сети аккаунтов

Этап 0 ТЗ `docs/TZ-instagram-100-accounts.md`. Пока приложение не получило расширенный
доступ к правам, подключаться могут только аккаунты с ролью в приложении — сотню так не
подключить. Здесь всё, что вписать в форму, по какому сценарию снять видео и как
проверить, что заявка подана. Образец — `docs/TIKTOK-DEVELOPER-APP.md`.

```
Клиент                      Supabase Edge                          Instagram
/connect/<token> ──start──▶ publish-oauth/invite/start ──302──▶ instagram.com/oauth/authorize
                ◀─return── publish-oauth/callback/instagram-login ◀── code → api.instagram.com/oauth/access_token
                                                                   → graph.instagram.com/access_token (long-lived, 60 дн.)
                                                                   → graph.instagram.com/me (профиль)
очередь publish_jobs ──────▶ graph.instagram.com/<ig-user-id>/media → media_publish (Reels)
```

## Где смотреть в консоли Meta (06.09.2026)

Приложение **MarkVision AI**, ID `943753324681398`, режим **Опубликовано** (Live). Внутри —
сценарий использования **Instagram API** (`use_case_enum=INSTAGRAM_BUSINESS`) с отдельным
приложением Instagram **MarkVision AI-IG**, ID `1286921913377056`. Именно этот ID лежит в
секрете `INSTAGRAM_APP_ID` (пара `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`, не `META_APP_*`).

| Что | Где |
|---|---|
| Статус прав | Сценарии использования → Instagram API → **Разрешения и функции** |
| Заявки на ревью | Левое меню **Проверка → Проверка приложения** (App Review → Requests) |
| Redirect URI | Сценарии использования → Instagram API → **Настройка API для входа в Instagram** → «3. Настройте бизнес-вход» → Redirect URIs |
| Тестировщики | **Роли в приложении** → Добавить людей → Instagram-тестировщик |

Статусы права в таблице «Разрешения и функции»:

| Статус | Что значит |
|---|---|
| **Готово к тестированию** | право добавлено, но расширенного доступа нет: работает только у аккаунтов с ролью. **Так сейчас у обоих нужных прав** — заявка не одобрена |
| На проверке | заявка подана, ждём Meta (дни–недели) |
| Расширенный доступ / Готово к использованию | одобрено, подключается любой профессиональный аккаунт |
| Отклонено | причина внутри заявки; исправить и подать снова |

Колонка «Требования» — это число вызовов API за 30 дней (перевод «Requests»), не требования.

## Какие права просить

Ровно те, что запрашивает код (`INSTAGRAM_LOGIN_SCOPES` в `_lib/publishOAuth.ts`):

| Право | Зачем | Что показать в видео |
|---|---|---|
| `instagram_business_basic` | карточка подключённого аккаунта: id, @username, имя, аватар, подписчики, тип аккаунта | аккаунт появился в сетке проекта с @username и аватаром |
| `instagram_business_content_publish` | публикация Reels из очереди MarkVision от имени аккаунта | ролик поставлен в очередь → опубликован → виден в Instagram |

`instagram_business_manage_comments` из запроса убрано: функции под него нет, а каждое
запрошенное право обязано быть показано в деле — иначе отклоняют всю заявку. Список прав в
заявке должен совпадать с запросом OAuth один в один (лишнее в OAuth у обычного пользователя
даёт ошибку «Invalid scope»).

## Форма приложения (что вписать)

**App name:** MarkVision AI
**Category:** Business and pages / Marketing
**Website:** `https://www.markvision.kz`
**Privacy Policy URL:** `https://www.markvision.kz/privacy`
**Terms of Service URL:** `https://www.markvision.kz/terms`
**User data deletion:** «Data deletion instructions URL» → `https://www.markvision.kz/privacy#instagram`
(раздел «Интеграция с Instagram»: отключение в сетке, отзыв в Instagram, удаление по запросу
в 30 дней). Отдельный callback удаления не нужен, инструкции Meta принимает.
**Contact email:** `admin@markvision.kz`
**Developer:** MarkVision AI LLP (ТОО «MarkVision AI»), BIN 260240010690, Pavlodar, Kazakhstan
**Platforms:** Web

**Redirect URI** (должен быть в списке «Настройка API для входа в Instagram»):

```
https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-oauth/callback/instagram-login
```

**App description (EN):**

> MarkVision AI is a B2B marketing platform for businesses and agencies: ad management,
> CRM, content production and multi-platform publishing. The Instagram integration lets a
> business connect its own professional Instagram account (Business or Creator) to a
> MarkVision project and publish finished Reels from the MarkVision content queue to that
> account on a schedule. The account owner signs in with Instagram Login and confirms the
> permissions on Instagram's consent screen; MarkVision reads the account profile
> (instagram_business_basic) to show the connected account, and publishes videos
> (instagram_business_content_publish) only when a project user selects a video, writes
> the caption and schedules it. Access tokens are encrypted at rest and refreshed
> automatically; the user can disconnect the account at any time in MarkVision or revoke
> access in Instagram settings.

**Scope justification (EN)** — по абзацу на право, вставляется в поле «Опишите, как
ваше приложение использует это разрешение»:

`instagram_business_basic`
> Used to identify and display the connected professional Instagram account inside the
> customer's MarkVision project: user id, username, name, profile picture, follower count
> and account type. Without it the platform cannot show which account was connected or
> address it when publishing. Shown in the video at 0:45–1:20: after the consent screen
> the account card appears in the project's account grid.

`instagram_business_content_publish`
> Used to publish Reels that the customer prepared in MarkVision to their own connected
> Instagram account. The user selects a video from the project library, writes the
> caption and hashtags and schedules the post; the platform then creates the media
> container and publishes it via the Instagram Graph API. Shown in the video at
> 1:20–3:30: scheduling the video, the job going to «published», the Reel visible in the
> Instagram app.

## Сценарий демо-видео

Требования Meta: виден весь путь пользователя от входа до результата, каждое запрошенное
право показано в деле, домен в адресной строке совпадает с сайтом в форме, экран согласия
Instagram показан целиком. Интерфейс раздела «Публикации» русскоязычный, переключателя
нет — пояснять происходящее английскими субтитрами или закадровым голосом, Meta это
принимает. 3–5 минут.

**Перед записью:** отключить демо-аккаунт в сетке (иначе Instagram пропустит экран
согласия) и выдать свежую ссылку-приглашение:
`node scripts/instagram-connect.mjs links --project <uuid> --handles @demo --batch review --hours 24`.
Демо-аккаунт — профессиональный, с ролью Instagram-тестировщик в приложении (пока права
не одобрены, иначе согласие не пройдёт). Держать наготове вертикальный mp4 1080×1920.

1. **0:00 Кабинет.** Вход в MarkVision, `www.markvision.kz/marketing/publishing`, вкладка
   «Аккаунты»: сетка пустая или без демо-аккаунта. Диалог «Подключение по ссылке» →
   показать выданную ссылку `/connect/<token>` (кнопка копирования).
2. **0:30 Ссылка клиента.** Открыть `/connect/<token>` в отдельном окне: карточка
   «Проект … просит доступ на публикацию», кнопка **«Подключить аккаунт Instagram»**
   (вход логином Instagram, не через Facebook). Нажать.
3. **0:45 Экран согласия Instagram.** В кадре весь список: `instagram_business_basic`,
   `instagram_business_content_publish`. Нажать «Разрешить». Возврат на `/connect/…`:
   карточка «Успешно подключено» с именем аккаунта.
4. **1:10 Сетка.** Вернуться в кабинет: аккаунт появился со статусом «подключён»,
   @username, аватар, подписчики, тип Business — это `instagram_business_basic`.
5. **1:20 Публикация.** Вкладка «Видео» → «Залить видео» → выбрать mp4, заголовок, подпись с
   хэштегами → выбрать этот аккаунт, опубликовать сейчас. Вкладка «Задания»: задание
   `queued` → `processing` → `published` (воркер идёт раз в минуту, паузу можно вырезать).
   Открыть задание: трасса шагов, `external_post_id`, ссылка на пост.
6. **3:00 Instagram.** Открыть профиль в приложении Instagram или по ссылке: Reel на месте.
   Это `instagram_business_content_publish`.
7. **3:30 Отключение.** В сетке у аккаунта «Отключить» → аккаунт исчез. Показать в
   Instagram: Настройки → Безопасность → Приложения и сайты → MarkVision AI (удалить).
8. **3:50 Документы.** Кликнуть Privacy Policy → `/privacy#instagram`, Terms → `/terms`.

Тестовые данные для проверяющего (поле «Инструкции для проверки»):

> 1. Open https://www.markvision.kz/connect/<token> (a fresh single-use invite link
>    is attached). 2. Click «Подключить аккаунт Instagram» / «Connect Instagram account»,
> sign in with the test professional account below and allow both permissions.
> 3. You will be redirected back and see «Successfully connected». 4. Log in to
> https://www.markvision.kz with the test user below, open Marketing → Publishing:
> the account is in the grid; on the Videos tab click Upload, pick the sample video,
> choose the account and Publish — the job reaches «published» within two minutes and
> the Reel appears in the Instagram account.

Приложить: логин/пароль тестового пользователя MarkVision (роль менеджера проекта с одним
демо-проектом), логин/пароль тестового Instagram-аккаунта (Business, с ролью тестировщика),
ссылку-приглашение со сроком 14 дней (`--hours 336`, `max_uses` можно поднять до 5 через
интерфейс, чтобы проверяющий мог повторить).

## Чеклист перед подачей

- [ ] Ветка влита в `main`, задеплоены `publish-oauth` без `manage_comments` в scope и фронт с `/privacy#instagram`.
- [ ] `GET /publish-oauth/diag` (с `x-automation-key`): в `platforms` запись с `mode: "instagram"` имеет `client_id_prefix` = `12…` и `secret_had_whitespace: false`.
- [ ] Redirect URI `…/publish-oauth/callback/instagram-login` есть в «Настройка API для входа в Instagram».
- [ ] В «Разрешения и функции» добавлены ровно два права; ничего лишнего из Instagram-прав не добавлено (лишнее без демонстрации — отказ).
- [ ] Privacy / Terms / Data deletion URL вписаны в «Настройки приложения → Основное» и открываются.
- [ ] Демо-аккаунт — Business/Creator, роль «Instagram-тестировщик» принята в самом Instagram (Настройки → Приложения и сайты → Приглашения тестировщиков).
- [ ] Видео снято по сценарию, домен в адресной строке `www.markvision.kz`, экран согласия целиком в кадре.
- [ ] Тестовые доступы и живая ссылка-приглашение приложены к заявке.
- [ ] После одобрения: `Роли` больше не нужны, аккаунты подключаются по ТЗ пачками (`docs/TZ-instagram-100-accounts.md`, этапы 2–3).

## Пока ревью идёт: тестовая пятёрка через роли

Первые 3–5 аккаунтов подключаются без ожидания: **Роли в приложении → Добавить людей →
Instagram-тестировщик** → @хэндл. Владелец аккаунта принимает приглашение в Instagram:
Настройки → Приложения и сайты → Приглашения тестировщиков. Дальше аккаунт проходит обычный
OAuth и на нём проверяются вход в профиле, ссылка, продление токена и живая публикация
(этапы 2–5 ТЗ). Лимит тестировщиков у приложения небольшой, на сотню это не масштабируется.

## Частые причины отказа

| Причина | Как избежать |
|---|---|
| В видео не видно экрана согласия со списком прав | отключить аккаунт перед записью, иначе Instagram пропустит экран |
| Запрошено право, которое не показано в деле | список в заявке = `INSTAGRAM_LOGIN_SCOPES`, ничего сверх |
| Проверяющий не смог повторить путь | живая ссылка-приглашение + рабочие тестовые доступы, срок ссылки не меньше 14 дней |
| Домен в видео не совпадает с сайтом в форме | снимать на `www.markvision.kz`, не на превью Vercel и не на localhost |
| Нет инструкций по удалению данных | `https://www.markvision.kz/privacy#instagram` в поле Data deletion |
