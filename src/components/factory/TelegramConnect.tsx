import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Link2Off, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface LinkResp {
  code: string;
  command: string;
  deep_link: string | null;
  expires_in_minutes: number;
}

export interface TelegramConnectionStatus {
  connected: boolean;
  destination: {
    chat_id_last4: string;
    username: string | null;
    linked_at: string | null;
  } | null;
  bot_username: string | null;
  bot_url: string | null;
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("heygen-telegram-link", { body });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data;
}

// Карточка привязки Telegram-бота к проекту (клиенту): генерирует одноразовый код.
// Пользователь шлёт боту «/link КОД» — чат привязывается к этому проекту, и дальше
// присылает сценарии прямо в чат (бот берёт дефолты проекта).
export function TelegramConnect({
  projectId,
  compact = false,
  onStatusChange,
}: {
  projectId: string;
  compact?: boolean;
  onStatusChange?: (status: TelegramConnectionStatus | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<TelegramConnectionStatus | null>(null);
  const [link, setLink] = useState<LinkResp | null>(null);
  const projectIdRef = useRef(projectId);
  const linkBaselineRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  // Запрос статуса живёт дольше карточки: без этого флага ответ, пришедший
  // после размонтирования, дёргал setState на мёртвом компоненте.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadStatus = async (quiet = false) => {
    if (!projectId) {
      setStatus(null);
      onStatusChange?.(null);
      return;
    }
    if (!quiet) setStatusLoading(true);
    const requestedProjectId = projectId;
    try {
      const next = await invoke({ project_id: projectId, action: "status" }) as TelegramConnectionStatus;
      if (!mountedRef.current || projectIdRef.current !== requestedProjectId) return;
      setStatus(next);
      onStatusChange?.(next);
      if (next.connected && linkBaselineRef.current !== null) {
        const currentSignature = `${next.destination?.chat_id_last4 ?? ""}:${next.destination?.linked_at ?? ""}`;
        if (linkBaselineRef.current === "disconnected" || currentSignature !== linkBaselineRef.current) {
          linkBaselineRef.current = null;
          setLink(null);
          if (quiet) toast.success("Telegram успешно подключён");
        }
      }
    } catch (e) {
      if (mountedRef.current && !quiet) toast.error((e as Error).message || "Не удалось проверить Telegram");
    } finally {
      if (mountedRef.current && !quiet) setStatusLoading(false);
    }
  };

  useEffect(() => {
    setLink(null);
    linkBaselineRef.current = null;
    setStatus(null);
    onStatusChange?.(null);
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // После выдачи кода автоматически замечаем успешную привязку из Telegram.
  useEffect(() => {
    if (!link) return;
    const timer = window.setInterval(() => void loadStatus(true), 5_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, status?.connected, projectId]);

  const getCode = async () => {
    if (!projectId) {
      toast.error("Сначала выберите проект (клиента) вверху");
      return;
    }
    setLoading(true);
    try {
      const data = await invoke({ project_id: projectId, action: "create" });
      linkBaselineRef.current = status?.connected
        ? `${status.destination?.chat_id_last4 ?? ""}:${status.destination?.linked_at ?? ""}`
        : "disconnected";
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

  const unlink = async () => {
    if (!projectId || !confirm("Отключить Telegram от этого проекта? Готовые видео перестанут приходить в текущий чат.")) return;
    setLoading(true);
    try {
      await invoke({ project_id: projectId, action: "unlink" });
      setLink(null);
      linkBaselineRef.current = null;
      await loadStatus(true);
      toast.success("Telegram отключён");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось отключить Telegram");
    } finally {
      setLoading(false);
    }
  };

  const destinationLabel = status?.destination?.username
    ? `@${status.destination.username}`
    : status?.destination?.chat_id_last4
      ? `Чат ••••${status.destination.chat_id_last4}`
      : "Telegram-чат";

  return (
    <section className={cn("rounded-2xl border border-border/60 bg-card/60", compact ? "p-3" : "mt-8 p-4")}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Send className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Telegram-доставка</h2>
          <p className="truncate text-xs text-muted-foreground">
            {status?.connected ? `Готовые видео придут в ${destinationLabel}` : "Подключите чат для получения готовых видео"}
          </p>
        </div>
        {statusLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!statusLoading && status?.connected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Подключён
          </span>
        )}
      </div>

      {status?.connected && !link ? (
        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
              <Send className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{destinationLabel}</div>
              <div className="text-[11px] text-muted-foreground">
                Сюда уйдут полный ролик и шортсы после монтажа
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {status.bot_url && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" asChild>
                <a href={status.bot_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /> Открыть бота
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={getCode} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Переподключить
            </Button>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => void unlink()} disabled={loading}>
              <Link2Off className="h-3.5 w-3.5" /> Отключить
            </Button>
          </div>
        </div>
      ) : !link ? (
        <div className="mt-3">
          <Button size="sm" className="gap-2" disabled={loading || statusLoading || !projectId} onClick={getCode}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {projectId ? "Подключить Telegram" : "Выберите проект"}
          </Button>
          {!compact && (
            <p className="mt-2 text-xs text-muted-foreground">
              После подключения можно отправлять боту сценарии, а готовые ролики будут возвращаться в этот же чат.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium">
            {status?.connected ? "Подтвердите новый чат — старый работает до завершения привязки" : "Отправьте команду боту"}
          </p>
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
            Код действует {link.expires_in_minutes} мин. После отправки подключение обновится автоматически.
            {link.deep_link && (
              <>
                {" "}
                <a href={link.deep_link} target="_blank" rel="noreferrer" className="text-primary underline">
                  Открыть бота
                </a>
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {link.deep_link && (
              <Button size="sm" className="h-8 gap-1.5 text-xs" asChild>
                <a href={link.deep_link} target="_blank" rel="noreferrer">
                  <Send className="h-3.5 w-3.5" /> Открыть Telegram
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void loadStatus()} disabled={statusLoading}>
              {statusLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Проверить
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={getCode} disabled={loading}>
              Новый код
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                linkBaselineRef.current = null;
                setLink(null);
              }}
            >
              Отмена
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
