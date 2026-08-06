import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "audio/webm";
}

function formatSec(n: number) {
  const s = Math.max(0, Math.floor(n));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type VoicePayload = {
  base64: string;
  mime: string;
  durationSec: number;
};

type Props = {
  disabled?: boolean;
  busy?: boolean;
  /** Start recording immediately on mount (after user clicked mic in parent). */
  autoStart?: boolean;
  onSend: (payload: VoicePayload) => Promise<void> | void;
  className?: string;
};

/**
 * Hold-to-record / tap-to-record voice note for CRM chats.
 * Idle: mic button. Recording: timer + stop. Ready: send / discard.
 */
export function ChatVoiceButton({ disabled, busy, autoStart, onSend, className }: Props) {
  const [phase, setPhase] = useState<"idle" | "recording" | "ready">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef("audio/webm");
  const autoStartedRef = useRef(false);

  const cleanupStream = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRef.current = null;
  }, []);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  const start = useCallback(async () => {
    if (disabled || busy || sending) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        blobRef.current = blob;
        cleanupStream();
        if (blob.size < 400) {
          setError("Слишком коротко — удержите дольше");
          setPhase("idle");
          setSeconds(0);
          return;
        }
        setPhase("ready");
      };
      mediaRef.current = rec;
      startedAtRef.current = Date.now();
      setSeconds(0);
      setPhase("recording");
      rec.start(250);
      tickRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
    } catch {
      setError("Нет доступа к микрофону");
      cleanupStream();
      setPhase("idle");
    }
  }, [busy, cleanupStream, disabled, sending]);

  useEffect(() => {
    if (!autoStart || autoStartedRef.current || disabled) return;
    autoStartedRef.current = true;
    void start();
  }, [autoStart, disabled, start]);

  const stop = () => {
    const rec = mediaRef.current;
    if (!rec || rec.state === "inactive") {
      cleanupStream();
      setPhase("idle");
      return;
    }
    try {
      rec.stop();
    } catch {
      cleanupStream();
      setPhase("idle");
    }
  };

  const discard = () => {
    blobRef.current = null;
    setSeconds(0);
    setPhase("idle");
    setError(null);
  };

  const send = async () => {
    const blob = blobRef.current;
    if (!blob || sending) return;
    setSending(true);
    setError(null);
    try {
      const base64 = await blobToBase64(blob);
      await onSend({
        base64,
        mime: mimeRef.current,
        durationSec: seconds,
      });
      discard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не отправилось");
    } finally {
      setSending(false);
    }
  };

  if (phase === "recording") {
    return (
      <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
        <button
          type="button"
          onClick={stop}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-destructive text-destructive-foreground shadow-sm sm:h-10 sm:w-10"
          aria-label="Стоп"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
          </span>
          Запись {formatSec(seconds)}
          <span className="truncate text-xs font-normal text-destructive/80">· нажмите стоп</span>
        </div>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
        <button
          type="button"
          onClick={discard}
          disabled={sending}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 bg-secondary/60 text-muted-foreground hover:bg-secondary sm:h-10 sm:w-10"
          aria-label="Удалить"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
          <Mic className="h-4 w-4 shrink-0" />
          Голосовое {formatSec(seconds)}
        </div>
        <Button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          className="h-11 shrink-0 rounded-full bg-gradient-primary px-4 text-primary-foreground sm:h-10"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Отправить"}
        </Button>
        {error && (
          <span className="basis-full text-[11px] text-destructive">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || busy}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 bg-secondary/50 text-foreground transition-colors hover:bg-secondary disabled:opacity-50 sm:h-10 sm:w-10"
        aria-label="Записать голосовое"
        title="Голосовое сообщение"
      >
        <Mic className="h-4 w-4" />
      </button>
      {error && (
        <span className="absolute -top-6 right-0 whitespace-nowrap text-[10px] text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
