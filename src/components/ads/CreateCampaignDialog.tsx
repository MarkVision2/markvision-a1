import { useEffect, useRef, useState } from "react";
import {
  Rocket,
  Upload,
  CheckCircle2,
  FileText,
  Globe,
  MessageCircle,
  Images,
  LayoutTemplate,
  Plus,
  X,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mobileDialogFooterPad } from "@/lib/dialogClasses";
import { clientSupabasePublishableKey, clientSupabaseUrl } from "@/lib/supabaseConfig";
import { DEFAULT_META_UTM_TEMPLATE } from "@/lib/utmDefaults";
import type { AdCabinet } from "@/types/ads";
import { supabase } from "@/integrations/supabase/client";
import { probeLaunchRow, waitForLaunchRow } from "@/lib/adLaunch";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useMetaPageAssets, type IgMediaItem } from "@/hooks/useMetaPageAssets";
import GoalAssetsPicker from "./GoalAssetsPicker";
import { cropImageFile, computeSourceRect, type Fit } from "@/lib/cropMedia";

/** Быстро узнаём натуральный размер видео из <video preload="metadata">. */
function readVideoNaturalSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      const size = { w: v.videoWidth, h: v.videoHeight };
      URL.revokeObjectURL(url);
      resolve(size);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать видео"));
    };
    v.src = url;
  });
}

/**
 * View-state, который ребёнок-CreativeUpload отдаёт наверх при каждом изменении.
 * Нужен, чтобы при сабмите «запечь» точно то, что видит пользователь.
 */
export interface CreativeViewState {
  ratio: "4:5" | "9:16";
  fit: Fit;
  zoom: number;
  pos: { x: number; y: number };
  /** Размер фрейма превью в css-пикселях. */
  frame: { w: number; h: number };
}

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cabinets: AdCabinet[];
}

type Goal = "whatsapp" | "site-leads" | "meta-form";

/** Ответ launch-campaign: запуск идёт напрямую в Meta и возвращает готовые id. */
interface LaunchResponse {
  ok?: boolean;
  accepted?: boolean;
  /** Кампания уже создана в кабинете. */
  launched?: boolean;
  /** Ещё в работе — статус догонит по launchId. */
  pending?: boolean;
  error?: string;
  launchId?: string;
  metaCampaignId?: string | null;
  metaAdsetId?: string | null;
  metaAdId?: string | null;
  adAccountId?: string | null;
}
type CreativeFormat = "single" | "carousel";
/** Как в Meta Ads Manager: создать креатив или взять существующую публикацию IG. */
type AdSetupMode = "create" | "existing";

const CAROUSEL_MIN = 2;
const CAROUSEL_MAX = 10;

const GOALS: { id: Goal; label: string; hint: string; icon: typeof MessageCircle }[] = [
  { id: "whatsapp", label: "WhatsApp", hint: "Переписки", icon: MessageCircle },
  { id: "site-leads", label: "Сайт", hint: "Лиды с лендинга", icon: Globe },
  { id: "meta-form", label: "Форма Meta", hint: "Lead Ads", icon: FileText },
];

/** Дефолтный кадр 4:5 для слайдов карусели (cover по центру). */
const DEFAULT_CAROUSEL_VIEW: CreativeViewState = {
  ratio: "4:5",
  fit: "cover",
  zoom: 1,
  pos: { x: 0, y: 0 },
  frame: { w: 400, h: 500 },
};

const CreativeUpload = ({
  label,
  ratio,
  file,
  onFile,
  onView,
}: {
  label: string;
  ratio: "4:5" | "9:16";
  file: File | null;
  onFile: (f: File | null) => void;
  onView?: (s: CreativeViewState) => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const storageKey = file
    ? `creative-view:${ratio}:${file.name}:${file.size}:${file.lastModified}`
    : null;

  // Load file-bound view state (fit/zoom/pos) when file changes
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    let restored = false;
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const s = JSON.parse(raw) as {
            fit?: "contain" | "cover";
            zoom?: number;
            pos?: { x: number; y: number };
          };
          if (s.fit === "contain" || s.fit === "cover") setFit(s.fit);
          if (typeof s.zoom === "number") setZoom(s.zoom);
          if (s.pos && typeof s.pos.x === "number") setPos(s.pos);
          restored = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (!restored) {
      setFit("contain");
      setZoom(1);
      setPos({ x: 0, y: 0 });
    }
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Persist on change
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ fit, zoom, pos }));
    } catch {
      /* ignore quota */
    }
  }, [storageKey, fit, zoom, pos]);

  // Меряем фрейм превью — нужно, чтобы пересчитать pos/zoom в координаты исходника.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setFrameSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewUrl]);

  // Прокидываем view-state наверх на каждое изменение.
  useEffect(() => {
    if (!onView) return;
    onView({ ratio, fit, zoom, pos, frame: frameSize });
  }, [ratio, fit, zoom, pos, frameSize, onView]);

  const isVideo = file?.type.startsWith("video/");
  const isImage = file?.type.startsWith("image/");
  const aspectClass = ratio === "9:16" ? "aspect-[9/16]" : "aspect-[4/5]";
  const canDrag = !!previewUrl && (fit === "cover" || zoom > 1);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canDrag) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({
      x: dragRef.current.px + (e.clientX - dragRef.current.sx),
      y: dragRef.current.py + (e.clientY - dragRef.current.sy),
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const checker =
    "bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(-45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(45deg,transparent_75%,hsl(var(--muted))_75%),linear-gradient(-45deg,transparent_75%,hsl(var(--muted))_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]";

  const mediaStyle: React.CSSProperties = {
    transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
    transformOrigin: "center center",
    transition: dragRef.current ? "none" : "transform 0.05s linear",
  };
  const mediaClass = `absolute inset-0 h-full w-full ${
    fit === "cover" ? "object-cover" : "object-contain"
  } select-none pointer-events-none`;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {previewUrl && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFit(fit === "contain" ? "cover" : "contain")}
              className="rounded-md border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {fit === "contain" ? "Fit" : "Fill"}
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPos({ x: 0, y: 0 });
              }}
              className="rounded-md border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>
        )}
      </div>
      <div
        ref={frameRef}
        className={`relative w-full overflow-hidden rounded-2xl border-2 border-dashed border-border/70 ${aspectClass} ${
          previewUrl ? checker : "bg-background/40"
        }`}
      >
        {previewUrl && isImage && (
          <div
            className={`absolute inset-0 ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              src={previewUrl}
              alt={file?.name ?? "preview"}
              className={mediaClass}
              style={mediaStyle}
              draggable={false}
            />
          </div>
        )}
        {previewUrl && isVideo && (
          <div
            className={`absolute inset-0 ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <video
              src={previewUrl}
              className={mediaClass}
              style={mediaStyle}
              muted
              playsInline
              loop
              autoPlay
            />
          </div>
        )}
        {!previewUrl && (
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Upload className="h-5 w-5" />
            <span className="text-sm">Загрузить {ratio}</span>
          </button>
        )}
        {file && (
          <>
            <button
              type="button"
              onClick={() => ref.current?.click()}
              className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-1 text-xs text-foreground shadow hover:bg-background"
            >
              Заменить
            </button>
            <button
              type="button"
              onClick={() => onFile(null)}
              className="absolute right-2 top-2 rounded-full bg-background/80 px-2 py-1 text-xs text-foreground shadow hover:bg-background"
            >
              ✕
            </button>
          </>
        )}
      </div>
      {previewUrl && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Zoom
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-1 flex-1 accent-success"
          />
          <span className="w-8 text-right text-[10px] text-muted-foreground">
            {zoom.toFixed(2)}x
          </span>
        </div>
      )}
      {file && (
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {file.name}
        </div>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
};

/** Мультизагрузка слайдов карусели (2–10 фото · 4:5). */
const CarouselUpload = ({
  files,
  onChange,
}: {
  files: File[];
  onChange: (next: File[]) => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      toast.error("Для карусели нужны изображения (не видео)");
      return;
    }
    const merged = [...files, ...images].slice(0, CAROUSEL_MAX);
    if (files.length + images.length > CAROUSEL_MAX) {
      toast.message(`Максимум ${CAROUSEL_MAX} слайдов — лишние отброшены`);
    }
    onChange(merged);
  };

  const removeAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Карусель · 4:5
        </div>
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {files.length}/{CAROUSEL_MAX}
          {files.length > 0 && files.length < CAROUSEL_MIN
            ? ` · ещё мин. ${CAROUSEL_MIN - files.length}`
            : ""}
        </div>
      </div>

      {files.length === 0 ? (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/70 bg-background/40 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Images className="h-5 w-5" />
          <span className="text-sm">Загрузить слайды</span>
          <span className="text-[11px] text-muted-foreground">
            2–{CAROUSEL_MAX} фото · можно сразу несколько
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${f.size}-${f.lastModified}-${i}`}
              className="relative aspect-[4/5] overflow-hidden rounded-xl border border-border/60 bg-background/40"
            >
              {urls[i] && (
                <img
                  src={urls[i]}
                  alt={f.name}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              )}
              <span className="absolute left-1.5 top-1.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-background/85 text-foreground shadow hover:bg-background"
                aria-label="Удалить слайд"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {files.length < CAROUSEL_MAX && (
            <button
              type="button"
              onClick={() => ref.current?.click()}
              className="flex aspect-[4/5] flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border/70 bg-background/30 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              <span className="text-[11px]">Ещё</span>
            </button>
          )}
        </div>
      )}

      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
};

/** Выбор существующей публикации Instagram для продвижения (source_instagram_media_id). */
const ExistingPostPicker = ({
  items,
  isLoading,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: {
  items: IgMediaItem[];
  isLoading: boolean;
  error: string | null;
  selectedId: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Публикации Instagram
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
        Обновить
      </button>
    </div>

    {error && (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        {error}
      </div>
    )}

    {!error && isLoading && items.length === 0 && (
      <div className="rounded-xl border border-border/50 bg-background/40 p-6 text-center text-xs text-muted-foreground">
        Загружаем публикации…
      </div>
    )}

    {!error && !isLoading && items.length === 0 && (
      <div className="rounded-xl border border-border/50 bg-background/40 p-6 text-center text-xs text-muted-foreground">
        Нет публикаций у этой страницы Instagram. Опубликуйте пост в IG или проверьте привязку Page ↔ Instagram.
      </div>
    )}

    {items.length > 0 && (
      <div className="grid max-h-[40vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:max-h-[52vh] sm:grid-cols-2">
        {items.map((m) => {
          const active = selectedId === m.id;
          const thumb = m.thumbnail_url || m.media_url;
          const label =
            m.media_product_type === "REELS"
              ? "Reels"
              : m.media_type === "CAROUSEL_ALBUM"
                ? "Карусель"
                : m.media_type === "VIDEO"
                  ? "Видео"
                  : "Фото";
          return (
            <button
              key={m.id}
              type="button"
              disabled={!m.eligible_to_boost}
              onClick={() => onSelect(m.id)}
              className={cn(
                "group relative overflow-hidden rounded-xl border text-left transition",
                active
                  ? "border-success ring-2 ring-success/40"
                  : m.eligible_to_boost
                    ? "border-border/60 hover:border-success/50"
                    : "cursor-not-allowed border-border/40 opacity-50",
              )}
              title={m.eligible_to_boost ? undefined : (m.boost_reason || "Нельзя продвигать")}
            >
              <div className="aspect-square bg-background/60">
                {thumb ? (
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-[10px] text-muted-foreground">
                    нет превью
                  </div>
                )}
              </div>
              <div className="space-y-0.5 p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {label}
                  </span>
                  {active && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                </div>
                <div className="line-clamp-2 text-[11px] text-foreground/90">
                  {m.caption?.trim() || "Без подписи"}
                </div>
                {!m.eligible_to_boost && (
                  <div className="text-[10px] text-destructive">
                    {m.boost_reason || "Нельзя продвигать"}
                  </div>
                )}
              </div>
              {m.permalink && (
                <a
                  href={m.permalink}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-background/85 text-foreground opacity-0 shadow transition group-hover:opacity-100"
                  aria-label="Открыть в Instagram"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </button>
          );
        })}
      </div>
    )}
  </div>
);

/** Знаки валют, в которых реально ведут кабинеты. Остальные показываем кодом. */
const CURRENCY_SIGNS: Record<string, string> = {
  USD: "$", EUR: "€", KZT: "₸", RUB: "₽", UAH: "₴", GBP: "£",
  UZS: "so'm", KGS: "с", AZN: "₼", TRY: "₺", PLN: "zł",
};

const CreateCampaignDialog = ({
  open,
  onOpenChange,
  cabinets,
}: CreateCampaignDialogProps) => {
  const { activeId: projectId, active: activeProject } = useProjectsStore();
  const [cabinetId, setCabinetId] = useState<string>(cabinets[0]?.id ?? "");
  const [goal, setGoal] = useState<Goal>("whatsapp");
  const [budget, setBudget] = useState("50");
  const [adSetupMode, setAdSetupMode] = useState<AdSetupMode>("create");
  const [creativeFormat, setCreativeFormat] = useState<CreativeFormat>("single");
  const [feed, setFeed] = useState<File | null>(null);
  const [stories, setStories] = useState<File | null>(null);
  const [carouselFiles, setCarouselFiles] = useState<File[]>([]);
  const [existingMediaId, setExistingMediaId] = useState("");
  // View-state каждого превью — обновляется коллбеком onView.
  const feedViewRef = useRef<CreativeViewState | null>(null);
  const storiesViewRef = useRef<CreativeViewState | null>(null);
  const [bakeStatus, setBakeStatus] = useState<string | null>(null);
  const [bakePct, setBakePct] = useState<number>(0);
  const [text, setText] = useState("");
  const [whatsappId, setWhatsappId] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [pixelEvent, setPixelEvent] = useState("Lead");
  const [leadFormId, setLeadFormId] = useState("");
  const [pageId, setPageId] = useState<string>("");
  const [websiteUrl, setWebsiteUrl] = useState<string>("");

  const selectedCabinet = cabinets.find((c) => c.id === cabinetId);

  // Подгружаем список FB-страниц для выбранного рекламного кабинета —
  // менеджер может запустить рекламу от любой доступной странице, а не
  // только от той, что прописана в настройках клиента.
  const pagesAssets = useMetaPageAssets({
    kind: "pages",
    actId: selectedCabinet?.adAccountId,
    enabled: !!selectedCabinet?.adAccountId,
  });

  // Валюта кабинета. Meta принимает дневной бюджет в её минорных единицах,
  // поэтому сумму менеджер вводит в валюте счёта, а не в предполагаемых долларах.
  const accountAssets = useMetaPageAssets({
    kind: "ad_account",
    actId: selectedCabinet?.adAccountId,
    enabled: !!selectedCabinet?.adAccountId,
  });
  const account = accountAssets.data[0];
  const currencyCode = account?.currency ?? selectedCabinet?.currency ?? "USD";
  const currencySign = CURRENCY_SIGNS[currencyCode] ?? currencyCode;
  const minDailyBudget = account?.min_daily_budget ?? null;

  // При смене кабинета сбрасываем выбранную страницу на дефолтную из настроек кабинета.
  useEffect(() => {
    setPageId(selectedCabinet?.pageId ?? "");
    setWebsiteUrl(selectedCabinet?.websiteUrl ?? "");
    setExistingMediaId("");
    setWhatsappId("");
  }, [cabinetId, selectedCabinet?.pageId, selectedCabinet?.websiteUrl]);

  // Если в списке доступных страниц нет текущей — но дефолт из настроек уже задан,
  // оставляем; иначе автоматически выбираем первую из списка.
  useEffect(() => {
    if (pageId) return;
    if (pagesAssets.data.length > 0) setPageId(pagesAssets.data[0].id);
  }, [pagesAssets.data, pageId]);

  // «Эффективная» страница — то, что реально уйдёт в запуск.
  const effectivePageId = pageId || selectedCabinet?.pageId || "";
  const effectivePageName =
    pagesAssets.data.find((p) => p.id === effectivePageId)?.name ??
    selectedCabinet?.pageName ?? "";
  const effectivePageMeta = pagesAssets.data.find((p) => p.id === effectivePageId);
  const effectiveIgUserId =
    effectivePageMeta?.instagram_id ||
    selectedCabinet?.instagramId ||
    "";

  // Сброс выбранной публикации при смене страницы / режима.
  useEffect(() => {
    setExistingMediaId("");
  }, [effectivePageId, adSetupMode]);

  // Organic IG posts for "use existing publication" (Meta: source_instagram_media_id).
  const igMedia = useMetaPageAssets({
    kind: "ig_media",
    actId: selectedCabinet?.adAccountId,
    pageId: effectivePageId || undefined,
    igUserId: effectiveIgUserId || undefined,
    enabled: adSetupMode === "existing" && !!effectivePageId,
  });

  const selectedExistingPost = igMedia.data.find((m) => m.id === existingMediaId);

  // Что реально подтянулось под выбранный кабинет — менеджер видит это сразу,
  // не открывая настройки и не гадая, с какой страницы уйдёт реклама.
  const readinessRows: { label: string; value: string; ok: boolean }[] = [];
  if (selectedCabinet) {
    readinessRows.push({
      label: "Рекламный аккаунт",
      value: selectedCabinet.adAccountId || "не заполнен",
      ok: !!selectedCabinet.adAccountId,
    });
    readinessRows.push({
      label: "Страница",
      value: pagesAssets.isLoading
        ? "загрузка…"
        : effectivePageName || effectivePageId || "не выбрана",
      ok: !!effectivePageId,
    });
    readinessRows.push({
      label: "Instagram",
      value: effectiveIgUserId ? "привязан" : "нет",
      ok: !!effectiveIgUserId,
    });
    readinessRows.push({
      label: "Валюта",
      value: accountAssets.isLoading ? "загрузка…" : currencyCode,
      ok: !accountAssets.error,
    });
    if (goal === "whatsapp") {
      readinessRows.push({
        label: "WhatsApp",
        value: whatsappId || "не выбран",
        ok: !!whatsappId,
      });
    } else if (goal === "site-leads") {
      readinessRows.push({
        label: "Пиксель",
        value: pixelId ? `${pixelId} · ${pixelEvent || "?"}` : "не выбран",
        ok: !!pixelId && !!pixelEvent,
      });
    } else if (goal === "meta-form") {
      readinessRows.push({
        label: "Лид-форма",
        value: leadFormId || "не выбрана",
        ok: !!leadFormId,
      });
    }
  }

  const budgetValue = Number(String(budget).replace(",", "."));
  const budgetTooLow =
    Number.isFinite(budgetValue) && budgetValue > 0 && minDailyBudget != null &&
    budgetValue < minDailyBudget;

  const [submitting, setSubmitting] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{
    cabinet?: string;
    goal: string;
    budget: string;
    currencySymbol: string;
    rows: { label: string; value: string }[];
    /** true — кампания уже в кабинете; false — ещё доезжает. */
    launched: boolean;
    campaignId?: string | null;
    adId?: string | null;
    adAccountId?: string | null;
  } | null>(null);

  // Запуск кампании идёт через edge-функцию НОВОГО Supabase, где живут
  // clients_config + актуальная функция (поддержка creative_feed/creative_stories,
  // upload в FB /advideos). Auth/проекты остаются на VITE_SUPABASE_URL (Lovable).
  const LAUNCH_BASE = clientSupabaseUrl;
  const LAUNCH_KEY = clientSupabasePublishableKey;
  const WEBHOOK_URL = `${LAUNCH_BASE}/functions/v1/launch-campaign`;

  const handleSubmit = async () => {
    if (!cabinetId) {
      toast.error("Выберите клиента");
      return;
    }
    if (goal === "whatsapp" && !whatsappId) {
      toast.error("Выберите WhatsApp номер");
      return;
    }
    if (goal === "site-leads" && (!pixelId || !pixelEvent)) {
      toast.error("Выберите пиксель и событие");
      return;
    }
    if (goal === "meta-form" && !leadFormId) {
      toast.error("Выберите лид-форму");
      return;
    }
    if (!Number.isFinite(budgetValue) || budgetValue <= 0) {
      toast.error("Укажите дневной бюджет");
      return;
    }
    if (budgetTooLow) {
      toast.error(
        `Meta не примет бюджет меньше ${minDailyBudget} ${currencySign} в сутки`,
      );
      return;
    }
    if (adSetupMode === "create" && !text.trim()) {
      // Текст уходит в объявление как есть — пустой Meta отклонит уже после
      // создания кампании, и в кабинете останется мусор.
      toast.error("Добавьте текст объявления");
      return;
    }
    if (adSetupMode === "existing") {
      if (!existingMediaId) {
        toast.error("Выберите публикацию Instagram");
        return;
      }
      if (!effectiveIgUserId) {
        toast.error("У страницы нет привязанного Instagram — выберите другую страницу");
        return;
      }
      if (selectedExistingPost && !selectedExistingPost.eligible_to_boost) {
        toast.error("Эту публикацию нельзя продвигать");
        return;
      }
    }
    if (adSetupMode === "create" && creativeFormat === "carousel") {
      if (carouselFiles.length < CAROUSEL_MIN) {
        toast.error(`Карусель: загрузите минимум ${CAROUSEL_MIN} фото`);
        return;
      }
      if (carouselFiles.some((f) => !f.type.startsWith("image/"))) {
        toast.error("Карусель поддерживает только изображения");
        return;
      }
    }

    const cab = selectedCabinet;

    // ===== Запекаем кроп/зум/позицию пользователя в готовые файлы =====
    // Картинки — мгновенно через canvas. Видео — через ffmpeg.wasm
    // (загрузка ядра при первом запуске, дальше — кешируется).
    setSubmitting(true);
    let bakedFeed: File | null = feed;
    let bakedStories: File | null = stories;
    let bakedCarousel: File[] = [];
    // Метаданные кропа для видео (n8n обрежет ffmpeg-ом за пару секунд).
    let feedCropMeta: Record<string, unknown> | null = null;
    let storiesCropMeta: Record<string, unknown> | null = null;
    try {
      if (adSetupMode === "existing") {
        // Существующая публикация — файлы не грузим, креатив через source_instagram_media_id.
        bakedFeed = null;
        bakedStories = null;
        bakedCarousel = [];
      } else {
      const bake = async (
        f: File | null,
        view: CreativeViewState | null,
        slotLabel: string,
      ): Promise<{ file: File | null; cropMeta: Record<string, unknown> | null }> => {
        if (!f || !view || !view.frame.w || !view.frame.h) {
          return { file: f, cropMeta: null };
        }
        const params = {
          ratio: view.ratio,
          fit: view.fit,
          zoom: view.zoom,
          pos: view.pos,
          frame: view.frame,
        };
        // Картинки: режем canvas-ом — миллисекунды, без блокировок.
        if (f.type.startsWith("image/")) {
          setBakeStatus(`Готовим ${slotLabel}...`);
          const baked = await cropImageFile(f, params);
          return { file: baked, cropMeta: null };
        }
        // Видео: НЕ кодируем в браузере (медленно). Шлём оригинал + crop,
        // n8n выполнит ffmpeg на сервере (≈2–5 сек на 30-сек видео).
        if (f.type.startsWith("video/")) {
          setBakeStatus(`Готовим видео ${slotLabel}...`);
          const natural = await readVideoNaturalSize(f);
          const rect = computeSourceRect({ ...params, natural });
          return {
            file: f,
            cropMeta: {
              ratio: view.ratio,
              fit: view.fit,
              zoom: view.zoom,
              pos: view.pos,
              frame: view.frame,
              natural,
              // Готовый прямоугольник в пикселях исходника + размер выхода —
              // чтобы n8n мог напрямую: ffmpeg -vf "crop=W:H:X:Y,scale=oW:oH"
              ffmpeg: {
                crop: { w: Math.round(rect.sw), h: Math.round(rect.sh), x: Math.round(rect.sx), y: Math.round(rect.sy) },
                scale: { w: rect.outW, h: rect.outH },
                filter: `crop=${Math.round(rect.sw)}:${Math.round(rect.sh)}:${Math.round(rect.sx)}:${Math.round(rect.sy)},scale=${rect.outW}:${rect.outH}`,
              },
            },
          };
        }
        return { file: f, cropMeta: null };
      };

      if (creativeFormat === "carousel") {
        setBakePct(20);
        bakedCarousel = [];
        for (let i = 0; i < carouselFiles.length; i++) {
          setBakeStatus(`Готовим слайд ${i + 1}/${carouselFiles.length}…`);
          setBakePct(20 + Math.round(((i + 1) / carouselFiles.length) * 70));
          const res = await bake(carouselFiles[i], DEFAULT_CAROUSEL_VIEW, `слайд ${i + 1}`);
          if (res.file) bakedCarousel.push(res.file);
        }
        bakedFeed = bakedCarousel[0] ?? null;
        bakedStories = null;
        feedCropMeta = null;
        storiesCropMeta = null;
      } else {
        // Параллелим feed и stories — обычно это два независимых файла.
        setBakePct(50);
        const [feedRes, storiesRes] = await Promise.all([
          bake(feed, feedViewRef.current, "ленту 4:5"),
          bake(stories, storiesViewRef.current, "сторис 9:16"),
        ]);
        bakedFeed = feedRes.file;
        feedCropMeta = feedRes.cropMeta;
        bakedStories = storiesRes.file;
        storiesCropMeta = storiesRes.cropMeta;
      }
      }
      setBakeStatus(null);
      setBakePct(0);
    } catch (e) {
      setBakeStatus(null);
      setBakePct(0);
      setSubmitting(false);
      const msg =
        e instanceof Error && e.message
          ? e.message
          : typeof e === "string"
            ? e
            : "Не удалось обработать креатив (неизвестная ошибка)";
      // eslint-disable-next-line no-console
      console.error("[bake] error", e);
      toast.error(`Ошибка обработки креатива: ${msg}`);
      return;
    }

    const payload = {
      // Root-level fields for n8n Parse Webhook compatibility
      source: "lovable-webhook",
      cabinet_id: cabinetId,
      project_id: projectId || null,
      project_name: activeProject?.name ?? null,
      ad_account_id: cab?.adAccountId ?? "",
      clientConfig: cab ? {
        cabinet_id: cab.id,
        project_id: projectId || null,
        client_name: cab.name,
        ad_account_id: cab.adAccountId ?? "",
        page_id: effectivePageId || cab.pageId || "",
        page_name: effectivePageName || cab.pageName || "",
        instagram_actor_id: effectiveIgUserId || cab.instagramId || "",
        instagram_user_id: effectiveIgUserId || cab.instagramId || "",
        // Токен Meta не отправляем: его резолвит сервер по кабинету. В браузере
        // ему делать нечего, а у роли manager его в списке кабинетов и нет.
        fb_pixel_id: goal === "site-leads" ? pixelId : (cab.pixelId ?? ""),
        pixel_event: goal === "site-leads" ? pixelEvent : (cab.pixelEvent ?? "Lead"),
        // Если для цели «Лиды с сайта» пользователь ввёл свой URL — отправляем его,
        // иначе используем дефолтный сайт/лендинг из настроек кабинета.
        website_url: (goal === "site-leads" && websiteUrl.trim())
          ? websiteUrl.trim()
          : (cab.websiteUrl ?? ""),
        landing_url: (goal === "site-leads" && websiteUrl.trim())
          ? websiteUrl.trim()
          : (cab.landingUrl ?? ""),
        utm_template: cab.utmTemplate?.trim() || DEFAULT_META_UTM_TEMPLATE,
        whatsapp_number: goal === "whatsapp" ? whatsappId : (cab.whatsappNumber ?? ""),
        telegram_group_id: cab.telegramGroupId ?? "",
        business_id: cab.businessId ?? "",
        app_id: cab.appId ?? "",
        daily_budget: (Number(budget) || 0) * 100, // cents for Meta API
        currency: cab.currency ?? "USD",
        campaign_objective: cab.campaignObjective ?? "",
        optimization_goal: cab.optimizationGoal ?? "",
        lead_form_id: goal === "meta-form" ? leadFormId : (cab.leadFormId ?? ""),
        city: cab.city ?? "",
        brief: cab.brief ?? "",
        region_key: "2037",
        targeting: {
          geo: cab.targetGeo ?? [],
          age_min: cab.targetAgeMin ?? null,
          age_max: cab.targetAgeMax ?? null,
          gender: cab.targetGender ?? "all",
          languages: cab.targetLanguages ?? [],
          interests: cab.targetInterests ?? [],
          exclusions: cab.targetExclusions ?? [],
        },
        schedule: {
          timezone: cab.timezone ?? "Asia/Almaty",
          days_of_week: cab.daysOfWeek ?? [1,2,3,4,5,6,7],
          start_time: cab.startTime ?? null,
          end_time: cab.endTime ?? null,
          launch_hour: cab.launchHour ?? 9,
          auto_launch_enabled: cab.autoLaunchEnabled ?? false,
        },
        creative_defaults: {
          headline: cab.creativeHeadline ?? "",
          primary_text: cab.creativePrimaryText ?? "",
          description: cab.creativeDescription ?? "",
          cta: cab.creativeCta ?? "",
          media_urls: cab.creativeMediaUrls ?? [],
        },
      } : undefined,
      cabinet: cab ? {
        id: cab.id,
        name: cab.name,
        adAccountId: cab.adAccountId,
        pageId: effectivePageId || cab.pageId,
        pageName: effectivePageName || cab.pageName,
        instagramId: cab.instagramId,
      } : { id: cabinetId },
      goal,
      budget: Number(budget) || 0,
      currency: cab?.currency ?? "USD",
      text,
      adSetupMode,
      creativeFormat: adSetupMode === "existing" ? "existing_post" : creativeFormat,
      sourceInstagramMediaId: adSetupMode === "existing" ? existingMediaId : undefined,
      source_instagram_media_id: adSetupMode === "existing" ? existingMediaId : undefined,
      instagramUserId: effectiveIgUserId || cab?.instagramId || undefined,
      pageId: effectivePageId || cab?.pageId || undefined,
      pageName: effectivePageName || cab?.pageName || undefined,
      whatsappNumber: goal === "whatsapp" ? whatsappId : undefined,
      pixelId: goal === "site-leads" ? pixelId : undefined,
      pixelEvent: goal === "site-leads" ? pixelEvent : undefined,
      websiteUrl: goal === "site-leads" ? (websiteUrl.trim() || cab?.websiteUrl || undefined) : undefined,
      leadFormId: goal === "meta-form" ? leadFormId : undefined,
      creatives: {
        feed: bakedFeed
          ? {
              name: bakedFeed.name,
              type: bakedFeed.type,
              size: bakedFeed.size,
              ratio: "4:5",
              // baked=true для фото (готовый JPEG нужного аспекта),
              // baked=false для видео — нужно резать на стороне n8n по cropMeta.
              baked: !bakedFeed.type.startsWith("video/"),
              cropMeta: feedCropMeta,
            }
          : null,
        stories: bakedStories
          ? {
              name: bakedStories.name,
              type: bakedStories.type,
              size: bakedStories.size,
              ratio: "9:16",
              baked: !bakedStories.type.startsWith("video/"),
              cropMeta: storiesCropMeta,
            }
          : null,
        carousel:
          adSetupMode === "create" && creativeFormat === "carousel"
            ? bakedCarousel.map((f) => ({
                name: f.name,
                type: f.type,
                size: f.size,
                ratio: "4:5" as const,
                baked: true,
              }))
            : null,
        existingPost:
          adSetupMode === "existing" && existingMediaId
            ? {
                media_id: existingMediaId,
                ig_user_id: effectiveIgUserId || cab?.instagramId || null,
                permalink: selectedExistingPost?.permalink ?? null,
                media_type: selectedExistingPost?.media_type ?? null,
                caption: selectedExistingPost?.caption ?? null,
              }
            : null,
      },
      // mediaType — чтобы n8n не угадывал по mime бинаря.
      // VIDEO если хоть один файл (feed или stories) видео, иначе PHOTO.
      // Карусель / existing post — PHOTO (или тип поста; n8n берёт из Meta).
      mediaType:
        adSetupMode === "existing"
          ? (selectedExistingPost?.media_type === "VIDEO" ||
              selectedExistingPost?.media_product_type === "REELS"
              ? "VIDEO"
              : "PHOTO")
          : creativeFormat === "carousel"
            ? "PHOTO"
            : ((bakedFeed?.type || bakedStories?.type || "").startsWith("video/"))
              ? "VIDEO"
              : "PHOTO",
      submittedAt: new Date().toISOString(),
      // launchId генерируется фронтом, чтобы и edge, и БД, и n8n работали
      // с одним идентификатором запуска (для callback статусов).
      launchId:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };

    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    if (adSetupMode === "create") {
      if (bakedFeed) fd.append("creative_feed", bakedFeed, bakedFeed.name);
      if (bakedStories) fd.append("creative_stories", bakedStories, bakedStories.name);
      if (creativeFormat === "carousel") {
        bakedCarousel.forEach((f, i) => {
          fd.append(`creative_carousel_${i}`, f, f.name);
        });
      }
    }

    // Edge-функция проверяет пользователя и роль (admin/manager) по JWT сессии.
    // Публикуемый ключ проекта для этого не годится — он не JWT, и проверка
    // возвращала 401 на каждый запуск.
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setSubmitting(false);
      toast.error("Сессия истекла — войдите заново и повторите запуск");
      return;
    }

    // Запуск идёт напрямую в Meta: заливка креатива плюс создание кампании,
    // группы и объявления — обычно 5-15 с. Даём запас и не рвём раньше времени.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 70_000);
    let accepted = false;
    let serverError: string | null = null;
    let result: LaunchResponse | null = null;
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        body: fd,
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(LAUNCH_KEY ? { apikey: LAUNCH_KEY } : {}),
        },
      });
      const data = await res.json().catch(() => null) as LaunchResponse | null;
      if (res.ok && (data?.ok || data?.accepted)) {
        accepted = true;
        result = data;
      } else {
        serverError =
          data?.error || `Не удалось отправить (HTTP ${res.status})`;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("aborted") || ctrl.signal.aborted) {
        // Ответ не пришёл — не выдаём это за успех. Строку запуска создаёт
        // edge сервисным ключом до тяжёлых шагов, поэтому спрашиваем БД.
        accepted = await waitForLaunchRow(payload.launchId, probeLaunchRow);
        if (!accepted) {
          serverError = "Ответ не получен — запуск не подтверждён";
        }
      } else {
        serverError = `Сеть: ${msg}`;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (!accepted) {
      setSubmitting(false);
      toast.error(serverError || "Не удалось отправить кампанию");
      return;
    }

    // Строку в ad_campaigns пишет edge-функция сервисным ключом: у роли manager
    // нет прав на запись по RLS, и раньше запуск просто пропадал из интерфейса.

    // ===== Красивая сводка пользователю =====
    const goalLabel =
      goal === "site-leads"
        ? "Лиды с сайта"
        : goal === "meta-form"
          ? "Лид-форма Meta"
          : "WhatsApp";
    // Бюджет показываем в валюте кабинета — той же, в которой его принимает Meta.
    const currencySymbol = currencySign;
    const rows: { label: string; value: string }[] = [];
    rows.push({ label: "Цель", value: goalLabel });
    rows.push({
      label: "Настройка",
      value:
        adSetupMode === "existing"
          ? "Существующая публикация"
          : "Создать объявление",
    });
    if (adSetupMode === "existing" && existingMediaId) {
      rows.push({
        label: "Публикация",
        value: selectedExistingPost?.caption?.slice(0, 48) || existingMediaId,
      });
    } else {
      rows.push({
        label: "Креатив",
        value:
          creativeFormat === "carousel"
            ? `Карусель · ${bakedCarousel.length} слайдов`
            : "Один креатив",
      });
    }
    if (goal === "site-leads") {
      if (pixelId) rows.push({ label: "Пиксель", value: pixelId });
      if (pixelEvent) rows.push({ label: "Событие", value: pixelEvent });
      const site = websiteUrl.trim() || cab?.websiteUrl;
      if (site) rows.push({ label: "Сайт", value: site });
    } else if (goal === "whatsapp") {
      if (whatsappId) rows.push({ label: "WhatsApp", value: whatsappId });
    } else if (goal === "meta-form") {
      if (leadFormId) rows.push({ label: "Лид-форма", value: leadFormId });
    }

    if (result?.metaCampaignId) {
      rows.push({ label: "Кампания в Meta", value: result.metaCampaignId });
    }

    setSuccessInfo({
      cabinet: cab?.name,
      goal: goalLabel,
      budget,
      currencySymbol,
      rows,
      launched: result?.launched === true,
      campaignId: result?.metaCampaignId ?? null,
      adId: result?.metaAdId ?? null,
      adAccountId: result?.adAccountId ?? cab?.adAccountId ?? null,
    });
    setSuccessOpen(true);

    onOpenChange(false);
    setText("");
    setFeed(null);
    setStories(null);
    setCarouselFiles([]);
    setCreativeFormat("single");
    setAdSetupMode("create");
    setExistingMediaId("");
    setSubmitting(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-5xl flex-col overflow-hidden border-border/50 bg-card p-0 shadow-2xl max-sm:max-h-[100dvh] max-sm:w-full">
        <div className="flex min-h-0 flex-1 flex-col max-sm:max-h-[100dvh] sm:max-h-[92vh]">
          <DialogHeader className="shrink-0 border-b border-border/50 bg-gradient-to-r from-success/10 via-transparent to-transparent px-4 py-3 sm:px-6 sm:py-4">
            <DialogTitle className="flex items-center gap-2.5 pr-10 text-lg tracking-tight sm:text-xl">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15 text-success">
                <Rocket className="h-4 w-4" />
              </span>
              Создать кампанию
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Кабинет, цель, креативы — и отправка на запуск
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="min-h-0 space-y-4 overflow-y-auto border-border/50 px-4 py-4 sm:px-6 sm:py-5 lg:border-r">
              <div className="space-y-2">
                <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Клиент / Кабинет
                </Label>
                <Select value={cabinetId} onValueChange={setCabinetId}>
                  <SelectTrigger className="h-11 rounded-xl border-border/50 bg-background/50">
                    <SelectValue placeholder="Выберите клиента" />
                  </SelectTrigger>
                  <SelectContent>
                    {cabinets.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedCabinet && (
                <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Подтянулось из Meta
                  </div>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                    {readinessRows.map((row) => (
                      <div key={row.label} className="min-w-0">
                        <dt className="text-[10px] text-muted-foreground">{row.label}</dt>
                        <dd
                          className={cn(
                            "truncate text-xs font-medium",
                            row.ok ? "text-foreground" : "text-warning",
                          )}
                          title={row.value}
                        >
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {selectedCabinet && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Страница (от имени)
                    </Label>
                    {pagesAssets.isLoading && (
                      <span className="text-[10px] text-muted-foreground">Загрузка…</span>
                    )}
                  </div>
                  <Select value={effectivePageId} onValueChange={setPageId}>
                    <SelectTrigger className="h-11 rounded-xl border-border/50 bg-background/50">
                      <SelectValue placeholder={pagesAssets.isLoading ? "Загрузка…" : "Выберите страницу"} />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Если дефолтная страница кабинета не вернулась через API — всё равно покажем её. */}
                      {selectedCabinet.pageId &&
                        !pagesAssets.data.some((p) => p.id === selectedCabinet.pageId) && (
                          <SelectItem value={selectedCabinet.pageId}>
                            {selectedCabinet.pageName || selectedCabinet.pageId} · из настроек
                          </SelectItem>
                        )}
                      {pagesAssets.data.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.category ? ` · ${p.category}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {pagesAssets.error && (
                    <div className="text-[11px] text-destructive">{pagesAssets.error}</div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Настройка рекламы
                </Label>
                <Select
                  value={adSetupMode}
                  onValueChange={(v) => {
                    setAdSetupMode(v as AdSetupMode);
                    if (v === "create") setExistingMediaId("");
                  }}
                >
                  <SelectTrigger className="h-11 rounded-xl border-border/50 bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">Создать объявление</SelectItem>
                    <SelectItem value="existing">
                      Использовать существующие публикации
                    </SelectItem>
                  </SelectContent>
                </Select>
                {adSetupMode === "existing" && !effectiveIgUserId && (
                  <p className="text-[11px] text-warning">
                    У выбранной страницы нет Instagram Business. Выберите другую страницу или привяжите IG в Meta.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Цель кампании
                </Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {GOALS.map((g) => {
                    const Icon = g.icon;
                    const active = goal === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setGoal(g.id)}
                        className={cn(
                          "flex flex-col items-start gap-1.5 rounded-xl border px-3 py-3 text-left transition-colors",
                          active
                            ? "border-success/60 bg-success/10 text-foreground"
                            : "border-border/50 bg-background/40 text-muted-foreground hover:border-border hover:text-foreground",
                        )}
                      >
                        <Icon className={cn("h-4 w-4", active ? "text-success" : "")} />
                        <span className="text-xs font-semibold leading-none">{g.label}</span>
                        <span className="text-[10px] opacity-70">{g.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <GoalAssetsPicker
                goal={goal}
                cabinet={
                  selectedCabinet
                    ? { ...selectedCabinet, pageId: effectivePageId || selectedCabinet.pageId }
                    : selectedCabinet
                }
                whatsappId={whatsappId}
                setWhatsappId={setWhatsappId}
                pixelId={pixelId}
                setPixelId={setPixelId}
                pixelEvent={pixelEvent}
                setPixelEvent={setPixelEvent}
                leadFormId={leadFormId}
                setLeadFormId={setLeadFormId}
              />

              {goal === "site-leads" && (
                <div className="space-y-2">
                  <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Ссылка на сайт
                  </Label>
                  <Input
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder={selectedCabinet?.websiteUrl || "https://example.com/landing"}
                    inputMode="url"
                    className="h-11 rounded-xl border-border/50 bg-background/50"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Реклама запустится на эту ссылку с выбранным пикселем.
                    Если оставить пустым — используется сайт из настроек кабинета.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Бюджет в день
                </Label>
                <div className="relative">
                  <Input
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    inputMode="decimal"
                    className={cn(
                      "h-11 rounded-xl border-border/50 bg-background/50 pr-16",
                      budgetTooLow && "border-destructive/60",
                    )}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {accountAssets.isLoading ? "…" : currencySign}
                  </span>
                </div>
                {budgetTooLow ? (
                  <p className="text-[11px] text-destructive">
                    Meta не примет меньше {minDailyBudget} {currencySign} в сутки
                    для этого кабинета.
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Сумма в валюте кабинета ({currencyCode})
                    {minDailyBudget ? `, минимум ${minDailyBudget} ${currencySign}` : ""}.
                  </p>
                )}
              </div>

              {adSetupMode === "create" && (
                <div className="space-y-2">
                  <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Текст объявления
                  </Label>
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={5}
                    placeholder="Краткий цепляющий текст с CTA…"
                    className="rounded-xl border-border/50 bg-background/50"
                  />
                </div>
              )}
              {adSetupMode === "existing" && (
                <p className="rounded-xl border border-border/50 bg-background/40 px-3 py-2.5 text-[11px] text-muted-foreground">
                  Текст и креатив берутся из выбранной публикации Instagram.
                  Цель продвижения (WhatsApp / сайт / форма) задаёт CTA объявления.
                </p>
              )}
            </div>

            <div className="min-h-0 overflow-y-auto bg-background/20 px-4 py-4 sm:px-6 sm:py-5">
              {adSetupMode === "existing" ? (
                <ExistingPostPicker
                  items={igMedia.data}
                  isLoading={igMedia.isLoading}
                  error={igMedia.error}
                  selectedId={existingMediaId}
                  onSelect={setExistingMediaId}
                  onRefresh={() => void igMedia.refetch()}
                />
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Креативы
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl border border-border/50 bg-background/40 p-1">
                    {(
                      [
                        { id: "single" as const, label: "Один", icon: LayoutTemplate },
                        { id: "carousel" as const, label: "Карусель", icon: Images },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setCreativeFormat(opt.id)}
                        className={cn(
                          "flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors",
                          creativeFormat === opt.id
                            ? "bg-success/15 text-success"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <opt.icon className="h-3.5 w-3.5" />
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {creativeFormat === "carousel" ? (
                    <CarouselUpload files={carouselFiles} onChange={setCarouselFiles} />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <CreativeUpload
                        label="Лента (4:5)"
                        ratio="4:5"
                        file={feed}
                        onFile={setFeed}
                        onView={(s) => { feedViewRef.current = s; }}
                      />
                      <CreativeUpload
                        label="Stories (9:16)"
                        ratio="9:16"
                        file={stories}
                        onFile={setStories}
                        onView={(s) => { storiesViewRef.current = s; }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className={cn(
            "sticky bottom-0 shrink-0 border-t border-border/50 bg-background/95 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4",
            mobileDialogFooterPad,
          )}>
            {bakeStatus && (
              <div className="mb-3 rounded-xl border border-border/50 bg-background/60 px-4 py-2.5 text-xs">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{bakeStatus}</span>
                  <span className="font-mono tabular-nums text-foreground">{bakePct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-md bg-muted">
                  <div
                    className="h-full bg-success transition-[width]"
                    style={{ width: `${bakePct}%` }}
                  />
                </div>
              </div>
            )}
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="h-12 w-full gap-2 rounded-xl bg-success text-white hover:bg-success/90"
            >
              <Rocket className="h-4 w-4" />
              {submitting
                ? bakeStatus
                  ? "Готовим креатив…"
                  : "Отправляем на проверку…"
                : "Отправить на запуск AI"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {successInfo && (
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="max-w-md overflow-hidden border-border/50 bg-card p-0">
          <div className="border-b border-border/50 px-6 py-5">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
                  successInfo.launched
                    ? "bg-success/15 text-success"
                    : "bg-warning/15 text-warning",
                )}
              >
                {successInfo.launched
                  ? <CheckCircle2 className="h-5 w-5" />
                  : <RefreshCw className="h-5 w-5 animate-spin" />}
              </div>
              <div>
                <DialogTitle className="text-lg leading-tight tracking-tight">
                  {successInfo.launched
                    ? "Реклама запущена"
                    : "Запуск принят, кампания создаётся"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs">
                  {successInfo.launched
                    ? "Кампания, группа и объявление уже в рекламном кабинете — Meta отправила их на модерацию."
                    : "Заканчиваем создание в Meta. Прогресс виден во вкладке «Кампании»."}
                </DialogDescription>
              </div>
            </div>
          </div>

          <div className="space-y-3 px-6 pb-6">
            {successInfo.cabinet && (
              <div className="rounded-xl border border-border/60 bg-background/60 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Кабинет
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-foreground">
                  {successInfo.cabinet}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-success/80">
                Бюджет в день
              </div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
                {successInfo.currencySymbol}
                {successInfo.budget}
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  / день
                </span>
              </div>
            </div>

            {successInfo.rows.length > 0 && (
              <div className="divide-y divide-border/60 rounded-xl border border-border/60 bg-background/60">
                {successInfo.rows.map((r) => (
                  <div
                    key={r.label}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="text-xs text-muted-foreground">{r.label}</span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {successInfo.launched && successInfo.campaignId && successInfo.adAccountId && (
              <a
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${
                  successInfo.adAccountId.replace(/^act_/, "")
                }&selected_campaign_ids=${successInfo.campaignId}`}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/60 text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-background"
              >
                Открыть в Ads Manager
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}

            <Button
              onClick={() => setSuccessOpen(false)}
              className="mt-2 h-11 w-full rounded-xl bg-success text-white hover:bg-success/90"
            >
              Отлично
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )}
  </>
  );
};

export default CreateCampaignDialog;