/**
 * Облачные телефоны в карточке аккаунта: список, привязка, питание, прогрев.
 *
 * Интерфейс живёт в MarkVision, движок — PhoneGrid Open API (docs/PHONEGRID-VS-OWN.md).
 * Кабинет PhoneGrid открывать не нужно: всё, что нужно для заведения и прогрева аккаунта,
 * доступно отсюда.
 *
 * Чего эта функция НЕ делает намеренно:
 *   • не хранит и не принимает пароли площадок — вход в приложение делает человек
 *     руками на самом телефоне, платформа знает только id устройства;
 *   • не удаляет телефоны — списание и возврат средств остаются в кабинете PhoneGrid;
 *   • не публикует — публикация идёт через официальные API площадок.
 *
 * Действия (POST { action, project_id, … }):
 *   phones        — телефоны PhoneGrid: статус, прокси, аккаунт и день прогрева
 *   accounts_free — аккаунты проекта без телефона (для привязки из списка устройств)
 *   options       — что предложить в форме создания: модели, прокси, группы PhoneGrid
 *   create_phone  — создать устройство (ПЛАТНО, до 10 за раз)
 *   proxy_add     — добавить прокси строкой socks5://логин:пароль@хост:порт
 *   screen        — снимок экрана телефона (ссылка на картинку)
 *   input         — тап, свайп, текст, клавиша — как палец по экрану
 *   open_url      — открыть ссылку в браузере телефона (например, подключение аккаунта)
 *   apps          — что стоит на телефоне и что можно поставить
 *   install_app   — поставить приложение нужной версии
 *   attach        — привязать телефон к аккаунту (одно устройство = один аккаунт)
 *   detach        — отвязать
 *   power         — включить / выключить телефон (по phone_id или по аккаунту)
 *   warmup        — поставить прогрев на сегодня (RPA-задача)
 *   warmup_status — план прогрева и итог последних прогонов
 *
 * Права: смотреть (phones, warmup_status) — с правом чтения проекта; привязывать телефон,
 * включать его и запускать прогрев — с правом управления. Секреты — PHONEGRID_OPEN_API_ID
 * и PHONEGRID_OPEN_API_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { projectRoleOf, requireProjectAccess, requireUser } from "../_lib/auth.ts";
import { canDo } from "../_lib/rbac.ts";
import { CORS_HEADERS, json } from "../_lib/publishing.ts";
import {
  parseProxyUrl,
  phonegridCall,
  phonegridConfig,
  PHONE_MODELS,
  RPA_STATE,
  summarizePhone,
  warmupDayFrom,
  warmupParameter,
  warmupPlan,
  WARMUP_TEMPLATES,
} from "../_lib/phonegrid.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const PAGE = { pageNo: 1, pageSize: 100 };

interface AccountRow {
  id: string;
  project_id: string;
  platform: string;
  account_name: string;
  handle: string | null;
  device_provider: string | null;
  device_phone_id: string | null;
  device_phone_name: string | null;
  warmup_started_at: string | null;
  warmup_last_run_at: string | null;
  warmup_last_state: string | null;
}

const ACCOUNT_FIELDS =
  "id, project_id, platform, account_name, handle, device_provider, device_phone_id, device_phone_name, warmup_started_at, warmup_last_run_at, warmup_last_state";

async function loadAccount(accountId: string, projectId: string): Promise<AccountRow | null> {
  const { data } = await admin.from("publish_accounts")
    .select(ACCOUNT_FIELDS).eq("id", accountId).eq("project_id", projectId).maybeSingle();
  return (data as AccountRow) ?? null;
}

/** Телефон должен быть выключён — RPA включает его сам, иначе PhoneGrid отвечает 33309. */
async function phoneInfo(cfg: NonNullable<ReturnType<typeof phonegridConfig>>, phoneId: string) {
  return await phonegridCall<Record<string, unknown>>(cfg, "/cloudphone/info", { id: Number(phoneId) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await requireUser(req);
  if (!user.ok) return user.response;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const projectId = String(body.project_id ?? "");
  const access = await requireProjectAccess(user.authHeader, projectId);
  if (!access.ok) return access.response;
  const action = String(body.action ?? "");
  const role = await projectRoleOf(user.userId, projectId);
  if (!canDo(role, action)) return json({ error: "Недостаточно прав" }, 403);

  const cfg = phonegridConfig();
  if (!cfg) {
    return json({
      error: "PhoneGrid не подключён: добавьте секреты PHONEGRID_OPEN_API_ID и PHONEGRID_OPEN_API_KEY",
    }, 400);
  }

  try {
    if (action === "phones") {
      const data = await phonegridCall<{ dataList?: Record<string, unknown>[] }>(cfg, "/cloudphone/page", PAGE);
      const phones = (data.dataList ?? []).map(summarizePhone);
      const { data: linked } = await admin.from("publish_accounts")
        .select("id, account_name, handle, platform, device_phone_id, warmup_started_at, warmup_last_run_at, warmup_last_state")
        .eq("project_id", projectId).not("device_phone_id", "is", null);
      const byPhone = new Map((linked ?? []).map((a) => [String(a.device_phone_id), a]));
      return json({
        ok: true,
        phones: phones.map((p) => {
          const a = byPhone.get(p.id) ?? null;
          // День прогрева считаем здесь же, чтобы список телефонов сразу показывал прогресс.
          const day = a ? warmupDayFrom(a.warmup_started_at as string | null) : null;
          return {
            ...p,
            account: a
              ? { id: a.id, account_name: a.account_name, handle: a.handle, platform: a.platform }
              : null,
            warmup: a
              ? {
                day,
                ready: (day ?? 0) >= 15,
                startedAt: a.warmup_started_at,
                lastRunAt: a.warmup_last_run_at,
                lastState: a.warmup_last_state,
              }
              : null,
          };
        }),
      });
    }

    if (action === "accounts_free") {
      // Аккаунты проекта, к которым ещё не привязан телефон — для выпадашки в списке устройств.
      const { data } = await admin.from("publish_accounts")
        .select("id, account_name, handle, platform")
        .eq("project_id", projectId).is("device_phone_id", null).order("account_name");
      return json({ ok: true, accounts: data ?? [] });
    }

    if (action === "options") {
      // Всё, что нужно форме создания устройства: модели, свободные прокси и группы.
      const [proxies, groups] = await Promise.all([
        phonegridCall<{ dataList?: Record<string, unknown>[] }>(cfg, "/proxyInfo/page", { ...PAGE, isCloudPhoneProxy: true }),
        phonegridCall<{ dataList?: Record<string, unknown>[] }>(cfg, "/envgroup/page", PAGE),
      ]);
      return json({
        ok: true,
        models: PHONE_MODELS,
        proxies: (proxies.dataList ?? []).map((p) => ({
          id: String(p.id ?? ""),
          name: String(p.proxyName ?? ""),
          ip: String(p.proxyIp ?? ""),
          country: (p.countryCode as string) ?? null,
        })),
        groups: (groups.dataList ?? []).map((g) => ({ id: String(g.id ?? ""), name: String(g.groupName ?? "") })),
      });
    }

    if (action === "proxy_add") {
      const url = String(body.url ?? "").trim();
      if (!url) return json({ error: "Укажите строку прокси" }, 400);
      const parsed = parseProxyUrl(url);
      const added = await phonegridCall(cfg, "/proxyInfo/add", {
        ...parsed,
        proxyName: String(body.name ?? "") || `${parsed.proxyIp}:${parsed.proxyPort}`,
        refreshUrl: String(body.refresh_url ?? ""),
        // Мониторинг смены IP выключаем: у мобильного прокси адрес меняется штатно,
        // иначе PhoneGrid блокирует телефон при каждой ротации.
        ipMonitor: false,
        ipChangeAction: 1,
      });
      return json({ ok: true, proxy: added });
    }

    if (action === "create_phone") {
      const quantity = Math.min(Math.max(Number(body.quantity ?? 1), 1), 10);
      const skuId = String(body.sku_id ?? "");
      if (!PHONE_MODELS.some((m) => m.skuId === skuId)) return json({ error: "Выберите модель устройства" }, 400);
      const proxyId = body.proxy_id ? Number(body.proxy_id) : null;
      // Без прокси телефон создастся, но не включится (PhoneGrid отвечает 33100).
      const created = await phonegridCall<string[]>(cfg, "/cloudphone/create", {
        skuId,
        quantity,
        envRemark: String(body.remark ?? ""),
        ...(proxyId ? { proxyId } : {}),
        ...(body.group_id ? { groupId: Number(body.group_id) } : {}),
        automaticGeo: true,
        automaticLanguage: true,
        automaticLocation: true,
        ...(Array.isArray(body.tags) && body.tags.length ? { tags: body.tags } : {}),
      });
      return json({ ok: true, created: created ?? [], quantity });
    }

    if (action === "screen" || action === "input" || action === "open_url") {
      // Экран и ввод идут по телефону: аккаунт для этого не нужен — на свежем устройстве
      // аккаунта ещё нет, а именно с него всё и начинается.
      let phoneId = String(body.phone_id ?? "");
      if (!phoneId) {
        const account = await loadAccount(String(body.account_id ?? ""), projectId);
        if (!account?.device_phone_id) return json({ error: "Не указан телефон" }, 400);
        phoneId = account.device_phone_id;
      }
      const id = Number(phoneId);

      if (action === "open_url") {
        const url = String(body.url ?? "").trim();
        // Только http(s): через intent можно дотянуться до системных экранов, нам это не нужно.
        if (!/^https?:\/\//i.test(url)) return json({ error: "Ссылка должна начинаться с http:// или https://" }, 400);
        await phonegridCall(cfg, "/cloudphone/exeCommand", {
          id,
          command: `am start -a android.intent.action.VIEW -d ${JSON.stringify(url)}`,
        });
        return json({ ok: true });
      }

      if (action === "input") {
        const kind = String(body.kind ?? "tap");
        const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
        let command: string;
        if (kind === "tap") command = `input tap ${n(body.x)} ${n(body.y)}`;
        else if (kind === "swipe") command = `input swipe ${n(body.x)} ${n(body.y)} ${n(body.x2)} ${n(body.y2)} ${Math.min(n(body.ms) || 300, 3000)}`;
        else if (kind === "text") {
          // input text не умеет пробелы и кавычки — экранируем, ввод идёт как с клавиатуры.
          const raw = String(body.text ?? "").slice(0, 500);
          command = `input text ${JSON.stringify(raw.replace(/ /g, "%s"))}`;
        } else if (kind === "key") {
          const allowed: Record<string, number> = { home: 3, back: 4, enter: 66, tab: 61, delete: 67, recent: 187, power: 26 };
          const code = allowed[String(body.key ?? "")];
          if (!code) return json({ error: "Неизвестная клавиша" }, 400);
          command = `input keyevent ${code}`;
        } else return json({ error: "Неизвестное действие ввода" }, 400);
        await phonegridCall(cfg, "/cloudphone/exeCommand", { id, command });
        return json({ ok: true });
      }

      // Снимок экрана: делаем png на телефоне, забираем ссылку из хранилища PhoneGrid.
      // Через сервер картинку не гоняем — она под мегабайт, браузер заберёт её сам.
      const shot = `/sdcard/mv_screen.png`;
      await phonegridCall(cfg, "/cloudphone/exeCommand", { id, command: `screencap -p ${shot}` });
      const started = await phonegridCall<{ downId: string }>(cfg, "/cloudphone/download", { id, filePath: shot });
      const downId = Number(started?.downId ?? 0);
      if (!downId) return json({ error: "Телефон не отдал снимок экрана" }, 502);
      // Готовность файла — короткий опрос: обычно укладывается в несколько секунд.
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const res = await phonegridCall<{ status: number; downUrl?: string }>(
          cfg, "/cloudphone/download/result", { id, downId },
        );
        if (res?.downUrl) return json({ ok: true, url: res.downUrl });
      }
      return json({ error: "Снимок готовится дольше обычного — повторите" }, 504);
    }

    if (action === "apps" || action === "install_app") {
      let phoneId = String(body.phone_id ?? "");
      if (!phoneId) {
        const account = await loadAccount(String(body.account_id ?? ""), projectId);
        if (!account?.device_phone_id) return json({ error: "Не указан телефон" }, 400);
        phoneId = account.device_phone_id;
      }
      const id = Number(phoneId);

      if (action === "install_app") {
        const appVersionId = String(body.app_version_id ?? "");
        if (!appVersionId) return json({ error: "Не указана версия приложения" }, 400);
        await phonegridCall(cfg, "/cloudphone/app/install", { id, appVersionId });
        return json({ ok: true });
      }

      const installed = await phonegridCall<Record<string, unknown>[]>(cfg, "/cloudphone/app/installedList", { id });
      // Каталог сужаем до площадок, с которыми работает платформа: остальное на телефоне не нужно.
      const wanted = Object.values(WARMUP_TEMPLATES).map((t) => t.packageName);
      const catalog = await phonegridCall<{ dataList?: Record<string, unknown>[] }>(
        cfg, "/cloudphone/app/page", { pageNo: 1, pageSize: 50, appName: "" },
      );
      const apps = (catalog.dataList ?? [])
        .filter((a) => wanted.includes(String(a.packageName)))
        .map((a) => {
          const pkg = String(a.packageName);
          // Версия под сценарий прогрева: ставим сразу её, иначе позже придётся
          // переустанавливать приложение и вход в аккаунт слетит.
          const tpl = Object.values(WARMUP_TEMPLATES).find((t) => t.packageName === pkg);
          return {
            appName: String(a.appName ?? ""),
            packageName: pkg,
            warmupVersion: tpl?.requiredVersion ?? null,
            warmupVersionId: tpl?.appVersionId ?? null,
            versions: ((a.appVersionList as Record<string, unknown>[]) ?? []).slice(0, 8).map((v) => ({
              id: String(v.id ?? ""),
              version: String(v.versionName ?? ""),
            })),
          };
        });
      return json({
        ok: true,
        installed: (installed ?? []).map((a) => ({
          appName: String(a.appName ?? ""),
          packageName: String(a.packageName ?? ""),
          version: String(a.versionName ?? ""),
        })),
        catalog: apps,
      });
    }

    if (action === "attach" || action === "detach") {
      const accountId = String(body.account_id ?? "");
      const account = await loadAccount(accountId, projectId);
      if (!account) return json({ error: "Аккаунт не найден" }, 404);

      if (action === "detach") {
        await admin.from("publish_accounts").update({
          device_provider: null, device_phone_id: null, device_phone_name: null,
        }).eq("id", accountId);
        return json({ ok: true, detached: true });
      }

      const phoneId = String(body.phone_id ?? "");
      if (!phoneId) return json({ error: "Не указан телефон" }, 400);
      const info = await phoneInfo(cfg, phoneId);
      const { error } = await admin.from("publish_accounts").update({
        device_provider: "phonegrid",
        device_phone_id: phoneId,
        device_phone_name: String(info.envName ?? ""),
        warmup_started_at: account.warmup_started_at ?? new Date().toISOString(),
      }).eq("id", accountId);
      // Уникальный индекс не даст посадить два аккаунта на один телефон — площадки
      // связывают такие аккаунты между собой по отпечатку устройства.
      if (error) {
        return json({
          error: error.code === "23505"
            ? "К этому телефону уже привязан другой аккаунт: одно устройство — один аккаунт"
            : error.message,
        }, 400);
      }
      return json({ ok: true, phone: summarizePhone(info) });
    }

    if (action === "power") {
      // Телефон включается и без привязанного аккаунта: с этого начинается заведение
      // нового аккаунта — сначала поднять устройство, потом зарегистрироваться на нём.
      let phoneId = String(body.phone_id ?? "");
      if (!phoneId) {
        const account = await loadAccount(String(body.account_id ?? ""), projectId);
        if (!account?.device_phone_id) return json({ error: "Не указан телефон" }, 400);
        phoneId = account.device_phone_id;
      }
      const on = body.on !== false;
      await phonegridCall(cfg, on ? "/cloudphone/powerOn" : "/cloudphone/powerOff", { id: Number(phoneId) });
      return json({ ok: true, on });
    }

    if (action === "warmup" || action === "warmup_status") {
      const accountId = String(body.account_id ?? "");
      const account = await loadAccount(accountId, projectId);
      if (!account) return json({ error: "Аккаунт не найден" }, 404);
      const tpl = WARMUP_TEMPLATES[account.platform];
      const day = warmupDayFrom(account.warmup_started_at);
      const plan = warmupPlan(day, account.platform);

      if (action === "warmup_status") {
        let history: unknown[] = [];
        if (account.device_phone_id) {
          const data = await phonegridCall<{ dataList?: Record<string, unknown>[] }>(
            cfg, "/cloudphone/rpa/subTask/page", { pageNo: 1, pageSize: 10 },
          );
          history = (data.dataList ?? [])
            .filter((s) => String(s.cloudPhoneId ?? "") === account.device_phone_id)
            .map((s) => ({
              startedAt: s.triggerTime,
              finishedAt: s.endTime,
              state: RPA_STATE[Number(s.taskState)] ?? s.taskState,
              error: s.handleFailReason ? `${s.handleFailCode} ${s.handleFailReason}` : null,
            }));
        }
        return json({
          ok: true,
          phone: account.device_phone_id
            ? { id: account.device_phone_id, name: account.device_phone_name }
            : null,
          warmup: {
            startedAt: account.warmup_started_at,
            lastRunAt: account.warmup_last_run_at,
            lastState: account.warmup_last_state,
            plan,
          },
          supported: Boolean(tpl?.requiredVersion),
          requirements: tpl
            ? { app: tpl.packageName, version: tpl.requiredVersion, locale: tpl.requiredLocale }
            : null,
          history,
        });
      }

      if (!account.device_phone_id) return json({ error: "К аккаунту не привязан телефон" }, 400);
      if (!tpl?.requiredVersion || !tpl.appVersionId) {
        return json({
          error: `Для ${account.platform} не задана версия приложения под шаблон прогрева. ` +
            "Её видно в клиенте PhoneGrid: Автоматизация → Маркетплейс → Просмотр шаблона.",
        }, 400);
      }

      // Требования шаблона проверяем до постановки задачи — иначе PhoneGrid отклонит её
      // кодом 33603 (версия/язык) или 33309 (телефон занят) уже после создания.
      const info = await phoneInfo(cfg, account.device_phone_id);
      const settings = (info.settings ?? {}) as Record<string, unknown>;
      const installed = await phonegridCall<Record<string, unknown>[]>(
        cfg, "/cloudphone/app/installedList", { id: Number(account.device_phone_id) },
      );
      const app = (installed ?? []).find((a) => a.packageName === tpl.packageName);
      const problems: string[] = [];
      if (!app) problems.push(`на телефоне нет ${tpl.packageName} версии ${tpl.requiredVersion}`);
      else if (app.versionName !== tpl.requiredVersion) {
        problems.push(`версия приложения ${app.versionName}, шаблон требует ровно ${tpl.requiredVersion}`);
      }
      if (settings.language !== tpl.requiredLocale) {
        problems.push(`язык телефона ${settings.language || "авто"}, шаблон требует ${tpl.requiredLocale}`);
      }
      if (Number(info.envStatus) !== 2) {
        problems.push("телефон должен быть выключен — прогрев включает его сам");
      }
      if (problems.length) return json({ error: `Прогрев не запущен: ${problems.join("; ")}` }, 400);

      const taskId = await phonegridCall<string>(cfg, "/cloudphone/rpa/onceTask/save", {
        cloudPhoneId: Number(account.device_phone_id),
        scheduleName: `Прогрев ${account.platform} — день ${plan.day}`,
        templateId: tpl.templateId,
        templateParameter: warmupParameter(plan),
        description: plan.note,
      });
      await admin.from("publish_accounts").update({
        warmup_started_at: account.warmup_started_at ?? new Date().toISOString(),
        warmup_last_run_at: new Date().toISOString(),
        warmup_last_state: `запущен день ${plan.day}: ${plan.note}`,
      }).eq("id", accountId);
      return json({ ok: true, taskId, plan });
    }

    return json({ error: `Неизвестное действие «${action}»` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
