import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, QrCode, RefreshCw, Smartphone, Unplug, Wifi, WifiOff } from "lucide-react";
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

function friendlyError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes("515") || t.includes("restart")) {
    return null; // normal Baileys restart after QR — hide
  }
  if (t.includes("408") || t.includes("440")) {
    return "Сессия обновляется, подождите пару секунд…";
  }
  return raw;
}

interface Props {
  projectId: string | null;
}

export function WhatsAppWebCard({ projectId }: Props) {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [awaitingQrSince, setAwaitingQrSince] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!projectId) {
      setStatus(null);
      return null;
    }
    if (!opts?.silent) setRefreshing(true);
    try {
      const r = await callBridge("status", projectId);
      setStatus(r);
      const s = r.session;
      if (s?.status === "connected") {
        setAwaitingQrSince(null);
        setHint(null);
      } else if (s?.qr_data && s.status === "pairing") {
        setAwaitingQrSince(null);
        setHint("Отсканируйте QR в телефоне");
      }
      return r;
    } catch (e) {
      if (!opts?.silent) {
        toast.error("Не удалось получить статус WhatsApp Web", {
          description: (e as Error).message,
        });
      }
      return null;
    } finally {
      if (!opts?.silent) setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const session = status?.session;
  const connected = session?.status === "connected";
  const hasQr = !!(session?.qr_data && session.status === "pairing");
  const waitingForQr = awaitingQrSince != null && !hasQr && !connected;

  // Poll while pairing / waiting for QR / connected check after scan
  useEffect(() => {
    if (!projectId) return;
    const shouldPoll =
      waitingForQr ||
      session?.status === "pairing" ||
      (session?.status === "error" && !!session.last_error);
    if (!shouldPoll) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return undefined;
    }
    pollRef.current = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [projectId, waitingForQr, session?.status, session?.last_error, refresh]);

  // Timeout: stop eternal spinner if QR never arrives
  useEffect(() => {
    if (!awaitingQrSince) return undefined;
    const t = window.setTimeout(() => {
      setAwaitingQrSince(null);
      setHint("QR не появился за 45 сек. Нажмите «Показать QR» ещё раз.");
      toast.error("QR не пришёл", {
        description: "Воркер онлайн? Попробуйте ещё раз через пару секунд.",
      });
    }, 45_000);
    return () => window.clearTimeout(t);
  }, [awaitingQrSince]);

  const startPair = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    setHint("Запрашиваем QR у воркера…");
    setAwaitingQrSince(Date.now());
    try {
      await callBridge("start_pair", projectId);
      toast.message("Ждём QR — обычно 2–5 секунд");
      // Poll a few times immediately
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const r = await refresh({ silent: true });
        if (r?.session?.qr_data || r?.session?.status === "connected") break;
      }
    } catch (e) {
      setAwaitingQrSince(null);
      setHint(null);
      toast.error("Не удалось начать подключение", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      await callBridge("logout", projectId);
      setAwaitingQrSince(null);
      setHint(null);
      toast.success("WhatsApp Web отключён");
      await refresh();
    } catch (e) {
      toast.error("Не удалось отключить", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const workerOnline = !!session?.worker_online;
  const errMsg = friendlyError(session?.last_error);

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
              <Badge className="gap-1 bg-success/15 text-success hover:bg-success/15">
                <CheckCircle2 className="h-3 w-3" /> Подключён
              </Badge>
            ) : hasQr ? (
              <Badge variant="secondary">Сканируйте QR</Badge>
            ) : waitingForQr ? (
              <Badge variant="secondary">Ждём QR…</Badge>
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
            На сервере не задан секрет <code>WA_WEB_WORKER_KEY</code>. Без него QR не заработает.
          </p>
        )}

        {status?.worker_configured && !workerOnline && (
          <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Воркер офлайн. На VPS должен работать <code className="text-foreground">pm2: wa-web</code>.
          </p>
        )}

        {connected && (
          <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2.5 text-sm">
            <div className="font-medium text-foreground">
              {session?.display_name || "WhatsApp"} {session?.phone ? `· ${session.phone}` : ""}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Работает. Сообщения с этого номера появляются в CRM → Чаты.
            </p>
          </div>
        )}

        {waitingForQr && (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            Запрашиваем QR у воркера (обычно 2–5 сек)…
          </div>
        )}

        {hasQr && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-4">
            <img src={session!.qr_data!} alt="QR WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
            <p className="max-w-sm text-center text-xs text-muted-foreground">
              WhatsApp → ⋮ → Связанные устройства → Привязать устройство.
              После скана статус станет «Подключён».
            </p>
          </div>
        )}

        {(hint || errMsg) && !connected && (
          <p className={cn("text-xs", errMsg ? "text-destructive" : "text-muted-foreground")}>
            {errMsg || hint}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <Button
              onClick={() => void startPair()}
              disabled={!projectId || busy || waitingForQr || !workerOnline}
            >
              {busy || waitingForQr ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <QrCode className="h-4 w-4" />
              )}
              {hasQr ? "Обновить QR" : "Показать QR"}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void logout()} disabled={busy}>
              <Unplug className="h-4 w-4" />
              Отключить
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Обновить статус"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
