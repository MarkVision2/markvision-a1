import { useEffect, useState } from "react";
import { Facebook, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { Button } from "@/components/ui/button";

// Один клик — и система сама забирает страницу + рекламный кабинет +
// Instagram-аккаунт через настоящий Facebook OAuth (facebook-oauth-start →
// диалог Facebook → facebook-oauth-callback). Ни токенов, ни ручного выбора.
export function FacebookConnect() {
  const { activeId: projectId } = useProjectsStore();
  const [connecting, setConnecting] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const connected = params.get("fb_connected");
    const error = params.get("fb_error");
    if (connected) {
      toast.success("Facebook подключён", { description: connected });
      setParams((p) => { p.delete("fb_connected"); return p; }, { replace: true });
    } else if (error) {
      toast.error("Не удалось подключить Facebook", { description: error });
      setParams((p) => { p.delete("fb_error"); return p; }, { replace: true });
    }
  }, [params, setParams]);

  const handleConnect = async () => {
    if (!projectId) {
      toast.error("Сначала выберите проект");
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-oauth-start", {
        body: { project_id: projectId, return_url: window.location.href },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Не удалось получить ссылку авторизации");
      window.location.href = data.url as string;
    } catch (e) {
      toast.error("Не удалось начать подключение", { description: e instanceof Error ? e.message : String(e) });
      setConnecting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-4 flex items-start gap-4">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#1877F2]/15 text-[#1877F2]">
          <Facebook className="h-6 w-6" />
        </span>
        <div className="flex-1">
          <h3 className="text-base font-semibold">Подключить Facebook</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Один вход через Facebook — система сама заберёт вашу страницу, рекламный кабинет и Instagram-аккаунт
            и подключит их к этому проекту: автопостинг, аналитика и автоответы на комментарии в Direct
            заработают сразу, без отдельных токенов.
          </p>
        </div>
      </div>
      <Button onClick={handleConnect} disabled={connecting || !projectId} className="gap-2 bg-[#1877F2] hover:bg-[#1877F2]/90">
        {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
        Войти через Facebook
      </Button>
    </div>
  );
}
