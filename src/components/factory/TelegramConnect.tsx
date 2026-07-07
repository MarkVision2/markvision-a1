import { useState } from "react";
import { Copy, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LinkResp {
  code: string;
  command: string;
  deep_link: string | null;
  expires_in_minutes: number;
}

// Карточка привязки Telegram-бота к проекту (клиенту): генерирует одноразовый код.
// Пользователь шлёт боту «/link КОД» — чат привязывается к этому проекту, и дальше
// присылает сценарии прямо в чат (бот берёт дефолты проекта).
export function TelegramConnect({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<LinkResp | null>(null);

  const getCode = async () => {
    if (!projectId) {
      toast.error("Сначала выберите проект (клиента) вверху");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("heygen-telegram-link", {
        body: { project_id: projectId },
      });
      if (error) throw error;
      setLink(data as LinkResp);
    } catch (e) {
      toast.error((e as Error).message || "Не удалось получить код");
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Скопировано"),
      () => toast.error("Не удалось скопировать"),
    );
  };

  return (
    <section className="mt-8 rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Send className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Создавать через Telegram-бота</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Привяжите чат — и присылайте боту сценарий текстом. Он соберёт видео с вашими
        дефолтными аватаром и голосом и пришлёт MP4 в чат. В приложение заходить не нужно.
      </p>

      {!link ? (
        <Button size="sm" className="gap-2" disabled={loading || !projectId} onClick={getCode}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {projectId ? "Получить код привязки" : "Выберите проект"}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
            <code className="flex-1 text-sm font-bold tracking-widest">{link.command}</code>
            <button
              type="button"
              aria-label="Скопировать"
              onClick={() => copy(link.command)}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Отправьте эту команду вашему боту в Telegram. Код действует {link.expires_in_minutes} мин.
            {link.deep_link && (
              <>
                {" "}
                <a href={link.deep_link} target="_blank" rel="noreferrer" className="text-primary underline">
                  Открыть бота
                </a>
              </>
            )}
          </p>
          <Button size="sm" variant="ghost" onClick={getCode} disabled={loading}>
            Новый код
          </Button>
        </div>
      )}
    </section>
  );
}
