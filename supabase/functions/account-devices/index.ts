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
 *   • не создаёт телефоны (платная операция) — только привязывает уже существующие;
 *   • не публикует — публикация идёт через официальные API площадок.
 *
 * Действия (POST { action, project_id, … }):
 *   phones        — телефоны PhoneGrid: статус, прокси, аккаунт и день прогрева
 *   accounts_free — аккаунты проекта без телефона (для привязки из списка устройств)
 *   attach        — привязать телефон к аккаунту (одно устройство = один аккаунт)
 *   detach        — отвязать
 *   power         — включить / выключить телефон
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
  phonegridCall,
  phonegridConfig,
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
      const accountId = String(body.account_id ?? "");
      const account = await loadAccount(accountId, projectId);
      if (!account?.device_phone_id) return json({ error: "К аккаунту не привязан телефон" }, 400);
      const on = body.on !== false;
      await phonegridCall(cfg, on ? "/cloudphone/powerOn" : "/cloudphone/powerOff", { id: Number(account.device_phone_id) });
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
