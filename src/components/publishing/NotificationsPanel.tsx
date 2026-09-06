/**
 * Центр уведомлений проекта (publish_notifications): reconnect аккаунтов,
 * упавшие и неподтверждённые публикации, ручной разбор. Показывает
 * непрочитанные; «Прочитано» — одно или все.
 */
import { useCallback, useEffect, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { publishingApi, type PublishNotification } from "@/lib/publishingClient";
import { fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

const SEVERITY_CLS: Record<PublishNotification["severity"], string> = {
  info: "border-l-sky-500",
  warning: "border-l-amber-500",
  error: "border-l-destructive",
};

export function NotificationsPanel({ projectId, refreshKey = 0 }: { projectId: string | null; refreshKey?: number }) {
  const [items, setItems] = useState<PublishNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) { setItems([]); setUnread(0); return; }
    try {
      const r = await publishingApi.notificationsList(projectId, { unread_only: true, limit: 50 });
      setItems(r.notifications ?? []);
      setUnread(r.unread ?? 0);
    } catch {
      // панель — вторична: ошибка не должна перекрывать страницу
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const markRead = async (id?: string) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await publishingApi.notificationRead(projectId, id ? { notification_id: id } : { all: true });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отметить");
    } finally {
      setBusy(false);
    }
  };

  if (!projectId || unread === 0) return null;

  return (
    <section className="rounded-2xl border" aria-label="Уведомления">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="font-medium">Требуют внимания</span>
        <span className="rounded-full bg-amber-500/15 px-2 text-xs tabular-nums text-amber-700 dark:text-amber-300">{unread}</span>
        <span className="ml-auto text-xs text-muted-foreground">{open ? "свернуть" : "показать"}</span>
      </button>
      {open && (
        <div className="border-t">
          <ul className="divide-y">
            {items.map((n) => (
              <li key={n.id} className={cn("flex items-start gap-3 border-l-4 px-4 py-2.5", SEVERITY_CLS[n.severity] ?? "border-l-muted")}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.body && <div className="mt-0.5 break-words text-xs text-muted-foreground">{n.body}</div>}
                  <div className="mt-1 text-[11px] text-muted-foreground">{n.kind} · {fmtRelative(n.created_at)}</div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} aria-label={`Прочитано: ${n.title}`} onClick={() => void markRead(n.id)}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end px-3 py-2">
            <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => void markRead()}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Прочитать все
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
