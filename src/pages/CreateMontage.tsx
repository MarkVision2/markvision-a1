import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  AlertTriangle, Check, Clapperboard, Download, Film, Loader2, Pause, Play, Plus, Search,
  Sparkles, Star, Upload, UserRound, Video, Volume2, X, Zap,
} from "lucide-react";
import Header from "@/components/factory/Header";
import { AspectRatioPicker } from "@/components/factory/AspectRatioPicker";
import { TelegramConnect } from "@/components/factory/TelegramConnect";
import { HeygenUsagePanel } from "@/components/factory/HeygenUsagePanel";
import { estimateCost, recordUsage } from "@/lib/heygenUsage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AspectId } from "@/data/contentTypeFlows";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { cacheDefaults, fetchServerDefaults, loadDefaults, patchDefaults, type HeygenDefaults } from "@/lib/heygenDefaults";
import {
  fetchAgentStatus, fetchAvatars, fetchTemplates, fetchVideoStatus, fetchVoices,
  generateAvatarVideo, generateFromClips, generateTemplateVideo, generateVideoAgent, uploadClip,
  type AgentStatus, type HeygenAvatar, type HeygenTemplate, type HeygenVideoStatus, type HeygenVoice,
} from "@/hooks/useHeygen";

// Кнопка «по умолчанию» для аватара / голоса / шаблона.
function DefaultStar({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium transition",
        on ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      <Star className={cn("h-3.5 w-3.5", on && "fill-primary")} />
      {on ? "По умолчанию" : "Сделать по умолчанию"}
    </button>
  );
}

// Только вертикаль (Reels/Stories) и горизонталь (YouTube/баннер).
const ASPECTS: AspectId[] = ["9:16", "16:9"];

const DIMENSIONS: Record<AspectId, { width: number; height: number }> = {
  "9:16": { width: 720, height: 1280 },
  "16:9": { width: 1280, height: 720 },
  "1:1": { width: 720, height: 720 },
  "4:5": { width: 864, height: 1080 },
  "3:4": { width: 810, height: 1080 },
  "21:9": { width: 1280, height: 548 },
};

const isTerminal = (s?: string) => s === "completed" || s === "failed";

// ── Карточка аватара (видео при наведении) ──────────────────────────────────
function AvatarCard({ a, active, onSelect }: { a: HeygenAvatar; active: boolean; onSelect: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/60 bg-card/60 text-left transition hover:border-primary/40",
        active && "border-primary ring-2 ring-primary/40",
      )}
    >
      <div className="relative aspect-[3/4] w-full bg-secondary/50">
        {hover && a.preview_video_url ? (
          <video src={a.preview_video_url} className="h-full w-full object-cover" autoPlay muted loop playsInline />
        ) : a.preview_image_url ? (
          <img src={a.preview_image_url} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <UserRound className="h-7 w-7" />
          </div>
        )}
        {active && (
          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="truncate p-2 text-xs font-medium">{a.name}</div>
    </button>
  );
}

// ── Панель выбранного аватара ───────────────────────────────────────────────
function SelectedAvatar({ a }: { a: HeygenAvatar }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
      <div className="aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-lg bg-secondary/50">
        {a.preview_video_url ? (
          <video src={a.preview_video_url} className="h-full w-full object-cover" autoPlay muted loop playsInline />
        ) : a.preview_image_url ? (
          <img src={a.preview_image_url} alt={a.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground"><UserRound className="h-6 w-6" /></div>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-primary">Выбранный аватар</div>
        <div className="truncate text-sm font-semibold">{a.name}</div>
        <div className="text-xs text-muted-foreground">
          {a.kind === "talking_photo" ? "Ваш видео-аватар" : "HeyGen аватар"}
          {a.gender ? ` · ${a.gender}` : ""}
        </div>
      </div>
    </div>
  );
}

// ── Пикер аватара ───────────────────────────────────────────────────────────
function AvatarPicker({
  query, selected, onSelect, optional, isDefault, onToggleDefault,
}: {
  query: UseQueryResult<HeygenAvatar[]>;
  selected: HeygenAvatar | null;
  onSelect: (a: HeygenAvatar | null) => void;
  optional?: boolean;
  isDefault?: boolean;
  onToggleDefault?: () => void;
}) {
  const all = query.data ?? [];
  const mine = all.filter((a) => a.mine);
  const heygenAvatars = all.filter((a) => !a.mine);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold">
          Аватар {optional && <span className="text-xs font-normal text-muted-foreground">— необязательно</span>}
        </label>
        {selected && optional && (
          <button type="button" onClick={() => onSelect(null)} className="text-xs text-muted-foreground hover:text-foreground">
            Сбросить
          </button>
        )}
      </div>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем аватаров…
        </div>
      ) : query.error ? (
        <p className="text-sm text-warning">Аватары недоступны: {(query.error as Error).message}</p>
      ) : (
        <>
          {selected && (
            <div className="space-y-2">
              <SelectedAvatar a={selected} />
              {onToggleDefault && (
                <div className="flex justify-end">
                  <DefaultStar on={!!isDefault} onClick={onToggleDefault} />
                </div>
              )}
            </div>
          )}

          {mine.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <UserRound className="h-3.5 w-3.5" /> Мои аватары
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {mine.map((a) => (
                  <AvatarCard key={a.id} a={a} active={selected?.id === a.id} onSelect={() => onSelect(a)} />
                ))}
              </div>
            </div>
          )}

          <div>
            {mine.length > 0 && (
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" /> Аватары HeyGen
              </div>
            )}
            <div className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
              {heygenAvatars.map((a) => (
                <AvatarCard key={a.id} a={a} active={selected?.id === a.id} onSelect={() => onSelect(a)} />
              ))}
              {all.length === 0 && <p className="col-span-full text-sm text-muted-foreground">Аватары не найдены.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ── Пикер голоса (с прослушиванием) ─────────────────────────────────────────
function VoicePicker({
  query, value, onChange, optional, isDefault, onToggleDefault,
}: {
  query: UseQueryResult<HeygenVoice[]>;
  value: string;
  onChange: (id: string) => void;
  optional?: boolean;
  isDefault?: boolean;
  onToggleDefault?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const all = query.data ?? [];
  const selectedVoice = all.find((v) => v.voice_id === value) ?? null;
  const q = search.trim().toLowerCase();
  const filtered = (q
    ? all.filter((v) => `${v.name} ${v.language ?? ""} ${v.gender ?? ""}`.toLowerCase().includes(q))
    : all
  ).slice(0, 80);

  const togglePlay = (v: HeygenVoice) => {
    if (!v.preview_audio) return;
    if (playing === v.voice_id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(v.preview_audio);
    audio.onended = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
    audioRef.current = audio;
    setPlaying(v.voice_id);
  };

  return (
    <section className="space-y-2">
      <label className="text-sm font-semibold">
        Голос {optional && <span className="text-xs font-normal text-muted-foreground">— необязательно</span>}
      </label>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем голоса…
        </div>
      ) : query.error ? (
        <p className="text-sm text-warning">Голоса недоступны: {(query.error as Error).message}</p>
      ) : (
        <>
          {selectedVoice && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <Volume2 className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {selectedVoice.name}
                  {selectedVoice.language ? ` · ${selectedVoice.language}` : ""}
                  {selectedVoice.gender ? ` · ${selectedVoice.gender}` : ""}
                </span>
                {optional && (
                  <button type="button" onClick={() => onChange("")} className="text-xs text-muted-foreground hover:text-foreground">
                    Сбросить
                  </button>
                )}
              </div>
              {onToggleDefault && (
                <div className="flex justify-end">
                  <DefaultStar on={!!isDefault} onClick={onToggleDefault} />
                </div>
              )}
            </div>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: имя, язык (напр. Russian), пол…"
              className="pl-9"
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {filtered.map((v) => {
              const active = value === v.voice_id;
              const isPlaying = playing === v.voice_id;
              return (
                <div
                  key={v.voice_id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2 py-1.5 transition",
                    active ? "border-primary bg-primary/5" : "border-transparent hover:bg-secondary/60",
                  )}
                >
                  <button
                    type="button"
                    aria-label={isPlaying ? "Пауза" : "Прослушать"}
                    disabled={!v.preview_audio}
                    onClick={() => togglePlay(v)}
                    className={cn(
                      "grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border/60 text-muted-foreground transition",
                      v.preview_audio ? "hover:border-primary/50 hover:text-primary" : "opacity-40",
                      isPlaying && "border-primary bg-primary/10 text-primary",
                    )}
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(v.voice_id)}
                    className="min-w-0 flex-1 text-left text-sm"
                  >
                    <span className="truncate font-medium">{v.name}</span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      {v.language ?? ""}{v.language && v.gender ? " · " : ""}{v.gender ?? ""}
                    </span>
                  </button>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </div>
              );
            })}
            {filtered.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">Ничего не найдено.</p>}
          </div>
        </>
      )}
    </section>
  );
}

interface ClipItem {
  key: string;
  name: string;
  url?: string;
  script: string;
  status: "uploading" | "ready" | "error";
  error?: string;
}

const CreateMontage = () => {
  const navigate = useNavigate();
  const { activeId: projectId } = useProjectsStore();
  const [mode, setMode] = useState<"agent" | "avatar" | "template" | "clips">("agent");
  const [aspect, setAspect] = useState<AspectId>("9:16");

  const [agentPrompt, setAgentPrompt] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<HeygenAvatar | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [script, setScript] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [defaults, setDefaults] = useState<HeygenDefaults>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Дефолты — на активный проект (клиента): применяем кэш сразу, затем сервер.
  const applyDefaults = (d: HeygenDefaults) => {
    setDefaults(d);
    setSelectedAvatar(d.avatar ? { ...d.avatar } : null);
    setVoiceId(d.voice?.id ?? "");
    setTemplateId(d.templateId ?? "");
  };
  useEffect(() => {
    if (!projectId) {
      applyDefaults({});
      return;
    }
    applyDefaults(loadDefaults(projectId));
    let cancelled = false;
    fetchServerDefaults(projectId).then((d) => {
      if (cancelled || !d) return;
      cacheDefaults(projectId, d);
      applyDefaults(d);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const [videoId, setVideoId] = useState<string | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Каталог аватаров/голосов нужен всем режимам кроме «шаблона».
  const needsCatalog = mode !== "template";
  const avatarsQ = useQuery({ queryKey: ["heygen-avatars"], queryFn: fetchAvatars, staleTime: 300_000, enabled: needsCatalog });
  const voicesQ = useQuery({ queryKey: ["heygen-voices"], queryFn: fetchVoices, staleTime: 300_000, enabled: needsCatalog });
  const templatesQ = useQuery({
    queryKey: ["heygen-templates"], queryFn: fetchTemplates, staleTime: 300_000, enabled: mode === "template",
  });

  const statusQ = useQuery<HeygenVideoStatus>({
    queryKey: ["heygen-status", videoId],
    queryFn: () => fetchVideoStatus(videoId as string),
    enabled: !!videoId,
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : 8_000),
  });

  const agentTerminal = (s?: AgentStatus) =>
    !!s?.video_url || ["completed", "success", "done", "failed", "error"].includes(s?.status ?? "");

  const agentQ = useQuery<AgentStatus>({
    queryKey: ["heygen-agent", agentSessionId],
    queryFn: () => fetchAgentStatus(agentSessionId as string),
    enabled: !!agentSessionId,
    refetchInterval: (query) => (agentTerminal(query.state.data) ? false : 10_000),
  });

  const loadError = avatarsQ.error || voicesQ.error;

  useEffect(() => {
    if (statusQ.data?.status === "failed") toast.error("HeyGen: рендер не удался");
  }, [statusQ.data?.status]);

  useEffect(() => {
    const s = agentQ.data?.status ?? "";
    if (["failed", "error"].includes(s)) {
      toast.error("HeyGen: генерация не удалась");
    } else if (["completed", "success", "done"].includes(s) && !agentQ.data?.video_url) {
      toast.error("HeyGen: готово, но ссылка на видео не пришла — попробуйте ещё раз");
    }
  }, [agentQ.data?.status, agentQ.data?.video_url]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const items: ClipItem[] = Array.from(files).map((f, i) => ({
      key: `${f.name}-${f.size}-${i}-${clips.length}`,
      name: f.name,
      script: "",
      status: "uploading",
    }));
    setClips((prev) => [...prev, ...items]);
    await Promise.all(
      Array.from(files).map(async (file, i) => {
        const key = items[i].key;
        try {
          const { url } = await uploadClip(file);
          setClips((prev) => prev.map((c) => (c.key === key ? { ...c, url, status: "ready" } : c)));
        } catch (e) {
          setClips((prev) => prev.map((c) => (c.key === key ? { ...c, status: "error", error: (e as Error).message } : c)));
        }
      }),
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const avatarRef = selectedAvatar ? { kind: selectedAvatar.kind, id: selectedAvatar.id } : null;

  // ── Дефолты (на активный проект): сохранить/сбросить аватар/голос/шаблон ────
  const noProject = () => toast.error("Сначала выберите проект (клиента) вверху");
  const avatarIsDefault = !!selectedAvatar && defaults.avatar?.id === selectedAvatar.id && defaults.avatar?.kind === selectedAvatar.kind;
  const toggleDefaultAvatar = () => {
    if (!selectedAvatar) return;
    if (!projectId) return noProject();
    const next = patchDefaults(projectId, {
      avatar: avatarIsDefault ? undefined : {
        id: selectedAvatar.id, kind: selectedAvatar.kind, name: selectedAvatar.name, mine: selectedAvatar.mine,
        preview_image_url: selectedAvatar.preview_image_url, preview_video_url: selectedAvatar.preview_video_url,
      },
    });
    setDefaults(next);
    toast.success(avatarIsDefault ? "Аватар убран из «по умолчанию»" : "Аватар сохранён по умолчанию для проекта");
  };

  const selectedVoice = (voicesQ.data ?? []).find((v) => v.voice_id === voiceId) ?? null;
  const voiceIsDefault = !!voiceId && defaults.voice?.id === voiceId;
  const toggleDefaultVoice = () => {
    if (!voiceId) return;
    if (!projectId) return noProject();
    const next = patchDefaults(projectId, {
      voice: voiceIsDefault ? undefined
        : { id: voiceId, name: selectedVoice?.name ?? "Голос", language: selectedVoice?.language, gender: selectedVoice?.gender },
    });
    setDefaults(next);
    toast.success(voiceIsDefault ? "Голос убран из «по умолчанию»" : "Голос сохранён по умолчанию для проекта");
  };

  const selectedTemplate = (templatesQ.data ?? []).find((t: HeygenTemplate) => t.template_id === templateId) ?? null;
  const templateIsDefault = !!templateId && defaults.templateId === templateId;
  const toggleDefaultTemplate = () => {
    if (!templateId) return;
    if (!projectId) return noProject();
    const next = patchDefaults(projectId,
      templateIsDefault
        ? { templateId: undefined, templateName: undefined }
        : { templateId, templateName: selectedTemplate?.name },
    );
    setDefaults(next);
    toast.success(templateIsDefault ? "Шаблон убран из «по умолчанию»" : "Шаблон сохранён по умолчанию");
  };

  const canSubmitAgent = agentPrompt.trim().length > 0;
  const canSubmitAvatar = !!avatarRef && !!voiceId && script.trim().length > 0;
  const canSubmitTemplate = !!templateId;
  const canSubmitClips =
    !!avatarRef && !!voiceId && clips.length > 0 &&
    clips.every((c) => c.status === "ready" && c.script.trim().length > 0);

  const canSubmit =
    mode === "agent" ? canSubmitAgent
      : mode === "avatar" ? canSubmitAvatar
        : mode === "template" ? canSubmitTemplate
          : canSubmitClips;

  const handleGenerate = async () => {
    const dim = DIMENSIONS[aspect];
    setSubmitting(true);
    setVideoId(null);
    setAgentSessionId(null);
    try {
      if (mode === "agent") {
        setAgentSessionId(await generateVideoAgent({
          prompt: agentPrompt.trim(),
          avatar: avatarRef ?? undefined,
          voiceId: voiceId || undefined,
        }));
      } else if (mode === "avatar") {
        setVideoId(await generateAvatarVideo({ avatar: avatarRef!, voiceId, script: script.trim(), width: dim.width, height: dim.height }));
      } else if (mode === "template") {
        setVideoId(await generateTemplateVideo({ templateId, width: dim.width, height: dim.height }));
      } else {
        setVideoId(await generateFromClips({
          avatar: avatarRef!, voiceId,
          scenes: clips.map((c) => ({ clipUrl: c.url as string, script: c.script.trim() })),
          width: dim.width, height: dim.height,
        }));
      }
      toast.success("Запущено — собираем видео");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось запустить генерацию");
    } finally {
      setSubmitting(false);
    }
  };

  // Состояние активной задачи считаем ГЛОБАЛЬНО (по видимому videoId/agentSessionId),
  // а не по текущей вкладке — иначе результат пропадает и рендер бросается при переключении.
  const agentActive = !!agentSessionId;
  const agentStr = agentQ.data?.status ?? "";
  const agentUrl = agentQ.data?.video_url;
  const agentIsTerminal = !!agentUrl || ["completed", "success", "done", "failed", "error"].includes(agentStr);

  const v2Active = !!videoId;
  const v2Done = statusQ.data?.status === "completed" && !!statusQ.data?.video_url;

  const rendering =
    (agentActive && !agentIsTerminal) || (v2Active && !isTerminal(statusQ.data?.status));

  const resultUrl = agentActive ? agentUrl : v2Done ? statusQ.data?.video_url : undefined;
  const resultThumb = agentActive ? agentQ.data?.thumbnail_url : statusQ.data?.thumbnail_url;

  // Учёт расхода при завершении рендера (один раз на задачу).
  const recordedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resultUrl || !projectId) return;
    const ref = agentActive ? agentSessionId : videoId;
    if (!ref || recordedRef.current === ref) return;
    recordedRef.current = ref;
    const durationSec = agentActive ? agentQ.data?.duration_sec : statusQ.data?.duration_sec;
    void recordUsage(projectId, {
      source: "web",
      mode,
      ref_id: ref,
      duration_sec: durationSec ?? null,
      cost_usd: estimateCost(mode, durationSec),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultUrl]);

  const busyLabel = useMemo(() => {
    if (submitting) return "Отправляем в HeyGen…";
    if (rendering) return "HeyGen собирает видео…";
    return null;
  }, [submitting, rendering]);

  return (
    <main className="min-h-screen bg-background pb-16">
      <Header onClose={() => navigate("/")} />

      <div className="container max-w-3xl px-3 pt-6 sm:px-4">
        <div className="mb-6 flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Clapperboard className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">AI монтаж</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Видео через HeyGen: быстрое создание из текста, аватар со сценарием, шаблон или монтаж из ваших клипов
            </p>
          </div>
        </div>

        {loadError && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Не удалось получить данные HeyGen: {(loadError as Error).message}.
              <br />
              Проверь, что в секретах Supabase задан <code>HEYGEN_API_KEY</code> и план даёт доступ к API.
            </div>
          </div>
        )}

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="grid w-full grid-cols-4 rounded-2xl">
            <TabsTrigger value="agent" className="gap-1 rounded-xl px-1 text-[11px] sm:gap-1.5 sm:text-sm">
              <Zap className="h-4 w-4 shrink-0" /> Быстро
            </TabsTrigger>
            <TabsTrigger value="avatar" className="gap-1 rounded-xl px-1 text-[11px] sm:gap-1.5 sm:text-sm">
              <Sparkles className="h-4 w-4 shrink-0" /> Аватар
            </TabsTrigger>
            <TabsTrigger value="template" className="gap-1 rounded-xl px-1 text-[11px] sm:gap-1.5 sm:text-sm">
              <Film className="h-4 w-4 shrink-0" /> Шаблон
            </TabsTrigger>
            <TabsTrigger value="clips" className="gap-1 rounded-xl px-1 text-[11px] sm:gap-1.5 sm:text-sm">
              <Video className="h-4 w-4 shrink-0" /> Клипы
            </TabsTrigger>
          </TabsList>

          {/* Быстрое создание (Video Agent) */}
          <TabsContent value="agent" className="mt-6 space-y-6 focus-visible:outline-none">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Вставьте текст или бриф — HeyGen сам соберёт сцены, б-ролл, субтитры и смонтирует видео.
              Аватар и голос ниже — по желанию: не выберете, агент подберёт сам.
            </div>
            <section>
              <label className="mb-2 block text-sm font-semibold">Текст / сценарий</label>
              <Textarea
                value={agentPrompt}
                onChange={(e) => setAgentPrompt(e.target.value)}
                rows={7}
                placeholder="Напр.: Сделай ролик на 45 секунд о запуске нашего продукта, дружелюбный тон, вертикальный формат для Reels…"
                className="resize-y"
              />
              <p className="mt-1 text-xs text-muted-foreground">{agentPrompt.trim().length} символов</p>
            </section>
            <AvatarPicker query={avatarsQ} selected={selectedAvatar} onSelect={setSelectedAvatar} optional isDefault={avatarIsDefault} onToggleDefault={toggleDefaultAvatar} />
            <VoicePicker query={voicesQ} value={voiceId} onChange={setVoiceId} optional isDefault={voiceIsDefault} onToggleDefault={toggleDefaultVoice} />
          </TabsContent>

          {/* Аватар + сценарий */}
          <TabsContent value="avatar" className="mt-6 space-y-6 focus-visible:outline-none">
            <AvatarPicker query={avatarsQ} selected={selectedAvatar} onSelect={setSelectedAvatar} isDefault={avatarIsDefault} onToggleDefault={toggleDefaultAvatar} />
            <VoicePicker query={voicesQ} value={voiceId} onChange={setVoiceId} isDefault={voiceIsDefault} onToggleDefault={toggleDefaultVoice} />
            <section>
              <label className="mb-2 block text-sm font-semibold">Сценарий</label>
              <Textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={6}
                placeholder="Вставьте текст, который проговорит аватар…"
                className="resize-y"
              />
              <p className="mt-1 text-xs text-muted-foreground">{script.trim().length} символов</p>
            </section>
          </TabsContent>

          {/* По шаблону */}
          <TabsContent value="template" className="mt-6 space-y-6 focus-visible:outline-none">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Шаблон — это ваш готовый дизайн монтажа из HeyGen (шрифты, бренд, моушен, звуки, музыка).
              Выберите его вручную или задайте «по умолчанию» — система будет применять его автоматически.
            </div>
            <section>
              <label className="mb-2 block text-sm font-semibold">Шаблон HeyGen</label>
              {templatesQ.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загружаем шаблоны…
                </div>
              ) : templatesQ.error ? (
                <p className="text-sm text-warning">Шаблоны недоступны: {(templatesQ.error as Error).message}</p>
              ) : (
                <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
                  {(templatesQ.data ?? []).map((t) => (
                    <button
                      key={t.template_id}
                      type="button"
                      onClick={() => setTemplateId(t.template_id)}
                      className={cn(
                        "overflow-hidden rounded-xl border border-border/60 bg-card/60 text-left transition hover:border-primary/40",
                        templateId === t.template_id && "border-primary ring-1 ring-primary/40",
                      )}
                    >
                      {t.thumbnail_image_url ? (
                        <img src={t.thumbnail_image_url} alt={t.name} className="aspect-video w-full object-cover" />
                      ) : (
                        <div className="grid aspect-video w-full place-items-center bg-secondary/50 text-muted-foreground">
                          <Film className="h-6 w-6" />
                        </div>
                      )}
                      <div className="truncate p-2 text-xs font-medium">{t.name}</div>
                    </button>
                  ))}
                  {(templatesQ.data ?? []).length === 0 && (
                    <p className="col-span-full text-sm text-muted-foreground">Шаблоны не найдены.</p>
                  )}
                </div>
              )}
              {selectedTemplate && (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{selectedTemplate.name}</span>
                  <DefaultStar on={templateIsDefault} onClick={toggleDefaultTemplate} />
                </div>
              )}
            </section>
          </TabsContent>

          {/* Готовые клипы */}
          <TabsContent value="clips" className="mt-6 space-y-6 focus-visible:outline-none">
            <AvatarPicker query={avatarsQ} selected={selectedAvatar} onSelect={setSelectedAvatar} isDefault={avatarIsDefault} onToggleDefault={toggleDefaultAvatar} />
            <VoicePicker query={voicesQ} value={voiceId} onChange={setVoiceId} isDefault={voiceIsDefault} onToggleDefault={toggleDefaultVoice} />

            <section>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-semibold">Клипы</label>
                <span className="text-xs text-muted-foreground">каждый клип — сцена, аватар проговаривает текст</span>
              </div>

              <input ref={fileInputRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />

              {clips.length === 0 ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-card/40 px-4 py-10 text-center transition hover:border-primary/50 hover:bg-card"
                >
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">Загрузить видео-клипы</span>
                  <span className="text-xs text-muted-foreground">MP4, MOV — можно несколько сразу</span>
                </button>
              ) : (
                <div className="space-y-3">
                  {clips.map((c, idx) => (
                    <div key={c.key} className="rounded-xl border border-border/60 bg-card/60 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-secondary text-xs font-bold">{idx + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                        {c.status === "uploading" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
                        {c.status === "error" && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
                        <button
                          type="button"
                          aria-label="Удалить клип"
                          onClick={() => setClips((prev) => prev.filter((x) => x.key !== c.key))}
                          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {c.status === "error" ? (
                        <p className="text-xs text-destructive">{c.error}</p>
                      ) : (
                        <Textarea
                          value={c.script}
                          onChange={(e) => setClips((prev) => prev.map((x) => (x.key === c.key ? { ...x, script: e.target.value } : x)))}
                          rows={2}
                          placeholder="Текст для этой сцены…"
                          className="resize-y text-sm"
                          disabled={c.status !== "ready"}
                        />
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                    <Plus className="h-4 w-4" /> Добавить клип
                  </Button>
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>

        {/* Формат — для ручных режимов; в «Быстро» его выбирает агент */}
        {mode !== "agent" && (
          <section className="mt-6">
            <label className="mb-2 block text-sm font-semibold">Формат</label>
            <AspectRatioPicker value={aspect} onChange={setAspect} allowed={ASPECTS} />
          </section>
        )}

        {/* Действие */}
        <div className="mt-8">
          <Button size="lg" className="w-full gap-2" disabled={submitting || rendering || !canSubmit} onClick={handleGenerate}>
            {submitting || rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busyLabel ?? "Собрать видео"}
          </Button>
          {rendering && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {agentActive
                ? "Video Agent собирает монтаж — обычно несколько минут, можно не закрывать вкладку."
                : "Рендер обычно занимает пару минут — можно не закрывать вкладку."}
            </p>
          )}
        </div>

        {/* Результат */}
        {resultUrl && (
          <section className="mt-8 rounded-2xl border border-border/60 bg-card/60 p-4">
            <h2 className="mb-3 text-sm font-semibold">Готово</h2>
            <video src={resultUrl} controls className="w-full rounded-xl" poster={resultThumb} />
            <a href={resultUrl} target="_blank" rel="noreferrer" download>
              <Button variant="secondary" className="mt-3 w-full gap-2">
                <Download className="h-4 w-4" /> Скачать MP4
              </Button>
            </a>
          </section>
        )}

        <HeygenUsagePanel projectId={projectId} />
        <TelegramConnect projectId={projectId} />
      </div>
    </main>
  );
};

export default CreateMontage;
