/**
 * Вход в аккаунт площадки на облачном телефоне.
 *
 * Почему вход автоматический, а не «ткни в картинку»: кадр с телефона готовится ~12 секунд
 * (видеопотока PhoneGrid наружу не отдаёт), и попадать пальцем в поле логина на такой
 * задержке мучительно. Поэтому платформа читает разметку экрана Android и жмёт по
 * координатам, которые вернул сам телефон.
 *
 * Пароль: вводится здесь, одним запросом уходит на телефон и нигде не сохраняется — ни в
 * базе, ни в браузере. Но по дороге он проходит через наш сервер и API PhoneGrid, поэтому
 * это всё-таки не то же самое, что набрать его руками на самом устройстве.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Loader2, LogIn, Minus, ShieldQuestion, X } from "lucide-react";
import { toast } from "sonner";
import {
  phoneAppStart, phoneLogin, phoneProfile, PHONE_APPS,
  type LoginPlatform, type LoginResult, type PhoneApps, type PhoneNet, type PhoneProfile,
} from "@/lib/accountDevices";

/** Шаги входа — их видно в окне, чтобы не гадать, на чём всё встало. */
const STEPS = [
  { key: "open", label: "Открываю приложение" },
  { key: "fill", label: "Ввожу логин и пароль" },
  { key: "submit", label: "Нажимаю «Войти»" },
  { key: "check", label: "Проверяю результат" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const VERDICT_TONE: Record<LoginResult["state"], "ok" | "warn" | "bad"> = {
  success: "ok",
  form: "warn",
  two_factor: "warn",
  challenge: "warn",
  unknown: "warn",
  wrong_password: "bad",
};

/** Строка готовности: понятно с одного взгляда, что мешает завести аккаунт. */
function Ready({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      {ok === null
        ? <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        : ok
          ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
      <span className={ok === false ? "text-destructive" : ok === null ? "text-muted-foreground" : ""}>
        {children}
      </span>
    </li>
  );
}

export function PhoneLoginPanel({
  projectId, phoneId, platform, apps, net, proxyIp, busy, onPlatform, onAct, onScreenChanged,
}: {
  projectId: string;
  phoneId: string;
  platform: LoginPlatform;
  apps: PhoneApps | null;
  net: PhoneNet | null;
  proxyIp: string | null;
  busy: boolean;
  onPlatform: (p: LoginPlatform) => void;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
  /** Телефон изменился — родитель обновляет кадр, иначе на экране остаётся прошлое. */
  onScreenChanged: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<StepKey | null>(null);
  const [done, setDone] = useState<StepKey[]>([]);
  const [verdict, setVerdict] = useState<LoginResult | null>(null);
  const [profile, setProfile] = useState<PhoneProfile | null>(null);
  const [probing, setProbing] = useState(false);

  const running = step !== null;
  const installed = (pkg: string) => (apps?.installed ?? []).some((a) => a.packageName === pkg);

  /**
   * Что в приложении сейчас: уже открыт аккаунт, висит форма входа или оно вообще закрыто.
   * Дешёвая проверка — ничего не запускает, поэтому её же зовём при смене площадки.
   */
  const probe = useCallback(async () => {
    setProbing(true);
    setProfile(null);
    try {
      const state = await phoneLogin(projectId, phoneId, platform, "probe");
      setVerdict(state);
      if (state.state === "success") {
        setProfile(await phoneProfile(projectId, phoneId).catch(() => null));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  }, [projectId, phoneId, platform]);

  useEffect(() => { setVerdict(null); setDone([]); }, [platform]);

  const run = async () => {
    setVerdict(null);
    setProfile(null);
    setDone([]);
    try {
      setStep("open");
      const opened = await phoneLogin(projectId, phoneId, platform, "open");
      onScreenChanged();
      setDone(["open"]);

      // Приложение уже с открытым аккаунтом — вводить нечего, сразу читаем профиль.
      if (opened.state !== "success") {
        setStep("fill");
        await phoneLogin(projectId, phoneId, platform, "fill", { username: username.trim(), password });
        onScreenChanged();
        setDone(["open", "fill"]);

        setStep("submit");
        await phoneLogin(projectId, phoneId, platform, "submit");
        setDone(["open", "fill", "submit"]);
      }

      setStep("check");
      // Площадка думает несколько секунд: спрашиваем экран, пока форма не сменится.
      // Первый раз — сразу: если вход прошёл мгновенно, ждать нечего.
      let result: LoginResult = await phoneLogin(projectId, phoneId, platform, "check");
      onScreenChanged();
      for (let i = 0; i < 5 && result.state === "form"; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        result = await phoneLogin(projectId, phoneId, platform, "check");
        onScreenChanged();
      }
      setDone(["open", "fill", "submit", "check"]);
      setVerdict(result);
      // Пароль в памяти окна больше не нужен: дальше он ничего не открывает.
      setPassword("");

      if (result.state === "success") {
        setProfile(await phoneProfile(projectId, phoneId).catch(() => null));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setStep(null);
    }
  };

  const tone = verdict ? VERDICT_TONE[verdict.state] : null;
  const loggedIn = verdict?.state === "success";

  const pkg = PHONE_APPS[platform].packageName;
  const inst = apps?.installed.find((a) => a.packageName === pkg) ?? null;
  const wanted = apps?.catalog.find((c) => c.packageName === pkg)?.warmupVersion ?? null;
  // Версия важна не для входа, а для прогрева: шаблон требует ровно свою и иначе падает.
  const versionOk = !inst ? false : !wanted ? null : inst.version === wanted;

  return (
    <div className="space-y-3">
      <ul className="space-y-1 rounded-lg border p-3 text-xs">
        <Ready ok={Boolean(net)}>
          {net
            ? <>Выход в сеть с {net.ip}{net.isp ? ` · ${net.isp}` : ""}{proxyIp ? "" : " — прокси не привязан"}</>
            : "Выход в сеть не проверен"}
        </Ready>
        <Ready ok={Boolean(inst)}>
          {inst
            ? <>{PHONE_APPS[platform].label} {inst.version} установлен</>
            : <>{PHONE_APPS[platform].label} не установлен — поставьте во вкладке «Приложения»</>}
        </Ready>
        <Ready ok={versionOk}>
          {versionOk === null
            ? "Версия под прогрев для этой площадки ещё не выяснена"
            : versionOk
              ? "Версия подходит для прогрева"
              : `Прогрев требует ровно ${wanted} — переустановите во вкладке «Приложения»`}
        </Ready>
        <Ready ok={loggedIn ? true : verdict ? false : null}>
          {loggedIn ? "Аккаунт открыт в приложении" : verdict ? "Аккаунт не подключён" : "Вход не проверен"}
        </Ready>
      </ul>
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.entries(PHONE_APPS) as [LoginPlatform, { packageName: string; label: string }][])
          .map(([key, app]) => (
            <Button
              key={key}
              size="sm"
              variant={platform === key ? "default" : "outline"}
              disabled={busy || running || !installed(app.packageName)}
              title={installed(app.packageName)
                ? `Открыть ${app.label} на телефоне`
                : `${app.label} не установлен — поставьте его во вкладке «Приложения»`}
              onClick={() => {
                onPlatform(key);
                void onAct(() => phoneAppStart(projectId, phoneId, app.packageName));
              }}
            >
              {app.label}
            </Button>
          ))}
        <Button
          size="sm" variant="ghost" disabled={busy || running || probing}
          title="Посмотреть, открыт ли уже аккаунт в приложении"
          onClick={() => void probe()}
        >
          {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Проверить вход"}
        </Button>
      </div>

      {verdict && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            tone === "ok"
              ? "border-emerald-500/40 bg-emerald-500/5"
              : tone === "bad"
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <div className="flex items-center gap-1.5 font-medium">
            {tone === "ok"
              ? <Check className="h-4 w-4 text-emerald-600" />
              : tone === "bad"
                ? <AlertTriangle className="h-4 w-4" />
                : <ShieldQuestion className="h-4 w-4" />}
            {loggedIn ? "Аккаунт открыт в приложении" : "Аккаунт не подключён"}
          </div>
          <p className="mt-1 text-xs">{verdict.message}</p>
          {profile && (profile.handle || profile.followers || profile.posts) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.handle && <Badge variant="outline">@{profile.handle}</Badge>}
              {profile.followers && <Badge variant="outline">{profile.followers} подписчиков</Badge>}
              {profile.posts && <Badge variant="outline">{profile.posts} постов</Badge>}
            </div>
          )}
        </div>
      )}

      {!loggedIn && (
        <div className="space-y-1.5">
          <Input
            value={username} disabled={running} className="h-9" autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Логин или почта"
          />
          <Input
            value={password} disabled={running} className="h-9" type="password" autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
          />
          <Button
            size="sm" className="w-full" disabled={running || busy || !username.trim() || !password}
            onClick={() => void run()}
          >
            {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LogIn className="mr-1.5 h-3.5 w-3.5" />}
            Войти
          </Button>
        </div>
      )}

      {(running || done.length > 0) && (
        <ul className="space-y-1 text-xs">
          {STEPS.map((s) => {
            const isDone = done.includes(s.key);
            const isNow = step === s.key;
            return (
              <li
                key={s.key}
                className={`flex items-center gap-1.5 ${isDone || isNow ? "" : "text-muted-foreground"}`}
              >
                {isNow
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : isDone
                    ? <Check className="h-3 w-3 text-emerald-600" />
                    : <span className="h-3 w-3" />}
                {s.label}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Пароль уходит на телефон одним запросом и нигде не сохраняется. Но по дороге он
        проходит через наш сервер и API PhoneGrid — если аккаунт критичный, надёжнее набрать
        пароль руками прямо на экране телефона.
      </p>
    </div>
  );
}
