import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const schema = z.object({
  password: z.string().min(8, "Минимум 8 символов").max(128),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { message: "Пароли не совпадают", path: ["confirm"] });

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => { if (session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[i.path[0] as string] = i.message; });
      setErrors(errs);
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast({ title: "Не удалось сменить пароль", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Пароль обновлён" });
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="grid h-screen place-items-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-success/15 text-success ring-1 ring-success/40">
            <KeyRound className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Новый пароль</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">Придумайте новый пароль для входа в платформу.</p>
        </div>

        {!ready ? (
          <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-center text-sm text-muted-foreground">
            Проверка ссылки восстановления…
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="np">Новый пароль</Label>
              <div className="relative">
                <Input id="np" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 pr-10" />
                <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-secondary">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp">Подтвердите пароль</Label>
              <Input id="cp" type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-11" />
              {errors.confirm && <p className="text-xs text-destructive">{errors.confirm}</p>}
            </div>
            <Button type="submit" disabled={loading} className="h-12 w-full gap-2 bg-success text-white hover:bg-success/90">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Сохранить и войти <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
