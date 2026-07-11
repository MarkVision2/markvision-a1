import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  AlertTriangle, Check, CheckCircle2, Clapperboard, Download, Film, Lock, Loader2, Pause, Play, Plus, Search,
  Sparkles, Star, Unlock, Upload, UserRound, Video, Volume2, X, Zap,
} from "lucide-react";
import Header from "@/components/factory/Header";
import { AspectRatioPicker } from "@/components/factory/AspectRatioPicker";
import { TelegramConnect } from "@/components/factory/TelegramConnect";
import { HeygenUsagePanel } from "@/components/factory/HeygenUsagePanel";
import { enqueueAgentJob, estimateCost, loadRecentVoices, pushRecentVoice, recordUsage } from "@/lib/heygenUsage";
import { HeygenGallery } from "@/components/factory/HeygenGallery";
import { loadHidden, toggleHidden } from "@/lib/heygenHidden";
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
  fetchAvatars, fetchTemplateDetail, fetchTemplates, fetchVideoStatus, fetchVoices,
  generateFromClips, generateTemplateVideo, generateVideoAgent, uploadClip,
  type HeygenAvatar, type HeygenTemplate, type HeygenVideoStatus, type HeygenVoice,
  type TemplateVariable,
} from "@/hooks/useHeygen";
import { assignAvatarToProject, fetchAllAvatarAssignments, unassignAvatar, type AvatarKind } from "@/lib/heygenAvatarAssignments";

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
type AvatarAssignState = "none" | "mine" | "other";

function AvatarCard({
  a, active, onSelect, manage, hidden, onToggleHide, assignState, onToggleAssign,
}: {
  a: HeygenAvatar;
  active: boolean;
  onSelect: () => void;
  manage?: boolean;
  hidden?: boolean;
  onToggleHide?: () => void;
  assignState?: AvatarAssignState;
  onToggleAssign?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/60 bg-card/60 text-left transition hover:border-primary/40",
        active && "border-primary ring-2 ring-primary/40",
        hidden && "opacity-50",
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button type="button" onClick={onSelect} disabled={manage} className="block w-full text-left">
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
          {active && !manage && (
            <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-3.5 w-3.5" />
            </span>
          )}
          {!manage && assignState === "mine" && (
            <span
              title="Закреплён только за этим проектом"
              className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary/90 text-primary-foreground"
            >
              <Lock className="h-3 w-3" />
            </span>
          )}
        </div>
        <div className="truncate p-2 text-xs font-medium">{a.name}</div>
      </button>
      {manage && onToggleHide && (
        <button
          type="button"
          onClick={onToggleHide}
          title={hidden ? "Вернуть в список" : "Скрыть из списка"}
          className={cn(
            "absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border text-white shadow",
            hidden ? "border-primary bg-primary/80" : "border-white/30 bg-black/60 hover:bg-destructive",
          )}
        >
          {hidden ? <Plus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </button>
      )}
      {manage && onToggleAssign && (
        <button
          type="button"
          onClick={onToggleAssign}
          title={
            assignState === "mine" ? "Открепить от этого проекта (снова станет общим)"
              : assignState === "other" ? "Закреплён за другим проектом — нажмите, чтобы перепривязать сюда"
                : "Закрепить только за этим проектом (скроется у остальных)"
          }
          className={cn(
            "absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border text-white shadow",
            assignState === "mine" ? "border-primary bg-primary/80"
              : assignState === "other" ? "border-warning/60 bg-warning/80"
                : "border-white/30 bg-black/60 hover:bg-primary",
          )}
        >
          {assignState === "mine" ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
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
  query, selected, onSelect, optional, isDefault, onToggleDefault, projectId, assignments,
}: {
  query: UseQueryResult<HeygenAvatar[]>;
  selected: HeygenAvatar | null;
  onSelect: (a: HeygenAvatar | null) => void;
  optional?: boolean;
  isDefault?: boolean;
  onToggleDefault?: () => void;
  projectId: string;
  // avatar_kind:avatar_id → project_id, по всем проектам, видимым пользователю.
  assignments: Map<string, string>;
}) {
  const queryClient = useQueryClient();
  const [manage, setManage] = useState(false);
  const [hidden, setHidden] = useState<string[]>(() => loadHidden("avatars", projectId));
  useEffect(() => { setHidden(loadHidden("avatars", projectId)); }, [projectId]);
  const hiddenSet = new Set(hidden);
  const toggleHide = (id: string) => setHidden(toggleHidden("avatars", projectId, id));

  const assignStateOf = (a: HeygenAvatar): AvatarAssignState => {
    const owner = assignments.get(`${a.kind}:${a.id}`);
    if (!owner) return "none";
    return owner === projectId ? "mine" : "other";
  };
  const invalidateAssignments = () => queryClient.invalidateQueries({ queryKey: ["project-avatar-assignments"] });
  const handleToggleAssign = async (a: HeygenAvatar) => {
    const state = assignStateOf(a);
    try {
      if (state === "mine") {
        await unassignAvatar(a.id, a.kind);
        toast.success("Аватар откреплён — снова общий для всех проектов");
      } else {
        if (state === "other" && !confirm("Этот аватар сейчас закреплён за другим проектом. Перепривязать его к текущему проекту?")) return;
        await assignAvatarToProject(projectId, a.id, a.kind as AvatarKind);
        toast.success("Аватар закреплён только за этим проектом");
      }
      invalidateAssignments();
    } catch (e) {
      toast.error((e as Error).message || "Не удалось изменить привязку аватара");
    }
  };

  const raw = query.data ?? [];
  // В обычном режиме скрытые и закреплённые за другим проектом не показываем;
  // в «Управлять» — показываем всё (там же можно перепривязать чужой аватар).
  const all = manage ? raw : raw.filter((a) => !hiddenSet.has(a.id) && assignStateOf(a) !== "other");
  const mine = all.filter((a) => a.mine);
  const heygenAvatars = all.filter((a) => !a.mine);
  const hiddenCount = raw.filter((a) => hiddenSet.has(a.id)).length;

  const card = (a: HeygenAvatar) => (
    <AvatarCard
      key={a.id}
      a={a}
      active={selected?.id === a.id}
      onSelect={() => onSelect(a)}
      manage={manage}
      hidden={hiddenSet.has(a.id)}
      onToggleHide={() => toggleHide(a.id)}
      assignState={assignStateOf(a)}
      onToggleAssign={() => void handleToggleAssign(a)}
    />
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold">
          Аватар {optional && <span className="text-xs font-normal text-muted-foreground">— необязательно</span>}
        </label>
        <div className="flex items-center gap-3">
          {selected && optional && !manage && (
            <button type="button" onClick={() => onSelect(null)} className="text-xs text-muted-foreground hover:text-foreground">
              Сбросить
            </button>
          )}
          {raw.length > 0 && (
            <button
              type="button"
              onClick={() => setManage((m) => !m)}
              className={cn("text-xs font-medium", manage ? "text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              {manage ? "Готово" : `Управлять${hiddenCount ? ` (${hiddenCount} скрыто)` : ""}`}
            </button>
          )}
        </div>
      </div>

      {manage && (
        <p className="rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          ✕ — скрыть аватар из списка, + — вернуть (из HeyGen ничего не удаляется).
          🔒 слева — закрепить аватар только за этим проектом (исчезнет у остальных); 🔓 — открепить обратно в общий список.
        </p>
      )}

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем аватаров…
        </div>
      ) : query.error ? (
        <p className="text-sm text-warning">Аватары недоступны: {(query.error as Error).message}</p>
      ) : (
        <>
          {selected && !manage && (
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
                {mine.map(card)}
              </div>
            </div>
          )}

          {heygenAvatars.length > 0 && (
            <div>
              {mine.length > 0 && (
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> Аватары HeyGen
                </div>
              )}
              <div className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
                {heygenAvatars.map(card)}
              </div>
            </div>
          )}

          {raw.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Свои аватары не найдены. Создайте аватар в HeyGen — он появится здесь.
            </p>
          )}
          {raw.length > 0 && all.length === 0 && !manage && (
            <p className="text-sm text-muted-foreground">
              Все аватары скрыты. Нажмите «Управлять», чтобы вернуть нужные.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ── Пикер голоса (недавние + свои + поиск, с прослушиванием) ────────────────
function VoicePicker({
  query, value, onChange, optional, isDefault, onToggleDefault, projectId,
}: {
  query: UseQueryResult<HeygenVoice[]>;
  value: string;
  onChange: (id: string) => void;
  optional?: boolean;
  isDefault?: boolean;
  onToggleDefault?: () => void;
  projectId: string;
}) {
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [hidden, setHidden] = useState<string[]>(() => loadHidden("voices", projectId));
  useEffect(() => { setHidden(loadHidden("voices", projectId)); }, [projectId]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const hiddenSet = new Set(hidden);
  const toggleHide = (id: string) => setHidden(toggleHidden("voices", projectId, id));
  const raw = query.data ?? [];
  const all = manage ? raw : raw.filter((v) => !hiddenSet.has(v.voice_id));
  const hiddenCount = raw.filter((v) => hiddenSet.has(v.voice_id)).length;
  const selectedVoice = raw.find((v) => v.voice_id === value) ?? null;
  const q = search.trim().toLowerCase();

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

  const select = (id: string) => {
    onChange(id);
    pushRecentVoice(projectId, id);
  };

  const row = (v: HeygenVoice) => {
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
          onClick={() => (manage ? toggleHide(v.voice_id) : select(v.voice_id))}
          className={cn("min-w-0 flex-1 text-left text-sm", manage && hiddenSet.has(v.voice_id) && "opacity-50")}
        >
          <span className="truncate font-medium">{v.name}</span>
          <span className="ml-1 text-xs text-muted-foreground">
            {v.language ?? ""}{v.language && v.gender ? " · " : ""}{v.gender ?? ""}
          </span>
        </button>
        {manage ? (
          <button
            type="button"
            onClick={() => toggleHide(v.voice_id)}
            title={hiddenSet.has(v.voice_id) ? "Вернуть" : "Скрыть"}
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full border",
              hiddenSet.has(v.voice_id) ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:border-destructive hover:text-destructive",
            )}
          >
            {hiddenSet.has(v.voice_id) ? <Plus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          </button>
        ) : (
          active && <Check className="h-4 w-4 shrink-0 text-primary" />
        )}
      </div>
    );
  };

  // Группы для удобного выбора: недавние → мои → остальные (или результаты поиска).
  const recentIds = loadRecentVoices(projectId);
  const recent = recentIds.map((id) => all.find((v) => v.voice_id === id)).filter(Boolean) as HeygenVoice[];
  const mine = all.filter((v) => v.mine);
  const usedIds = new Set<string>([...recent.map((v) => v.voice_id), ...mine.map((v) => v.voice_id)]);
  const rest = all.filter((v) => !usedIds.has(v.voice_id));
  const filtered = q
    ? all.filter((v) => `${v.name} ${v.language ?? ""} ${v.gender ?? ""}`.toLowerCase().includes(q)).slice(0, 80)
    : [];

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold">
          Голос {optional && <span className="text-xs font-normal text-muted-foreground">— необязательно</span>}
        </label>
        {raw.length > 0 && (
          <button
            type="button"
            onClick={() => setManage((m) => !m)}
            className={cn("text-xs font-medium", manage ? "text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {manage ? "Готово" : `Управлять${hiddenCount ? ` (${hiddenCount} скрыто)` : ""}`}
          </button>
        )}
      </div>

      {manage && (
        <p className="rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          Нажмите ✕, чтобы скрыть голос из списка, или +, чтобы вернуть. Из HeyGen ничего не удаляется.
        </p>
      )}

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
              placeholder="Поиск по всем голосам: имя, язык, пол…"
              className="pl-9"
            />
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {q ? (
              <>
                {filtered.map(row)}
                {filtered.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">Ничего не найдено.</p>}
              </>
            ) : (
              <>
                {recent.length > 0 && (
                  <>
                    <div className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Недавние</div>
                    {recent.map(row)}
                  </>
                )}
                {mine.length > 0 && (
                  <>
                    <div className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-primary">Мои голоса</div>
                    {mine.map(row)}
                  </>
                )}
                {rest.length > 0 && (
                  <>
                    <div className="px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Все голоса
                    </div>
                    {rest.slice(0, 40).map(row)}
                    {rest.length > 40 && (
                      <p className="px-2 py-2 text-xs text-muted-foreground">
                        …ещё {rest.length - 40}. Найдите нужный через поиск выше.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
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

// Payload переменных шаблона для HeyGen: только заполненные поля.
// text → properties.content; медиа (image/video/audio) → properties.url.
function buildTemplateVariables(
  defs: TemplateVariable[],
  values: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const val = (values[d.name] ?? "").trim();
    if (!val) continue;
    out[d.name] = {
      name: d.name,
      type: d.type,
      properties: d.type === "text" ? { content: val } : { url: val },
    };
  }
  return out;
}

// Человекочитаемая подпись типа поля шаблона.
const VAR_TYPE_LABEL: Record<string, string> = {
  text: "текст",
  image: "картинка (URL)",
  video: "видео (URL)",
  audio: "аудио (URL)",
};

const CreateMontage = () => {
  const navigate = useNavigate();
  const { activeId: projectId } = useProjectsStore();
  const [mode, setMode] = useState<"agent" | "template" | "clips" | "gallery">("agent");
  const [aspect, setAspect] = useState<AspectId>("9:16");

  const [agentPrompt, setAgentPrompt] = useState("");
  const [montageBrief, setMontageBrief] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<HeygenAvatar | null>(null);
  const [voiceId, setVoiceId] = useState("");
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
  const [submitting, setSubmitting] = useState(false);
  // Быстрое создание (agent) — fire-and-forget: доставку и учёт полностью
  // ведёт серверный воркер (heygen_jobs), эта страница не поллит статус и
  // не ждёт результат. agentSubmitted просто держит подтверждение на экране,
  // пока не начнут печатать новый бриф.
  const [agentSubmitted, setAgentSubmitted] = useState(false);

  // Каталог аватаров/голосов нужен всем режимам кроме «шаблона».
  const needsCatalog = mode !== "template";
  const avatarsQ = useQuery({ queryKey: ["heygen-avatars"], queryFn: fetchAvatars, staleTime: 300_000, enabled: needsCatalog });
  // Эксклюзивные привязки аватар→проект (project_avatars) — общие для всех
  // проектов, видимых пользователю, не зависят от активного projectId.
  const avatarAssignmentsQ = useQuery({
    queryKey: ["project-avatar-assignments"],
    queryFn: fetchAllAvatarAssignments,
    staleTime: 60_000,
    enabled: needsCatalog,
  });
  const voicesQ = useQuery({ queryKey: ["heygen-voices"], queryFn: fetchVoices, staleTime: 300_000, enabled: needsCatalog });
  const templatesQ = useQuery({
    queryKey: ["heygen-templates"], queryFn: fetchTemplates, staleTime: 300_000, enabled: mode === "template",
  });
  // Поля выбранного шаблона + значения, которые вводит пользователь.
  const templateDetailQ = useQuery({
    queryKey: ["heygen-template-detail", templateId],
    queryFn: () => fetchTemplateDetail(templateId),
    enabled: mode === "template" && !!templateId,
    staleTime: 300_000,
  });
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  // Сбрасываем введённые значения при смене шаблона.
  useEffect(() => { setTemplateVars({}); }, [templateId]);

  const statusQ = useQuery<HeygenVideoStatus>({
    queryKey: ["heygen-status", videoId],
    queryFn: () => fetchVideoStatus(videoId as string),
    enabled: !!videoId,
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : 8_000),
  });

  const loadError = avatarsQ.error || voicesQ.error;

  useEffect(() => {
    if (statusQ.data?.status === "failed") toast.error("HeyGen: рендер не удался");
  }, [statusQ.data?.status]);

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

  // HeyGen Video Agent ограничивает prompt 10 000 символами; наши фиксированные
  // директивы (язык/субтитры/формат) добавляют ~450 — оставляем запас, чтобы
  // не упереться в 400 от HeyGen на длинной раскадровке (ТЗ + сценарий).
  const MAX_AGENT_INPUT_CHARS = 9000;
  const agentInputLength = agentPrompt.trim().length + montageBrief.trim().length;
  const agentInputTooLong = agentInputLength > MAX_AGENT_INPUT_CHARS;
  const canSubmitAgent = agentPrompt.trim().length > 0 && !agentInputTooLong;
  const canSubmitTemplate = !!templateId;
  const canSubmitClips =
    !!avatarRef && !!voiceId && clips.length > 0 &&
    clips.every((c) => c.status === "ready" && c.script.trim().length > 0);

  const canSubmit =
    mode === "agent" ? canSubmitAgent
      : mode === "template" ? canSubmitTemplate
        : canSubmitClips;

  const handleGenerate = async () => {
    const dim = DIMENSIONS[aspect];
    setSubmitting(true);
    setVideoId(null);
    try {
      if (mode === "agent") {
        const sid = await generateVideoAgent({
          prompt: agentPrompt.trim(),
          avatar: avatarRef ?? undefined,
          voiceId: voiceId || undefined,
          aspect,
          montageBrief: montageBrief.trim() || undefined,
        });
        // Fire-and-forget: HeyGen-сессия статуса session-level ненадёжна
        // (бывает «failed», пока видео ещё рендерится, и только видео-статус
        // авторитетен) — раньше это давало бесконечный «идёт монтаж» на
        // экране даже спустя час. Доставку и учёт полностью ведёт серверный
        // воркер (heygen_jobs), эта страница просто подтверждает отправку.
        void enqueueAgentJob(projectId, sid, agentPrompt.trim(), aspect);
        setAgentPrompt("");
        setMontageBrief("");
        setAgentSubmitted(true);
        toast.success("ТЗ отправлено в HeyGen. Готовое видео появится во вкладке «Готовые».");
      } else if (mode === "template") {
        setVideoId(await generateTemplateVideo({
          templateId, width: dim.width, height: dim.height,
          variables: buildTemplateVariables(templateDetailQ.data ?? [], templateVars),
        }));
        toast.success("Запущено — собираем видео");
      } else {
        setVideoId(await generateFromClips({
          avatar: avatarRef!, voiceId,
          scenes: clips.map((c) => ({ clipUrl: c.url as string, script: c.script.trim() })),
          width: dim.width, height: dim.height,
        }));
        toast.success("Запущено — собираем видео");
      }
    } catch (e) {
      toast.error((e as Error).message || "Не удалось запустить генерацию");
    } finally {
      setSubmitting(false);
    }
  };

  // Быстрое создание (agent) больше не участвует в этом состоянии — оно
  // fire-and-forget (см. handleGenerate). resultUrl/rendering здесь — только
  // для «Шаблон»/«Из клипов», у которых нет серверного воркера-доставщика
  // и статус-эндпоинт (fetchVideoStatus, /v2/video) действительно надёжен.
  const v2Active = !!videoId;
  const v2Done = statusQ.data?.status === "completed" && !!statusQ.data?.video_url;

  const rendering = v2Active && !isTerminal(statusQ.data?.status);

  const resultUrl = v2Done ? statusQ.data?.video_url : undefined;
  const resultThumb = statusQ.data?.thumbnail_url;

  // Учёт расхода при завершении рендера (один раз на задачу).
  const recordedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!resultUrl || !projectId) return;
    const ref = videoId;
    if (!ref || recordedRef.current === ref) return;
    recordedRef.current = ref;
    const durationSec = statusQ.data?.duration_sec;
    void recordUsage(projectId, {
      source: "web",
      mode,
      ref_id: ref,
      duration_sec: durationSec ?? null,
      cost_usd: estimateCost(mode, durationSec),
      title: (mode === "template" ? selectedTemplate?.name : undefined)?.slice(0, 80) || "Видео",
      video_url: resultUrl,
      thumbnail_url: resultThumb ?? null,
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
            <TabsTrigger value="template" className="gap-1 rounded-xl px-1 text-[11px] sm:gap-1.5 sm:text-sm">
              <Film className="h-4 w-4 shrink-0" /> Шаблон
            </TabsTrigger>
            <TabsTrigger value="clips" className="gap-1 rounded-xl px-1 text-[11px] sm:gap-1.5 sm:text-sm">
              <Video className="h-4 w-4 shrink-0" /> Из клипов
            </TabsTrigger>
            <TabsTrigger value="gallery" className="gap-1 rounded-xl px-1 text-[11px] sm:gap-1.5 sm:text-sm">
              <Play className="h-4 w-4 shrink-0" /> Готовые
            </TabsTrigger>
          </TabsList>

          {/* Быстрое создание (Video Agent) */}
          <TabsContent value="agent" className="mt-6 space-y-6 focus-visible:outline-none">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Вставьте текст или бриф — HeyGen сам соберёт сцены, б-ролл, субтитры и смонтирует видео.
              «ТЗ на монтаж» ниже — по желанию: опишите тему/стиль/вставки, если хотите не дефолтный монтаж, а под конкретную тематику.
              Аватар и голос ниже — по желанию: не выберете, агент подберёт сам.
            </div>

            {agentSubmitted && (
              <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div>
                  <p className="font-medium">Видео успешно отправлено на монтаж</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Ожидайте готовый ролик — обычно занимает несколько минут. Появится во вкладке «Готовые».
                  </p>
                </div>
              </div>
            )}

            <section>
              <label className="mb-2 block text-sm font-semibold">
                ТЗ на монтаж <span className="text-xs font-normal text-muted-foreground">— необязательно</span>
              </label>
              <Textarea
                value={montageBrief}
                onChange={(e) => { setMontageBrief(e.target.value); setAgentSubmitted(false); }}
                rows={3}
                placeholder="Напр.: футбольная тематика — набор учеников на футбол, вставки с тренировками и матчами, динамичный монтаж в стиле спортивных роликов…"
                className="resize-y"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Опишите тему/стиль/вставки для монтажа. Пусто — используется монтаж по умолчанию (как сейчас); если заполнено — это ТЗ в приоритете.
                Поддерживается развёрнутая раскадровка markdown (кадры, тайминги, реплики, b-roll, эффекты) — можно вставлять целиком.
              </p>
            </section>
            <section>
              <label className="mb-2 block text-sm font-semibold">Текст / сценарий</label>
              <Textarea
                value={agentPrompt}
                onChange={(e) => { setAgentPrompt(e.target.value); setAgentSubmitted(false); }}
                rows={7}
                placeholder="Напр.: Сделай ролик на 45 секунд о запуске нашего продукта, дружелюбный тон, вертикальный формат для Reels…"
                className="resize-y"
              />
              <p className={cn("mt-1 text-xs", agentInputTooLong ? "font-medium text-destructive" : "text-muted-foreground")}>
                Сценарий + ТЗ на монтаж: {agentInputLength} / {MAX_AGENT_INPUT_CHARS} символов
                {agentInputTooLong && " — слишком длинно, HeyGen отклонит запрос. Сократите текст."}
              </p>
            </section>
            <AvatarPicker query={avatarsQ} selected={selectedAvatar} onSelect={setSelectedAvatar} optional isDefault={avatarIsDefault} onToggleDefault={toggleDefaultAvatar} projectId={projectId} assignments={avatarAssignmentsQ.data ?? new Map()} />
            <VoicePicker query={voicesQ} value={voiceId} onChange={setVoiceId} optional isDefault={voiceIsDefault} onToggleDefault={toggleDefaultVoice} projectId={projectId} />
          </TabsContent>

          {/* По шаблону */}
          <TabsContent value="template" className="mt-6 space-y-6 focus-visible:outline-none">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Шаблон — это ваш готовый дизайн монтажа из HeyGen (шрифты, бренд, моушен, звуки, музыка).
              Выберите его, заполните поля ниже и соберите видео; можно задать «по умолчанию» (★) — тогда система применит его автоматически.{" "}
              Сами шаблоны создаются в редакторе HeyGen —{" "}
              <a href="https://app.heygen.com/templates" target="_blank" rel="noreferrer" className="font-medium text-primary underline">открыть шаблоны HeyGen</a>,
              после сохранения они появятся в этом списке.
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

            {/* Поля шаблона — заполняются перед сборкой. */}
            {templateId && (
              <section>
                <label className="mb-2 block text-sm font-semibold">Поля шаблона</label>
                {templateDetailQ.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Загружаем поля шаблона…
                  </div>
                ) : templateDetailQ.error ? (
                  <p className="text-sm text-warning">Не удалось загрузить поля: {(templateDetailQ.error as Error).message}</p>
                ) : (templateDetailQ.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">У этого шаблона нет полей для заполнения — соберётся с исходным содержимым.</p>
                ) : (
                  <div className="space-y-3">
                    {(templateDetailQ.data ?? []).map((v: TemplateVariable) => (
                      <div key={v.name}>
                        <label className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <span className="truncate">{v.name}</span>
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{VAR_TYPE_LABEL[v.type] ?? v.type}</span>
                        </label>
                        {v.type === "text" ? (
                          <Textarea
                            value={templateVars[v.name] ?? ""}
                            onChange={(e) => setTemplateVars((p) => ({ ...p, [v.name]: e.target.value }))}
                            rows={2}
                            placeholder={`Текст для «${v.name}»…`}
                            className="resize-y text-sm"
                          />
                        ) : (
                          <Input
                            value={templateVars[v.name] ?? ""}
                            onChange={(e) => setTemplateVars((p) => ({ ...p, [v.name]: e.target.value }))}
                            placeholder={`Ссылка на ${VAR_TYPE_LABEL[v.type] ?? v.type}…`}
                          />
                        )}
                      </div>
                    ))}
                    <p className="text-[11px] text-muted-foreground">
                      Пустые поля останутся как в шаблоне. Для медиа вставьте прямую ссылку (URL).
                    </p>
                  </div>
                )}
              </section>
            )}
          </TabsContent>

          {/* Готовые клипы */}
          <TabsContent value="clips" className="mt-6 space-y-6 focus-visible:outline-none">
            <AvatarPicker query={avatarsQ} selected={selectedAvatar} onSelect={setSelectedAvatar} isDefault={avatarIsDefault} onToggleDefault={toggleDefaultAvatar} projectId={projectId} assignments={avatarAssignmentsQ.data ?? new Map()} />
            <VoicePicker query={voicesQ} value={voiceId} onChange={setVoiceId} isDefault={voiceIsDefault} onToggleDefault={toggleDefaultVoice} projectId={projectId} />

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

          {/* Готовый контент — собранные видео проекта */}
          <TabsContent value="gallery" className="mt-6 focus-visible:outline-none">
            <HeygenGallery projectId={projectId} />
          </TabsContent>
        </Tabs>

        {/* Блок создания скрыт на вкладке «Готовые» */}
        {mode !== "gallery" && (
        <>
        {/* Формат — для всех режимов создания. В «Быстро» передаём агенту как
            пожелание к раскладке (9:16 / 16:9). */}
        <section className="mt-6">
          <label className="mb-2 block text-sm font-semibold">Формат</label>
          <AspectRatioPicker value={aspect} onChange={setAspect} allowed={ASPECTS} />
        </section>

        {/* Действие */}
        <div className="mt-8">
          <Button size="lg" className="w-full gap-2" disabled={submitting || rendering || !canSubmit} onClick={handleGenerate}>
            {submitting || rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busyLabel ?? "Собрать видео"}
          </Button>
          {rendering && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Рендер обычно занимает пару минут — можно не закрывать вкладку.
            </p>
          )}
        </div>

        {/* Результат (Шаблон / Из клипов — «Быстро» отправляется fire-and-forget, см. выше) */}
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
        </>
        )}

        <HeygenUsagePanel projectId={projectId} />
        <TelegramConnect projectId={projectId} />
      </div>
    </main>
  );
};

export default CreateMontage;
