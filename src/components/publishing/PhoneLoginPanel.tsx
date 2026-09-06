/**
 * Вход в аккаунт площадки на облачном телефоне.
 *
 * Почему вход автоматический, а не «ткни в картинку»: кадр с телефона готовится 3–9 секунд
 * (видеопотока PhoneGrid наружу не отдаёт), и попадать пальцем в поле логина на такой
 * задержке мучительно. Поэтому платформа читает разметку экрана Android и жмёт по
 * координатам, которые вернул сам телефон.
 *
 * Пароль: вводится здесь, одним запросом уходит на телефон и нигде не сохраняется — ни в
 * базе, ни в браузере. Но по дороге он проходит через наш сервер и API PhoneGrid, поэтому
 * это всё-таки не то же самое, что набрать его руками на самом устройстве.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Loader2, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import {
  phoneLogin, phoneProfile,
  type LoginPlatform, type LoginResult, type PhoneProfile,
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

export function PhoneLoginPanel({
  projectId, phoneId, platform, onScreenChanged,
}: {
  projectId: string;
  phoneId: string;
  platform: LoginPlatform;
  /** Телефон изменился — родитель обновляет кадр, иначе на экране остаётся прошлое. */
  onScreenChanged: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<StepKey | null>(null);
  const [done, setDone] = useState<StepKey[]>([]);
  const [verdict, setVerdict] = useState<LoginResult | null>(null);
  const [profile, setProfile] = useState<PhoneProfile | null>(null);

  const busy = step !== null;

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

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Вход в аккаунт</label>
        <Input
          value={username} disabled={busy} className="h-8" autoComplete="off"
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Логин или почта"
        />
        <Input
          value={password} disabled={busy} className="h-8" type="password" autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
        />
        <Button
          size="sm" className="w-full" disabled={busy || !username.trim() || !password}
          onClick={() => void run()}
        >
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Войти
        </Button>
      </div>

      {(busy || done.length > 0) && (
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

      {verdict && (
        <div
          className={`rounded-md border p-2.5 text-sm ${
            tone === "ok"
              ? "border-emerald-500/40 bg-emerald-500/5"
              : tone === "bad"
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : "border-amber-500/40 bg-amber-500/5"
          }`}
        >
          <div className="flex items-center gap-1.5 font-medium">
            {tone === "ok"
              ? <Check className="h-3.5 w-3.5 text-emerald-600" />
              : tone === "bad"
                ? <AlertTriangle className="h-3.5 w-3.5" />
                : <ShieldQuestion className="h-3.5 w-3.5" />}
            {verdict.state === "success" ? "Аккаунт подключён" : "Вход не завершён"}
          </div>
          <p className="mt-1 text-xs">{verdict.message}</p>
          {profile && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.handle && <Badge variant="outline">@{profile.handle}</Badge>}
              {profile.followers && <Badge variant="outline">{profile.followers} подписчиков</Badge>}
              {profile.posts && <Badge variant="outline">{profile.posts} постов</Badge>}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Пароль уходит на телефон одним запросом и нигде не сохраняется. Но по дороге он
        проходит через наш сервер и API PhoneGrid — если аккаунт критичный, надёжнее набрать
        пароль руками прямо на экране телефона.
      </p>
    </div>
  );
}
