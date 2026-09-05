# TikTok for Developers: регистрация приложения и раздел «Подключение TikTok»

Всё, что нужно, чтобы подать приложение MarkVision на App review в TikTok for
Developers и показать интеграцию в демо-видео: что уже есть в коде, что
заполнить в форме, как настроить песочницу и по какому сценарию снимать ролик.

```
Сайт (React)                  Supabase Edge                    TikTok
/settings?tab=tiktok ──start──▶ publish-oauth/start ──302──▶ tiktok.com/v2/auth/authorize
                   ◀─return── publish-oauth/callback/tiktok ◀── code → open.tiktokapis.com/v2/oauth/token
                   ──action─▶ tiktok-connect ─────────────▶ /v2/user/info, /v2/video/list,
                                                            /v2/post/publish/*, /v2/oauth/revoke
/terms, /privacy   — публичные страницы, адреса для формы приложения
```

## Что реализовано

| Продукт TikTok | Scopes | Где в интерфейсе | Код |
|---|---|---|---|
| **Login Kit** | `user.info.basic` | Блок 1 — кнопка «Продолжить с TikTok», список подключённых аккаунтов | `publish-oauth` (start/callback), `_lib/publishOAuth.ts` |
| **Display API** | `user.info.profile`, `user.info.stats`, `video.list` | Блок 3 — профиль (аватар, @username, био, подписчики/лайки/видео); блок 4 — сетка видео с просмотрами/лайками/комментариями | `tiktok-connect` actions `profile`, `videos`; `_lib/tiktokApi.ts` |
| **Content Posting API** | `video.publish` (Direct Post), `video.upload` (Upload to inbox) | Блок 5 — форма публикации: автор из `creator_info`, заголовок, приватность, комментарии/дуэты/стичи, раскрытие коммерческого контента, AIGC, статус до `PUBLISH_COMPLETE` | `tiktok-connect` actions `creator_info`, `publish`, `publish_status` |
| Отключение | — | Кнопка «Отключить» у аккаунта → `/v2/oauth/revoke/` + удаление токенов | `tiktok-connect` action `disconnect` |
| **Share Kit** | — | **Не используем** (продукт для мобильных приложений). Перед подачей удалите его из списка продуктов приложения, иначе ревью задержат | — |

Раздел: `src/components/settings/TikTokConnect.tsx` — таб «TikTok» в
«Настройки → Подключения» (`/settings?tab=tiktok`, модуль `settings`); старый
адрес `/marketing/tiktok` редиректит туда же. Интерфейс
двуязычный — переключатель RU/EN в шапке; для демо-видео включите **EN**.
Каждый блок пронумерован (1–6), по номерам удобно вести ролик.

Права по продуктам и формулировки «зачем» — каталог `TIKTOK_SCOPES` в
`supabase/functions/_lib/tiktokApi.ts`; из него же собирается строка `scope`
для OAuth (`SCOPES.tiktok`) и карточки в блоке 2.

Юридические страницы (общие для всей платформы, RU/EN):
`https://www.markvision.kz/terms` и `https://www.markvision.kz/privacy`
(`src/pages/Legal.tsx`, тексты — `src/data/legalContent.ts`). Реквизиты
оператора — `LEGAL_ORG` в том же файле, заполнены по справке о госрегистрации:
ТОО «MarkVision AI», БИН 260240010690, Павлодар, ул. Камзина 41/1, кв. 82,
140011; email `admin@markvision.kz`. При смене адреса/почты править только там.

## Секреты и настройка

Supabase → Edge Functions → Secrets:

| Секрет | Что | Откуда |
|---|---|---|
| `TIKTOK_CLIENT_KEY` | Client key приложения (`aw…` прод, `sbaw…` песочница) | Developer Portal → приложение → App details |
| `TIKTOK_CLIENT_SECRET` | Client secret | там же |
| `TIKTOK_SCOPES` | *(необязательно)* список прав через запятую, если у песочницы подключены не все продукты | по умолчанию — весь каталог |
| `PUBLISH_TOKEN_KEY` | ключ шифрования токенов аккаунтов | уже используется очередью публикаций |

Redirect URI, который надо зарегистрировать в Login Kit приложения (и в
песочнице тоже):

```
https://<project-ref>.supabase.co/functions/v1/publish-oauth/callback/tiktok
```

Точный адрес показывает блок 6 на странице и `GET /publish-oauth/diag`.
Redirect URI на домене Supabase допустим: TikTok требует HTTPS и точное
совпадение с зарегистрированным, а не совпадение с доменом сайта. Домен сайта
(`www.markvision.kz`) указывается отдельно в поле Web/Desktop URL и должен
совпадать с тем, что видно в демо-видео.

Проверка одной командой (ничего не меняет; ключ — `automation_settings.cron_secret`,
тот же, что у `publishing-doctor`):

```bash
node scripts/tiktok-doctor.mjs --key <cron_secret>
```

Показывает: задеплоены ли `publish-oauth` и `tiktok-connect`, заданы ли
`TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` / `PUBLISH_TOKEN_KEY`, похож ли ключ
на ключ TikTok (`aw…` / `sbaw…`, не числовой App ID), что отвечает TikTok на
наш client key, открываются ли `/terms` и `/privacy` на боевом домене.

Деплой: функции `publish-oauth` и `tiktok-connect` (`verify_jwt = false` уже в
`supabase/config.toml`, JWT проверяется внутри). Миграций новых нет —
используется таблица `publish_accounts` (колонка `oauth_scope`).

## Песочница до одобрения

Пока приложение не Live, авторизоваться могут только target users песочницы:

1. Developer Portal → Manage apps → приложение → переключатель **Sandbox** →
   Create sandbox.
2. В песочнице добавить продукты **Login Kit**, **Display API**, **Content
   Posting API**; в Content Posting API включить Direct Post.
3. Scopes песочницы: `user.info.basic`, `user.info.profile`, `user.info.stats`,
   `video.list`, `video.upload`, `video.publish`. Если какой-то продукт добавить
   нельзя — уберите его scope через секрет `TIKTOK_SCOPES`.
4. **Target users** → Add account — TikTok-аккаунт, которым будете снимать демо
   (до 10 аккаунтов).
5. Взять Client key `sbaw…` и Secret песочницы → секреты `TIKTOK_CLIENT_KEY` /
   `TIKTOK_CLIENT_SECRET`, зарегистрировать redirect URI (см. выше).
6. Ограничения песочницы: Direct Post работает только в **приватный** аккаунт
   (`SELF_ONLY`; для публичного аккаунта TikTok отвечает
   `unaudited_client_can_only_post_to_private_accounts`); `PULL_FROM_URL` требует
   верифицированный домен видео — поэтому по умолчанию страница передаёт файл
   сама (`FILE_UPLOAD`, чанками), верификация домена не нужна.

Страница сама показывает бейдж «Песочница», если ключ начинается с `sbaw`.

## Форма приложения (что вписать)

**App name:** MarkVision AI
**Category:** Business / Marketing tools
**Web/Desktop URL:** `https://www.markvision.kz`
**Developer / company:** MarkVision AI LLP (ТОО «MarkVision AI»), BIN 260240010690, Pavlodar, Kazakhstan
**Contact email:** `admin@markvision.kz`
**Terms of Service URL:** `https://www.markvision.kz/terms`
**Privacy Policy URL:** `https://www.markvision.kz/privacy`
**Platforms:** Web

**App description (EN):**

> MarkVision AI is a B2B marketing platform for businesses and agencies: ad
> management, CRM, content production and multi-platform publishing. The TikTok
> integration lets a business connect its own TikTok account to a MarkVision
> project, see the account profile and published videos with their metrics,
> and post finished videos from the MarkVision content queue directly to TikTok
> (or send them to the TikTok inbox as drafts). Users sign in with TikTok
> (Login Kit), the platform reads profile and video data through the Display
> API, and publishes through the Content Posting API with the privacy level,
> interaction settings and commercial-content disclosure chosen by the user.
> Access tokens are encrypted at rest; the user can disconnect the account at
> any time, which revokes the token.

**Scope justification (EN)** — по одному абзацу на scope, формулировки из
каталога `TIKTOK_SCOPES` (`purpose.en`):

| Scope | Why we need it |
|---|---|
| `user.info.basic` | Identify the connected TikTok account inside the project: open_id, display name, avatar. |
| `user.info.profile` | Account card in the Publishing section and links to published videos (@username/video/…). |
| `user.info.stats` | Audience growth in project analytics and account health in the publishing network. |
| `video.list` | Feed of published videos and per-video views/likes/comments collection. |
| `video.upload` | Send a finished video to the TikTok inbox — the user finishes and posts it in the TikTok app. |
| `video.publish` | Publish a video from the MarkVision queue with the title, privacy level and settings chosen by the user. |

Если какой-то scope не нужен — удалите его и из формы, и из каталога
`TIKTOK_SCOPES` (иначе на странице согласия TikTok он будет запрошен, а в
заявке не заявлен — ревью задержат).

## Сценарий демо-видео

Требования TikTok: видео показывает сайт с тем же доменом, что указан в форме;
все выбранные продукты и scopes показаны в деле; виден интерфейс и действия
пользователя. Снимайте экран с адресной строкой `www.markvision.kz`, язык
интерфейса — EN (переключатель в шапке страницы), длительность 3–5 минут.

1. **Вход в MarkVision** (`/login`) → **Настройки** → «Подключения» → **TikTok**.
   В кадре адресная строка `https://www.markvision.kz/settings?tab=tiktok`.
2. **Блок 1 — Login Kit.** Нажать «Continue with TikTok» → страница согласия
   TikTok: показать список запрашиваемых прав → Authorize → возврат на
   страницу, тост «TikTok connected», аккаунт появился в списке со статусом
   Connected и open_id.
3. **Блок 2 — Permissions & products.** Прокрутить: три продукта, каждое право
   помечено Granted.
4. **Блок 3 — Display API, profile.** «Load profile» → аватар, имя, @username,
   био, подписчики/подписки/лайки/видео, строка «Requested fields» (видно, какие
   поля запрошены под какие scopes). Нажать «Open in TikTok» — открывается
   профиль.
5. **Блок 4 — Display API, videos.** «Load videos» → сетка роликов с
   просмотрами/лайками/комментариями/репостами; «Load more», клик по ролику
   открывает его в TikTok.
6. **Блок 5 — Content Posting API, Direct post.** Режим «Direct post»
   (`video.publish`): виден автор из creator_info; «Choose file» → загрузить
   короткое видео (прогресс); ввести заголовок с хэштегом; выбрать «Who can view
   this video» (в песочнице — Only me); показать переключатели Comment/Duet/
   Stitch (выключенные автором — неактивны); включить «Disclose commercial
   content» → «Your brand»; показать текст согласия под кнопкой → «Post to
   TikTok» → статус «TikTok is receiving the file» → «Published» → «Open the
   video» — ролик в TikTok.
7. **Блок 5 — Upload to inbox** (`video.upload`): режим «Draft to inbox» →
   выбрать файл → «Send draft to TikTok» → статус «Draft sent to the TikTok
   inbox»; показать в приложении TikTok уведомление/черновик во «Входящих».
8. **Отключение.** У аккаунта нажать «Disconnect» → подтверждение → тост
   «Account disconnected, token revoked»; список пуст. Опционально показать в
   TikTok: Settings → Security → Manage app permissions — приложения нет.
9. **Блок 6 — документы.** Кликнуть Terms of Service и Privacy Policy —
   открываются `www.markvision.kz/terms` и `/privacy` (раздел «TikTok
   integration» в политике).

Если мобильное приложение не заявлено — платформа только Web; начинать с
открытия приложения не нужно.

## Чеклист перед подачей

- [ ] Ветка влита в `main` — только так деплоятся функции (`tiktok-connect`,
      обновлённый `publish-oauth`) и фронт с `/settings?tab=tiktok`, `/terms`, `/privacy`.
- [ ] `node scripts/tiktok-doctor.mjs --key <cron_secret>` — без красных строк:
      секреты `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` (для демо — песочница) и
      `PUBLISH_TOKEN_KEY` заданы, ключ без `shape_problem`, страницы открываются.
- [ ] Redirect URI зарегистрирован в Login Kit (и в песочнице).
- [ ] В приложении оставлены только Login Kit, Display API, Content Posting
      API; Share Kit удалён; список scopes совпадает с `TIKTOK_SCOPES`.
- [ ] Демо-аккаунт добавлен в Target users песочницы, для Direct Post —
      приватный.
- [ ] Видео снято по сценарию выше, домен в адресной строке = Web URL в форме.
- [ ] После одобрения: заменить секреты на прод `aw…`, снять `TIKTOK_SCOPES`,
      при использовании `PULL_FROM_URL` верифицировать домен видео (URL
      properties) — иначе оставлять режим файла.

## Как это ложится на очередь публикаций

Аккаунт, подключённый на этой странице, — обычная строка `publish_accounts`
(`platform = tiktok`), поэтому он сразу доступен в разделе «Публикации»,
группах и автопостинге (`docs/PUBLISHING-SYSTEM.md`, `docs/AUTOPOSTING-PLATFORM.md`).
Очередь публикует через `PULL_FROM_URL` (`_lib/publishers/tiktok.ts`) — для
боевого режима нужен верифицированный домен видео; страница «Подключение
TikTok» использует `FILE_UPLOAD` и работает без верификации.
