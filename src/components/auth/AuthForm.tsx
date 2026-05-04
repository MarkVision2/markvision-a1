import { useState } from "react";
import type { AuthError } from "@supabase/supabase-js";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ArrowRight, Eye, EyeOff, HelpCircle, Loader2, Mail, MailCheck } from "lucide-react";

type Mode = "signin" | "signup" | "forgot" | "sent";

const signinSchema = z.object({
  identifier: z.string().trim().min(3, "Минимум 3 символа").max(255),
  password: z.string().min(6, "Минимум 6 символов").max(128),
});
const signupSchema = z.object({
  name: z.string().trim().min(2, "Минимум 2 символа").max(80),
  email: z.string().trim().email("Некорректный email").max(255),
  password: z.string().min(8, "Минимум 8 символов").max(128),
});
const emailSchema = z.string().trim().email("Некорректный email").max(255);

function describeAuthError(error: AuthError): string {
  const msg = (error.message || "").toLowerCase();
  // Supabase v2 exposes .code on AuthError
  const code = (error as unknown as { code?: string }).code;
  if (code === "invalid_credentials" || msg.includes("invalid login")) {
    return "Неверный email/логин или пароль. Если забыли пароль — нажмите «Забыли пароль?».";
  }
  if (code === "user_already_exists" || msg.includes("already registered") || msg.includes("user already")) {
    return "Аккаунт с таким email уже существует. Войдите или сбросьте пароль.";
  }
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return "Email не подтверждён. Проверьте письмо со ссылкой подтверждения.";
  }
  if (msg.includes("rate limit") || code === "over_request_rate_limit") {
    return "Слишком много попыток. Подождите минуту и попробуйте снова.";
  }
  return error.message;
}

export function AuthForm() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signinSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[i.path[0] as string] = i.message; });
      setErrors(errs);
      return;
    }
    setErrors({});
    setLoading(true);
    const email = identifier.includes("@") ? identifier : `${identifier}@markvision.app`;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast({ title: "Не удалось войти", description: describeAuthError(error), variant: "destructive" });
      return;
    }
    toast({ title: "Добро пожаловать!" });
    navigate("/dashboard", { replace: true });
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(forgotEmail);
    if (!parsed.success) { setErrors({ forgot: parsed.error.issues[0].message }); return; }
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Не удалось отправить", description: error.message, variant: "destructive" });
      return;
    }
    setMode("sent");
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse({
      name: signupName,
      email: signupEmail,
      password: signupPassword,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[i.path[0] as string] = i.message; });
      setErrors(errs);
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { name: signupName },
      },
    });
    setLoading(false);
    if (error) {
      toast({ title: "Не удалось создать аккаунт", description: describeAuthError(error), variant: "destructive" });
      return;
    }
    toast({ title: "Аккаунт создан", description: "Вы вошли в систему" });
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="w-full max-w-sm">
      {mode === "signin" && (
        <>
          <div className="mb-6">
            <h2 className="text-3xl font-bold tracking-tight">Добро пожаловать</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">Войдите в систему, чтобы продолжить работу</p>
          </div>
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier" className="text-sm font-semibold">Email или Логин</Label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="ivan_doc или ivan@markvision.kz"
                autoComplete="username"
                className="h-11"
              />
              {errors.identifier && <p className="text-xs text-destructive">{errors.identifier}</p>}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-semibold">Пароль</Label>
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setErrors({}); }}
                  className="text-xs font-medium text-success hover:underline"
                >
                  Забыли пароль?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-secondary"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>

            <Button type="submit" disabled={loading} className="h-12 w-full gap-2 bg-success text-white shadow-lg shadow-success/30 hover:bg-success/90">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Войти в платформу <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>

          <div className="mt-4 flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <HelpCircle className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">Нужна помощь с входом?</div>
              <div className="text-xs text-muted-foreground">Регистрация закрыта. Новые аккаунты создаёт администратор.</div>
            </div>
          </div>
        </>
      )}



      {mode === "forgot" && (
        <>
          <button onClick={() => { setMode("signin"); setErrors({}); }} className="mb-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Назад ко входу
          </button>
          <div className="mb-6">
            <h2 className="text-3xl font-bold tracking-tight">Сброс пароля</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">Введите email — мы отправим ссылку для смены пароля.</p>
          </div>
          <form onSubmit={handleForgot} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email" className="text-sm font-semibold">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="forgot-email"
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="ivan@markvision.kz"
                  className="h-11 pl-9"
                />
              </div>
              {errors.forgot && <p className="text-xs text-destructive">{errors.forgot}</p>}
            </div>
            <Button type="submit" disabled={loading} className="h-12 w-full gap-2 bg-success text-white hover:bg-success/90">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Отправить ссылку <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>
          <div className="mt-4 rounded-xl border border-border/60 bg-card/40 p-3.5 text-xs text-muted-foreground">
            После клика по ссылке в письме вы попадёте на страницу установки нового пароля.
          </div>
        </>
      )}

      {mode === "sent" && (
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-success/15 text-success ring-1 ring-success/40">
            <MailCheck className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Письмо отправлено</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Мы отправили инструкцию на <span className="font-semibold text-foreground">{forgotEmail}</span>. Проверьте папку «Входящие» и «Спам».
          </p>
          <Button onClick={() => { setMode("signin"); setForgotEmail(""); }} className="mt-6 h-11 w-full bg-success text-white hover:bg-success/90">
            Вернуться ко входу
          </Button>
        </div>
      )}
    </div>
  );
}
