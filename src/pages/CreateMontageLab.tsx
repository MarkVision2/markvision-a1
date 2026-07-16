import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, Clock, Download, Film, Loader2, MonitorPlay,
  Scissors, Send, Smartphone, Upload, X,
} from "lucide-react";
import Header from "@/components/factory/Header";
import { TelegramConnect } from "@/components/factory/TelegramConnect";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  cancelMontageJob, createMontageJob, fetchMontageJobs, MONTAGE_STATUS_LABEL,
  uploadMontageSource, type MontageFormat, type MontageJob,
} from "@/lib/montageJobs";

// Статус заявки → цвет чипа.
const STATUS_STYLE: Record<MontageJob["status"], string> = {
  queued: "bg-secondary text-muted-foreground",
  processing: "bg-primary/10 text-primary",
  rendering: "bg-primary/10 text-primary",
  done: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  canceled: "bg-secondary text-muted-foreground",
};

const ACTIVE_STATUSES: MontageJob["status"][] = ["queued", "processing", "rendering"];

function JobCard({ job, onCancel }: { job: MontageJob; onCancel: (id: string) => void }) {
  const active = ACTIVE_STATUSES.includes(job.status);
  const shorts = job.result?.shorts ?? [];
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{job.source_name || "Видео"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {new Date(job.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" · "}
            {(job.formats ?? []).map((f) => (f === "shorts" ? `шортсы×${job.shorts_count ?? 3}` : "16:9")).join(" + ")}
          </div>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold", STATUS_STYLE[job.status])}>
          {active && <Loader2 className="h-3 w-3 animate-spin" />}
          {job.status === "done" && <CheckCircle2 className="h-3 w-3" />}
          {job.status === "failed" && <AlertTriangle className="h-3 w-3" />}
          {MONTAGE_STATUS_LABEL[job.status]}
        </span>
      </div>

      {active && job.progress && (
        <p className="text-xs text-muted-foreground">Сейчас: {job.progress}</p>
      )}
      {job.status === "failed" && job.error && (
        <p className="text-xs text-destructive">{job.error}</p>
      )}

      {job.status === "done" && (
        <div className="flex flex-wrap items-center gap-2">
          {job.result_video_url && (
            <a
              href={job.result_video_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <Download className="h-3.5 w-3.5" /> Скачать видео
            </a>
          )}
          {shorts.map((s, i) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Smartphone className="h-3.5 w-3.5" /> {s.title || `Шортс ${i + 1}`}
            </a>
          ))}
        </div>
      )}

      {job.status === "queued" && (
        <button
          type="button"
          onClick={() => onCancel(job.id)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" /> Отменить заявку
        </button>
      )}
    </div>
  );
}

const CreateMontageLab = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeId: projectId } = useProjectsStore();

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploaded, setUploaded] = useState<{ url: string; name: string } | null>(null);
  const [formats, setFormats] = useState<MontageFormat[]>(["16:9"]);
  const [shortsCount, setShortsCount] = useState(3);
  const [brief, setBrief] = useState("");
  const [notifyTelegram, setNotifyTelegram] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const jobsQ = useQuery({
    queryKey: ["montage-jobs", projectId],
    queryFn: () => fetchMontageJobs(projectId),
    enabled: !!projectId,
    // Пока есть активные заявки — поллим чаще, чтобы прогресс был живым.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((j) => ACTIVE_STATUSES.includes(j.status)) ? 15_000 : 60_000,
  });

  const handleFile = async (f: File | null) => {
    if (!f) return;
    if (!projectId) {
      toast.error("Сначала выберите проект (клиента) вверху");
      return;
    }
    setFile(f);
    setUploaded(null);
    setUploading(true);
    setUploadPct(0);
    try {
      const { url } = await uploadMontageSource(projectId, f, setUploadPct);
      setUploaded({ url, name: f.name });
      toast.success("Видео загружено");
    } catch (e) {
      setFile(null);
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleFormat = (f: MontageFormat) =>
    setFormats((prev) => {
      const next = prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f];
      return next.length ? next : prev; // хотя бы один формат
    });

  const canSubmit = !!projectId && !!uploaded && formats.length > 0 && !uploading && !submitting;

  const submit = async () => {
    if (!canSubmit || !uploaded) return;
    setSubmitting(true);
    try {
      await createMontageJob(projectId, {
        sourceUrl: uploaded.url,
        sourceName: uploaded.name,
        formats,
        shortsCount,
        brief,
        notifyTelegram,
      });
      setFile(null);
      setUploaded(null);
      setBrief("");
      toast.success("Заявка в очереди — монтаж начнётся автоматически");
      void queryClient.invalidateQueries({ queryKey: ["montage-jobs", projectId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await cancelMontageJob(id);
      void queryClient.invalidateQueries({ queryKey: ["montage-jobs", projectId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <main className="min-h-screen bg-background pb-16">
      <Header onClose={() => navigate("/")} />

      <div className="container max-w-3xl px-3 pt-6 sm:px-4">
        <div className="mb-6 flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Scissors className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Монтаж съёмки</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Загрузите сырую запись «говорящей головы» — конвейер сам вырежет паузы и дубли,
              добавит зумы и акценты, соберёт ролик и шортсы
            </p>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          Как это работает: видео уходит в очередь монтажа → AI-монтажёр (Claude + Remotion) делает
          транскрипт, вырезает паузы/дубли/слова-паразиты, ставит зумы на лицо и акцентные слова →
          готовый ролик появляется здесь, в разделе{" "}
          <button type="button" onClick={() => navigate("/create/montage")} className="font-medium text-primary underline">
            AI монтаж → Готовые
          </button>{" "}
          и, если подключён бот, приходит в Telegram.
        </div>

        {/* Исходник */}
        <section className="space-y-3">
          <label className="text-sm font-semibold">Видео для монтажа</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-sm transition",
              uploaded ? "border-success/40 bg-success/5" : "border-border/60 hover:border-primary/40 hover:bg-card/60",
            )}
          >
            {uploading ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-muted-foreground">Загружаем {file?.name}… {uploadPct > 0 && `${uploadPct}%`}</span>
                {uploadPct > 0 && (
                  <span className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${uploadPct}%` }} />
                  </span>
                )}
              </>
            ) : uploaded ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-success" />
                <span className="font-medium">{uploaded.name}</span>
                <span className="text-xs text-muted-foreground">Нажмите, чтобы заменить</span>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="font-medium">Выбрать видео</span>
                <span className="text-xs text-muted-foreground">MP4 / MOV / WebM до 2 ГБ — одна съёмка «говорящей головы»</span>
              </>
            )}
          </button>
        </section>

        {/* Форматы результата */}
        <section className="mt-6 space-y-3">
          <label className="text-sm font-semibold">Что смонтировать</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => toggleFormat("16:9")}
              aria-pressed={formats.includes("16:9")}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                formats.includes("16:9") ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40",
              )}
            >
              <MonitorPlay className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-semibold">Полный ролик 16:9</div>
                <div className="text-xs text-muted-foreground">YouTube / сайт — чистовой монтаж всей съёмки</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => toggleFormat("shorts")}
              aria-pressed={formats.includes("shorts")}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                formats.includes("shorts") ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40",
              )}
            >
              <Smartphone className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-semibold">Шортсы 9:16</div>
                <div className="text-xs text-muted-foreground">Лучшие моменты с караоке-субтитрами — Reels / Shorts</div>
              </div>
            </button>
          </div>
          {formats.includes("shorts") && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Сколько шортсов:</span>
              {[1, 2, 3, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setShortsCount(n)}
                  className={cn(
                    "h-8 w-8 rounded-lg border text-sm font-semibold transition",
                    shortsCount === n ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Пожелания */}
        <section className="mt-6 space-y-2">
          <label className="text-sm font-semibold">
            Пожелания к монтажу <span className="text-xs font-normal text-muted-foreground">— необязательно</span>
          </label>
          <Textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder="Напр.: тема — запуск курса; вырезать всё про старую программу; акцент на цифрах; темп динамичный…"
            className="resize-y"
          />
        </section>

        {/* Доставка */}
        <section className="mt-6 space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/50 p-3">
            <div className="flex items-center gap-2.5">
              <Send className="h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-semibold">Прислать готовое видео в Telegram</div>
                <div className="text-xs text-muted-foreground">В чат, привязанный к проекту (бот ниже)</div>
              </div>
            </div>
            <Switch checked={notifyTelegram} onCheckedChange={setNotifyTelegram} />
          </div>
          {notifyTelegram && <TelegramConnect projectId={projectId} />}
        </section>

        <Button className="mt-6 w-full gap-2" size="lg" disabled={!canSubmit} onClick={() => void submit()}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
          Отправить в монтаж
        </Button>

        {/* Мои заявки */}
        <section className="mt-8 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Заявки на монтаж</h2>
          </div>
          {!projectId ? (
            <p className="text-sm text-muted-foreground">Выберите проект (клиента) вверху, чтобы видеть заявки.</p>
          ) : jobsQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаем…
            </div>
          ) : (jobsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока пусто — загрузите первое видео выше.</p>
          ) : (
            <div className="space-y-2">
              {(jobsQ.data ?? []).map((j) => (
                <JobCard key={j.id} job={j} onCancel={(id) => void cancel(id)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};

export default CreateMontageLab;
