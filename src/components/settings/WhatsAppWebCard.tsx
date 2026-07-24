import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, QrCode, RefreshCw, Smartphone, Unplug, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type SessionStatus = "disconnected" | "pairing" | "connected" | "error";

type StatusResp = {
  ok?: boolean;
  error?: string;
  worker_configured?: boolean;
  session?: {
    status: SessionStatus;
    phone?: string | null;
    display_name?: string | null;
    qr_data?: string | null;
    last_error?: string | null;
    worker_online?: boolean;
    paired_at?: string | null;
  };
};

async function callBridge(action: string, projectId: string, extra?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("wa-web-bridge", {
    body: { action, project_id: projectId, ...(extra ?? {}) },
  });
  if (error) throw new Error(error.message);
  if ((data as StatusResp)?.error) throw new Error((data as StatusResp).error);
  return data as StatusResp;
}

interface Props {
  projectId: string | null;
}

export function WhatsAppWebCard({ projectId }: Props) {
  const [loading, setLoading] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const r = await callBridge("status", projectId);
      setStatus(r);
    } catch (e) {
      toast.error("Не удалось получить статус WhatsApp Web", {
        description: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectId) return;
    const s = status?.session?.status;
    if (s === "pairing" || (s === "disconnected" && pairing)) {
      pollRef.current = window.setInterval(() => {
        void refresh();
      }, 2500);
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
      };
    }
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return undefined;
  }, [projectId, status?.session?.status, pairing, refresh]);

  const startPair = async () => {
    if (!projectId) return;
    setPairing(true);
    try {
      await callBridge("start_pair", projectId);
      toast.message("Сканируйте QR в WhatsApp → Связанные устройства");
      await refresh();
    } catch (e) {
      setPairing(false);
      toast.error("Не удалось начать подключение", { description: (e as Error).message });
    }
  };

  const logout = async () => {
    if (!projectId) return;
    try {
      await callBridge("logout", projectId);
      setPairing(false);
      toast.success("WhatsApp Web отключён");
      await refresh();
    } catch (e) {
      toast.error("Не удалось отключить", { description: (e as Error).message });
    }
  };

  const session = status?.session;
  const connected = session?.status === "connected";
  const workerOnline = !!session?.worker_online;
  const qr = session?.qr_data;

  return (
    <Card className="mt-6 border-border/70">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="h-4 w-4 text-primary" />
              WhatsApp Web (бесплатно)
            </CardTitle>
            <CardDescription className="mt-1.5">
              QR как в WhatsApp Web → сообщения сразу в CRM. Без Green API.
              Green API оставьте для автоматизаций и рассылок.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {connected ? (
              <Badge className="bg-success/15 text-success hover:bg-success/15">Подключён</Badge>
            ) : session?.status === "pairing" ? (
              <Badge variant="secondary">Ждём сканирование</Badge>
            ) : (
              <Badge variant="outline">Не подключён</Badge>
            )}
            {workerOnline ? (
              <Badge variant="outline" className="gap-1 border-success/40 text-success">
                <Wifi className="h-3 w-3" /> Воркер онлайн
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <WifiOff className="h-3 w-3" /> Воркер офлайн
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status?.worker_configured && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            На сервере не задан секрет <code>WA_WEB_WORKER_KEY</code>. Без него QR не заработает —
            см. <code>wa-web/README.md</code>.
          </p>
        )}

        {status?.worker_configured && !workerOnline && (
          <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Запустите демон на VPS: <code className="text-foreground">node wa-web/daemon.mjs</code>
            {" "}(нужен постоянно включённый Node, как для montage-daemon).
          </p>
        )}

        {connected && (
          <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2.5 text-sm">
            <div className="font-medium text-foreground">
              {session?.display_name || "WhatsApp"} {session?.phone ? `· ${session.phone}` : ""}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Входящие с этого номера пишутся в CRM → Чаты. Ответы из CRM уходят через этот канал,
              если сессия активна.
            </p>
          </div>
        )}

        {qr && session?.status === "pairing" && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-4">
            <img src={qr} alt="QR WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
            <p className="max-w-sm text-center text-xs text-muted-foreground">
              WhatsApp → ⋮ → Связанные устройства → Привязать устройство
            </p>
          </div>
        )}

        {session?.status === "error" && session.last_error && (
          <p className="text-xs text-destructive">{session.last_error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <Button onClick={() => void startPair()} disabled={!projectId || pairing || loading}>
              {pairing || session?.status === "pairing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <QrCode className="h-4 w-4" />
              )}
              Показать QR
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void logout()}>
              <Unplug className="h-4 w-4" />
              Отключить
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} title="Обновить">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
