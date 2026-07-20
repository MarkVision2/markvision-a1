import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Archive, Bot, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Download, Film, FileVideo, FolderOpen, Loader2,
  MonitorPlay, Play, Scissors, Send, Smartphone, Sparkles, Upload, Wand2, X, Zap,
} from "lucide-react";
import Header from "@/components/factory/Header";
import { TelegramConnect, type TelegramConnectionStatus } from "@/components/factory/TelegramConnect";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  archiveCompletedMontageJobs, archiveMontageJob, cancelMontageJob, createMontageJob,
  fetchMontageJobs, MONTAGE_STATUS_LABEL, partitionMontageJobs,
  uploadMontageSource, type MontageFormat, type MontageJob, type MontageMode,
} from "@/lib/montageJobs";
import {
  MONTAGE_STYLE_TEMPLATES,
  type MontageStyleId,
} from "@/lib/montageTemplates";
import {
  buildReelsSourceConfig,
  fetchReelsAssetFolders,
  type ReelsBrollMode,
} from "@/lib/reelsAssets";
import { fetchReelsProviderStatus } from "@/lib/reelsProviderSettings";

const BROLL_OPTIONS: {
  id: ReelsBrollMode;
  title: string;
  description: string;
  icon: typeof Sparkles;
}[] = [
  { id: "auto", title: "Автоматически", description: "Система сама подберёт графику и вставки", icon: Sparkles },
  { id: "library", title: "Папки проекта", description: "Случайно брать ваши B-roll и нарезки", icon: FolderOpen },
  { id: "pexels", title: "Pexels", description: "Стоковые видео по смыслу сценария", icon: Film },
  { id: "kie", title: "Kie.ai", description: "Сгенерировать уникальные видео через Kling", icon: Bot },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// Стадии пайплайна — совпадают со скиллом montage-pipeline.
const STAGES = [
  { key: "transcript", label: "Транскрипт", match: /транскр|deepgram|words/i },
  { key: "review",     label: "Разметка",    match: /разметк|delete|review|дубл|пауз/i },
  { key: "edit",       label: "Монтаж",      match: /монтаж|edl|faces|accent|props|audio/i },
  { key: "render",     label: "Рендер",      match: /рендер|render|remotion|шортс|short/i },
];

const STATUS_STYLE: Record<MontageJob["status"], string> = {
  queued:     "bg-muted text-muted-foreground",
  processing: "bg-primary/10 text-primary",
  rendering:  "bg-primary/10 text-primary",
  done:       "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed:     "bg-destructive/10 text-destructive",
  canceled:   "bg-muted text-muted-foreground",
};

const ACTIVE_STATUSES: MontageJob["status"][] = ["queued", "processing", "rendering"];

const BRIEF_PRESETS = [
  { icon: Zap,      label: "Динамичный темп" },
  { icon: Sparkles, label: "Акцент на цифрах и фактах" },
  { icon: Wand2,    label: "Крупные титры на ключевые фразы" },
  { icon: MonitorPlay, label: "Анимация сверху на каждую мысль" },
];

function formatBytes(b: number) {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} МБ`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

function formatDuration(sec: number) {
  if (!isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function currentStageIndex(job: MontageJob): number {
  if (job.status === "queued") return -1;
  if (job.status === "rendering") return 3;
  if (job.status === "done") return 4;
  if (!job.progress) return job.status === "processing" ? 0 : -1;
  const idx = STAGES.findIndex((s) => s.match.test(job.progress ?? ""));
  return idx >= 0 ? idx : 0;
}

function JobCard({
  job,
  onCancel,
  onArchive,
}: {
  job: MontageJob;
  onCancel: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const active = ACTIVE_STATUSES.includes(job.status);
  const shorts = job.result?.shorts ?? [];
  const stageIdx = currentStageIndex(job);
  const [open, setOpen] = useState(false);

  return (
    <div className="group rounded-2xl border border-border/60 bg-card/40 p-4 transition hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
            job.status === "done" ? "bg-emerald-500/10 text-emerald-500"
            : job.status === "failed" ? "bg-destructive/10 text-destructive"
            : active ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
          )}>
            {active ? <Loader2 className="h-4 w-4 animate-spin" />
              : job.status === "done" ? <CheckCircle2 className="h-4 w-4" />
              : job.status === "failed" ? <AlertTriangle className="h-4 w-4" />
              : <FileVideo className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{job.source_name || "Видео"}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>{new Date(job.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span>·</span>
              <span>полный ролик 9:16</span>
            </div>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide", STATUS_STYLE[job.status])}>
          {MONTAGE_STATUS_LABEL[job.status]}
        </span>
      </div>

      {/* Стадии */}
      {(active || job.status === "done") && (
        <div className="mt-3">
          <div className="flex items-center gap-1">
            {STAGES.map((s, i) => {
              const passed = i < stageIdx || job.status === "done";
              const current = i === stageIdx && active;
              return (
                <div key={s.key} className="flex flex-1 flex-col items-center gap-1">
                  <div className={cn(
                    "h-1 w-full rounded-full transition",
                    passed ? "bg-primary" : current ? "bg-primary/40" : "bg-muted",
                  )}>
                    {current && <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />}
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium",
                    passed || current ? "text-foreground" : "text-muted-foreground/60",
                  )}>{s.label}</span>
                </div>
              );
            })}
          </div>
          {active && job.progress && (
            <p className="mt-2 truncate text-xs text-muted-foreground">
              <span className="text-primary">●</span> {job.progress}
            </p>
          )}
        </div>
      )}

      {job.status === "failed" && job.error && (
        <p className="mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">{job.error}</p>
      )}

      {job.status === "done" && (
        <div className="mt-3 space-y-2">
          {job.result_video_url && (
            <>
              {open ? (
                <video src={job.result_video_url} controls className="w-full rounded-lg bg-black" />
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="flex w-full items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/10"
                >
                  <Play className="h-4 w-4" /> Смотреть 9:16
                  <a
                    href={job.result_video_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" /> Скачать
                  </a>
                </button>
              )}
            </>
          )}
          {shorts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {shorts.map((s, i) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  <Smartphone className="h-3 w-3" /> {s.title || `Шортс ${i + 1}`}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {job.status === "queued" && (
        <button
          type="button"
          onClick={() => onCancel(job.id)}
          className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" /> Отменить заявку
        </button>
      )}

      {!active && (
        <button
          type="button"
          onClick={() => onArchive(job.id)}
          className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <Archive className="h-3.5 w-3.5" /> Убрать из списка
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  // Формат зафиксирован: только цельный 9:16, без нарезки на куски.
  const formats: MontageFormat[] = ["9:16"];
  const [brief, setBrief] = useState("");
  const [brollMode, setBrollMode] = useState<ReelsBrollMode>("auto");
  const [styleId, setStyleId] = useState<MontageStyleId>("expert-explainer");
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [notifyTelegram, setNotifyTelegram] = useState(true);
  const [telegramStatus, setTelegramStatus] = useState<TelegramConnectionStatus | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Режим монтажа + второе видео (запись экрана) для 50/50
  const [mode, setMode] = useState<MontageMode>("standard");
  const [file2, setFile2] = useState<File | null>(null);
  const [uploading2, setUploading2] = useState(false);
  const [uploadPct2, setUploadPct2] = useState(0);
  const [uploaded2, setUploaded2] = useState<{ url: string; name: string } | null>(null);
  const file2InputRef = useRef<HTMLInputElement>(null);

  // локальный preview URL для видео до загрузки
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const u = URL.createObjectURL(file);
    setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const jobsQ = useQuery({
    queryKey: ["montage-jobs", projectId],
    queryFn: () => fetchMontageJobs(projectId),
    enabled: !!projectId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((j) => ACTIVE_STATUSES.includes(j.status)) ? 15_000 : 60_000,
  });

  const foldersQ = useQuery({
    queryKey: ["reels-asset-folders", projectId],
    queryFn: () => fetchReelsAssetFolders(projectId),
    enabled: !!projectId,
  });
  const providersQ = useQuery({
    queryKey: ["reels-provider-status", projectId],
    queryFn: () => fetchReelsProviderStatus(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    setSelectedFolderIds([]);
    setBrollMode("auto");
  }, [projectId]);

  const effectiveProviderStatus = providersQ.data ?? {};
  const sourceConfig = useMemo(
    () => buildReelsSourceConfig(brollMode, selectedFolderIds),
    [brollMode, selectedFolderIds],
  );
  const sourceReady =
    (brollMode !== "pexels" || !!effectiveProviderStatus.pexels?.connected) &&
    (brollMode !== "kie" || !!effectiveProviderStatus.kie?.connected);

  const jobGroups = useMemo(() => partitionMontageJobs(jobsQ.data ?? []), [jobsQ.data]);
  const activeCount = jobGroups.active.length;

  const handleFile = async (f: File | null) => {
    if (!f) return;
    if (!projectId) {
      toast.error("Сначала выберите проект (клиента) вверху");
      return;
    }
    if (!f.type.startsWith("video/")) {
      toast.error("Нужен видео-файл (MP4 / MOV / WebM)");
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

  const clearFile = () => {
    setFile(null);
    setUploaded(null);
    setDuration(0);
    setUploadPct(0);
  };

  // Второе видео (запись экрана) для режима 50/50
  const handleFile2 = async (f: File | null) => {
    if (!f) return;
    if (!projectId) {
      toast.error("Сначала выберите проект (клиента) вверху");
      return;
    }
    if (!f.type.startsWith("video/")) {
      toast.error("Нужен видео-файл (MP4 / MOV / WebM)");
      return;
    }
    setFile2(f);
    setUploaded2(null);
    setUploading2(true);
    setUploadPct2(0);
    try {
      const { url } = await uploadMontageSource(projectId, f, setUploadPct2);
      setUploaded2({ url, name: f.name });
      toast.success("Видео экрана загружено");
    } catch (e) {
      setFile2(null);
      toast.error((e as Error).message);
    } finally {
      setUploading2(false);
      if (file2InputRef.current) file2InputRef.current.value = "";
    }
  };

  const clearFile2 = () => {
    setFile2(null);
    setUploaded2(null);
    setUploadPct2(0);
  };

  const addPreset = (text: string) => {
    setBrief((b) => {
      if (b.toLowerCase().includes(text.toLowerCase())) return b;
      return b.trim() ? `${b.trim()}\n• ${text}` : `• ${text}`;
    });
  };

  const needsSecond = mode === "5050";
  const canSubmit =
    !!projectId && !!uploaded && formats.length > 0 && !uploading && !submitting &&
    sourceReady &&
    (!needsSecond || (!!uploaded2 && !uploading2));

  const submit = async () => {
    if (!canSubmit || !uploaded) return;
    if (!sourceReady) {
      toast.error(`Сначала подключите ${brollMode === "pexels" ? "Pexels" : "Kie.ai"} в Reels → Источники`);
      navigate("/create/reels?tab=providers");
      return;
    }
    setSubmitting(true);
    try {
      await createMontageJob(projectId, {
        sourceUrl: uploaded.url,
        sourceName: uploaded.name,
        formats,
        brief,
        notifyTelegram,
        mode,
        source2Url: uploaded2?.url ?? null,
        source2Name: uploaded2?.name ?? null,
        brollMode: sourceConfig.brollMode,
        assetFolderIds: sourceConfig.assetFolderIds,
        styleId,
      });
      clearFile();
      clearFile2();
      setBrief("");
      setBrollMode("auto");
      setStyleId("expert-explainer");
      setSelectedFolderIds([]);
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

  const archive = async (id: string) => {
    try {
      await archiveMontageJob(id);
      toast.success("Заявка убрана в архив");
      void queryClient.invalidateQueries({ queryKey: ["montage-jobs", projectId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const clearHistory = async () => {
    if (!projectId || !jobGroups.history.length) return;
    if (!confirm(`Убрать завершённые заявки (${jobGroups.history.length}) из списка? Готовые видео останутся в разделе «Готовые».`)) return;
    setArchiving(true);
    try {
      await archiveCompletedMontageJobs(projectId);
      setHistoryOpen(false);
      toast.success("История заявок очищена");
      await queryClient.invalidateQueries({ queryKey: ["montage-jobs", projectId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setArchiving(false);
    }
  };

  return (
    <main className="min-h-screen bg-background pb-24">
      <Header onClose={() => navigate("/")} />

      <div className="container max-w-6xl px-3 pt-6 sm:px-4">
        {/* Заголовок */}
        <div className="mb-6 flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            <Scissors className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Монтаж съёмки</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Загрузите сырую «говорящую голову» — AI сделает цельный вертикальный ролик 9:16: зумы, акценты и motion-вставки. Без нарезки на куски.
            </p>
          </div>
          {activeCount > 0 && (
            <div className="hidden shrink-0 items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary sm:flex">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              В работе: {activeCount}
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ЛЕВАЯ КОЛОНКА — форма */}
          <div className="space-y-6">
            {/* Шаг 1. Загрузка */}
            <section className="rounded-2xl border border-border/60 bg-card/30 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
                <h2 className="text-sm font-semibold">Видео для монтажа</h2>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              />

              {!file && !uploaded ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void handleFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                >
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-sm transition",
                      dragOver
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:border-primary/40 hover:bg-card/60",
                    )}
                  >
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                      <Upload className="h-6 w-6" />
                    </span>
                    <span className="font-semibold text-foreground">Перетащите видео или нажмите, чтобы выбрать</span>
                    <span className="text-xs text-muted-foreground">MP4 / MOV / WebM · до 2 ГБ · одна съёмка «говорящей головы»</span>
                  </button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
                  <div className="relative aspect-video bg-black">
                    {previewUrl && (
                      <video
                        src={previewUrl}
                        controls
                        className="h-full w-full object-contain"
                        onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration)}
                      />
                    )}
                    {uploading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <div className="text-sm">Загружаем… {uploadPct}%</div>
                        <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/20">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${uploadPct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border/60 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {uploaded ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        ) : (
                          <FileVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate text-sm font-medium">{file?.name ?? uploaded?.name}</span>
                      </div>
                      <div className="mt-0.5 flex gap-3 text-[11px] text-muted-foreground">
                        {file && <span>{formatBytes(file.size)}</span>}
                        <span>{formatDuration(duration)}</span>
                        {uploaded && <span className="text-emerald-600 dark:text-emerald-400">Готово к монтажу</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-lg border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      >
                        Заменить
                      </button>
                      <button
                        type="button"
                        onClick={clearFile}
                        className="rounded-lg border border-border/60 px-2 py-1 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Режим монтажа */}
            <section className="rounded-2xl border border-border/60 bg-card/30 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
                <h2 className="text-sm font-semibold">Режим монтажа</h2>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode("standard")}
                  aria-pressed={mode === "standard"}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border-2 p-3 text-left transition",
                    mode === "standard" ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40",
                  )}
                >
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 transition", mode === "standard" ? "border-primary bg-primary/10" : "border-border/60")}>
                    <MonitorPlay className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="text-sm font-semibold">Стандарт</div>
                      {mode === "standard" && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                    </div>
                    <div className="text-xs text-muted-foreground">Ты на весь экран + вставки и моушн</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setMode("5050")}
                  aria-pressed={mode === "5050"}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border-2 p-3 text-left transition",
                    mode === "5050" ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40",
                  )}
                >
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 transition", mode === "5050" ? "border-primary bg-primary/10" : "border-border/60")}>
                    <Smartphone className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="text-sm font-semibold">Монтаж 50/50</div>
                      {mode === "5050" && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                    </div>
                    <div className="text-xs text-muted-foreground">Ты снизу + запись экрана сверху в моментах показа</div>
                  </div>
                </button>
              </div>

              {mode === "5050" && (
                <div className="mt-3 rounded-xl border-2 border-dashed border-border/60 p-3">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Второе видео — запись экрана</div>
                  <input
                    ref={file2InputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => void handleFile2(e.target.files?.[0] ?? null)}
                  />
                  {!uploaded2 && !uploading2 && (
                    <button
                      type="button"
                      onClick={() => file2InputRef.current?.click()}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-3 text-sm font-medium transition hover:border-primary/40"
                    >
                      <Upload className="h-4 w-4" /> Загрузить запись экрана
                    </button>
                  )}
                  {uploading2 && (
                    <div className="text-xs text-muted-foreground">
                      Загрузка… {uploadPct2}%
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                        <div className="h-full bg-primary transition-all" style={{ width: `${uploadPct2}%` }} />
                      </div>
                    </div>
                  )}
                  {uploaded2 && (
                    <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{uploaded2.name}</span>
                      <button type="button" onClick={clearFile2} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Шаг 3. Формат — только цельный ролик */}
            <section className="rounded-2xl border border-border/60 bg-card/30 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
                <h2 className="text-sm font-semibold">Что смонтировать</h2>
              </div>

              <div className="flex items-center gap-3 rounded-xl border-2 border-primary bg-primary/5 p-3">
                <div className="flex h-10 w-6 shrink-0 items-center justify-center rounded-md border-2 border-primary bg-primary/10">
                  <Smartphone className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <div className="text-sm font-semibold">Полный ролик 9:16</div>
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Исходник целиком в вертикали: караоке, акценты, вставки. Без нарезки на куски.
                  </div>
                </div>
              </div>
            </section>

            {/* Шаг 4. Стиль монтажа */}
            <section className="rounded-2xl border border-border/60 bg-card/30 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">4</span>
                <div>
                  <h2 className="text-sm font-semibold">Стиль монтажа</h2>
                  <p className="text-[11px] text-muted-foreground">
                    Шаблон задаёт ритм вставок, титры и cover-сцены
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {MONTAGE_STYLE_TEMPLATES.map((tpl) => {
                  const active = styleId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setStyleId(tpl.id)}
                      className={cn(
                        "overflow-hidden rounded-xl border-2 text-left transition",
                        active ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/30",
                      )}
                    >
                      <div className="relative aspect-[9/14] bg-secondary/40">
                        <img
                          src={tpl.thumb}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        {tpl.recommended && (
                          <span className="absolute left-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold text-black">
                            Референс
                          </span>
                        )}
                        {active && (
                          <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                      <div className="space-y-0.5 p-2.5">
                        <div className="text-sm font-semibold leading-tight">{tpl.title}</div>
                        <div className="text-[10px] font-medium text-primary">{tpl.subtitle}</div>
                        <div className="text-[11px] leading-snug text-muted-foreground">{tpl.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Шаг 5. B-roll — как в Reels-видео */}
            <section className="rounded-2xl border border-border/60 bg-card/30 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">5</span>
                <div>
                  <h2 className="text-sm font-semibold">Откуда брать B-roll</h2>
                  <p className="text-[11px] text-muted-foreground">Выберите один источник визуальных вставок</p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {BROLL_OPTIONS.map((option) => {
                  const connected = option.id === "pexels"
                    ? effectiveProviderStatus.pexels?.connected
                    : option.id === "kie"
                      ? effectiveProviderStatus.kie?.connected
                      : true;
                  const active = brollMode === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        if (!connected) {
                          toast.info(`Сначала подключите ${option.title} в Reels → Источники`);
                          navigate("/create/reels?tab=providers");
                          return;
                        }
                        setBrollMode(option.id);
                      }}
                      className={cn(
                        "relative flex items-start gap-3 rounded-xl border-2 p-3 text-left transition",
                        active ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/30",
                      )}
                    >
                      <span className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                        active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                      )}>
                        <option.icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          {option.title}
                          {!connected && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-600">нужен ключ</span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{option.description}</span>
                      </span>
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>

              {brollMode === "library" && (
                <div className="mt-3 rounded-xl border border-border/60 bg-background p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Папки для случайного выбора</span>
                    <button
                      type="button"
                      onClick={() => navigate("/create/reels?tab=library")}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      Управлять медиатекой
                    </button>
                  </div>
                  {(foldersQ.data ?? []).length === 0 ? (
                    <button
                      type="button"
                      onClick={() => navigate("/create/reels?tab=library")}
                      className="w-full rounded-lg border border-dashed border-border/60 py-3 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    >
                      Создать папку и загрузить B-roll
                    </button>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(foldersQ.data ?? []).map((folder) => (
                        <Chip
                          key={folder.id}
                          active={selectedFolderIds.includes(folder.id)}
                          onClick={() => setSelectedFolderIds((current) =>
                            current.includes(folder.id)
                              ? current.filter((id) => id !== folder.id)
                              : [...current, folder.id])}
                        >
                          <span className="inline-flex items-center gap-1">
                            <FolderOpen className="h-3 w-3" /> {folder.name} · {folder.asset_count ?? 0}
                          </span>
                        </Chip>
                      ))}
                    </div>
                  )}
                  {selectedFolderIds.length === 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Папка не выбрана — для этой заявки система автоматически создаст визуальные вставки.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Шаг 6. Бриф */}
            <section className="rounded-2xl border border-border/60 bg-card/30 p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">6</span>
                  <h2 className="text-sm font-semibold">Пожелания к монтажу</h2>
                </div>
                <span className="text-[11px] text-muted-foreground">Необязательно</span>
              </div>

              <div className="mb-2 flex flex-wrap gap-1.5">
                {BRIEF_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => addPreset(p.label)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                  >
                    <p.icon className="h-3 w-3" /> {p.label}
                  </button>
                ))}
              </div>

              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                placeholder="Тема — запуск курса; вырезать всё про старую программу; акцент на цифрах; темп динамичный…"
                className="resize-y bg-background"
              />
              <div className="mt-1 text-right text-[11px] text-muted-foreground">{brief.length} / 4000</div>
            </section>

            {/* Шаг 7. Доставка */}
            <section className="rounded-2xl border border-border/60 bg-card/30 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">7</span>
                <h2 className="text-sm font-semibold">Доставка результата</h2>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background p-3">
                <div className="flex items-center gap-2.5">
                  <Send className="h-4 w-4 text-primary" />
                  <div>
                    <div className="text-sm font-medium">Прислать в Telegram</div>
                    <div className="text-xs text-muted-foreground">
                      {telegramStatus?.connected
                        ? telegramStatus.destination?.username
                          ? `В @${telegramStatus.destination.username}`
                          : `В чат ••••${telegramStatus.destination?.chat_id_last4}`
                        : "Telegram пока не подключён"}
                    </div>
                  </div>
                </div>
                <Switch checked={notifyTelegram} onCheckedChange={setNotifyTelegram} />
              </div>
              {notifyTelegram && (
                <div className="mt-3">
                  <TelegramConnect
                    projectId={projectId}
                    compact
                    onStatusChange={setTelegramStatus}
                  />
                </div>
              )}
            </section>
          </div>

          {/* ПРАВАЯ КОЛОНКА — сводка + очередь */}
          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            {/* Сводка + CTA */}
            <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Film className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Сводка заявки</h3>
              </div>
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Исходник</dt>
                  <dd className={cn("truncate font-medium", uploaded ? "text-foreground" : "text-muted-foreground/60")}>
                    {uploaded?.name ?? "не загружен"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Формат</dt>
                  <dd className="font-medium">полный 9:16</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Стиль</dt>
                  <dd className="font-medium">
                    {MONTAGE_STYLE_TEMPLATES.find((t) => t.id === styleId)?.title ?? styleId}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">B-roll</dt>
                  <dd className="font-medium">
                    {BROLL_OPTIONS.find((item) => item.id === sourceConfig.brollMode)?.title ?? "Авто"}
                  </dd>
                </div>
                {sourceConfig.brollMode === "library" && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Папки</dt>
                    <dd className="font-medium">{sourceConfig.assetFolderIds.length}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Бриф</dt>
                  <dd className={cn("font-medium", brief ? "text-foreground" : "text-muted-foreground/60")}>
                    {brief ? `${brief.length} симв.` : "нет"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Telegram</dt>
                  <dd className={cn("font-medium", notifyTelegram && !telegramStatus?.connected && "text-amber-600 dark:text-amber-400")}>
                    {!notifyTelegram
                      ? "отключён"
                      : telegramStatus?.connected
                        ? telegramStatus.destination?.username
                          ? `@${telegramStatus.destination.username}`
                          : "подключён"
                        : "не подключён"}
                  </dd>
                </div>
              </dl>

              <Button
                className="mt-4 w-full gap-2"
                size="lg"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                Отправить в монтаж
              </Button>
              {!projectId && (
                <p className="mt-2 text-center text-[11px] text-muted-foreground">Выберите проект вверху</p>
              )}
              {projectId && !uploaded && (
                <p className="mt-2 text-center text-[11px] text-muted-foreground">Сначала загрузите видео</p>
              )}
              {projectId && uploaded && !sourceReady && (
                <button
                  type="button"
                  onClick={() => navigate("/create/reels?tab=providers")}
                  className="mt-2 w-full text-center text-[11px] text-amber-600 hover:underline"
                >
                  Подключите ключ выбранного источника B-roll
                </button>
              )}
            </div>

            {/* Очередь заявок */}
            <div className="rounded-2xl border border-border/60 bg-card/30 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <h3 className="text-sm font-semibold">Заявки в работе</h3>
                    <p className="text-[11px] text-muted-foreground">Готовые автоматически уходят в историю</p>
                  </div>
                </div>
                {activeCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {activeCount}
                  </span>
                )}
              </div>

              {!projectId ? (
                <p className="text-xs text-muted-foreground">Выберите проект (клиента) вверху.</p>
              ) : jobsQ.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Загружаем…
                </div>
              ) : jobGroups.active.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 p-4 text-center">
                  <CheckCircle2 className="mx-auto mb-1.5 h-5 w-5 text-emerald-500/70" />
                  <p className="text-xs font-medium">Активных заявок нет</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Загрузите видео — оно появится здесь с прогрессом</p>
                </div>
              ) : (
                <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                  {jobGroups.active.map((j) => (
                    <JobCard
                      key={j.id}
                      job={j}
                      onCancel={(id) => void cancel(id)}
                      onArchive={(id) => void archive(id)}
                    />
                  ))}
                </div>
              )}

              {jobGroups.history.length > 0 && (
                <div className="mt-3 border-t border-border/50 pt-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setHistoryOpen((value) => !value)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs font-medium text-muted-foreground transition hover:text-foreground"
                    >
                      {historyOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      История результатов
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{jobGroups.history.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void clearHistory()}
                      disabled={archiving}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground transition hover:bg-secondary hover:text-destructive disabled:opacity-50"
                    >
                      {archiving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                      Очистить
                    </button>
                  </div>
                  {historyOpen && (
                    <div className="mt-2 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                      {jobGroups.history.map((j) => (
                        <JobCard
                          key={j.id}
                          job={j}
                          onCancel={(id) => void cancel(id)}
                          onArchive={(id) => void archive(id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => navigate("/create/montage")}
                className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-border/60 py-2 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
              >
                Открыть все готовые видео →
              </button>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
};

export default CreateMontageLab;
