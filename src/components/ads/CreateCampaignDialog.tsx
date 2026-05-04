import { useEffect, useRef, useState } from "react";
import { Rocket, Upload } from "lucide-react";
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
import type { AdCabinet } from "@/types/ads";
import { saveCampaign } from "@/hooks/useCabinetsStore";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import GoalAssetsPicker from "./GoalAssetsPicker";
import { cropImageFile, cropVideoFile, type Fit } from "@/lib/cropMedia";

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

const GOALS: { id: Goal; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "site-leads", label: "Лиды с сайта" },
  { id: "meta-form", label: "Лид-форма Meta" },
];

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

const CreateCampaignDialog = ({
  open,
  onOpenChange,
  cabinets,
}: CreateCampaignDialogProps) => {
  const { activeId: projectId, active: activeProject } = useProjectsStore();
  const [cabinetId, setCabinetId] = useState<string>(cabinets[0]?.id ?? "");
  const [goal, setGoal] = useState<Goal>("whatsapp");
  const [budget, setBudget] = useState("50");
  const [feed, setFeed] = useState<File | null>(null);
  const [stories, setStories] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [whatsappId, setWhatsappId] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [pixelEvent, setPixelEvent] = useState("Lead");
  const [leadFormId, setLeadFormId] = useState("");

  const selectedCabinet = cabinets.find((c) => c.id === cabinetId);

  const [submitting, setSubmitting] = useState(false);

  // Запуск идёт через нашу edge-функцию, она подставляет META_ACCESS_TOKEN
  // из секретов и алиасы ACCESS_TOKEN/AD_ACCOUNT/PAGE_ID, которые ждёт n8n.
  const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/launch-campaign`;

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

    const cab = selectedCabinet;
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
        page_id: cab.pageId ?? "",
        page_name: cab.pageName ?? "",
        instagram_actor_id: cab.instagramId ?? "",
        instagram_user_id: cab.instagramId ?? "",
        fb_token: cab.accessToken ?? "",
        fb_pixel_id: goal === "site-leads" ? pixelId : (cab.pixelId ?? ""),
        pixel_event: goal === "site-leads" ? pixelEvent : (cab.pixelEvent ?? "Lead"),
        website_url: cab.websiteUrl ?? "",
        landing_url: cab.landingUrl ?? "",
        utm_template: cab.utmTemplate ?? "",
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
        pageId: cab.pageId,
        instagramId: cab.instagramId,
      } : { id: cabinetId },
      goal,
      budget: Number(budget) || 0,
      currency: cab?.currency ?? "USD",
      text,
      whatsappNumber: goal === "whatsapp" ? whatsappId : undefined,
      pixelId: goal === "site-leads" ? pixelId : undefined,
      pixelEvent: goal === "site-leads" ? pixelEvent : undefined,
      leadFormId: goal === "meta-form" ? leadFormId : undefined,
      creatives: {
        feed: feed
          ? { name: feed.name, type: feed.type, size: feed.size }
          : null,
        stories: stories
          ? { name: stories.name, type: stories.type, size: stories.size }
          : null,
      },
      submittedAt: new Date().toISOString(),
    };

    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    if (feed) fd.append("creative_feed", feed, feed.name);
    if (stories) fd.append("creative_stories", stories, stories.name);

    setSubmitting(true);
    try {
      const res = await fetch(WEBHOOK_URL, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Webhook ${res.status}`);

      saveCampaign({
        cabinetId,
        goal,
        budget,
        text,
        whatsappId: goal === "whatsapp" ? whatsappId : undefined,
        pixelId: goal === "site-leads" ? pixelId : undefined,
        pixelEvent: goal === "site-leads" ? pixelEvent : undefined,
        leadFormId: goal === "meta-form" ? leadFormId : undefined,
      }, projectId || null);
      toast.success("Кампания отправлена в n8n");
      onOpenChange(false);
      setText("");
      setFeed(null);
      setStories(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось отправить";
      toast.error(`Ошибка отправки в n8n: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Rocket className="h-6 w-6 text-success" />
            Создать кампанию
          </DialogTitle>
          <DialogDescription>
            Настройте параметры и отправьте на запуск через Webhook
          </DialogDescription>
        </DialogHeader>

        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Основные настройки
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Клиент / Кабинет
          </Label>
          <Select value={cabinetId} onValueChange={setCabinetId}>
            <SelectTrigger className="h-12 rounded-xl bg-background/60">
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

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Цель кампании
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {GOALS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGoal(g.id)}
                className={cn(
                  "rounded-xl border bg-background/60 px-4 py-3 text-sm font-medium transition-colors",
                  goal === g.id
                    ? "border-success text-foreground shadow-[inset_0_0_0_1px_hsl(var(--success))]"
                    : "border-border/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <GoalAssetsPicker
          goal={goal}
          cabinet={selectedCabinet}
          whatsappId={whatsappId}
          setWhatsappId={setWhatsappId}
          pixelId={pixelId}
          setPixelId={setPixelId}
          pixelEvent={pixelEvent}
          setPixelEvent={setPixelEvent}
          leadFormId={leadFormId}
          setLeadFormId={setLeadFormId}
        />

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Бюджет
          </Label>
          <div className="relative">
            <Input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="numeric"
              className="h-12 rounded-xl bg-background/60 pr-10"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
          </div>
        </div>

        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Креативы
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CreativeUpload label="Лента (4:5)" ratio="4:5" file={feed} onFile={setFeed} />
          <CreativeUpload label="Stories (9:16)" ratio="9:16" file={stories} onFile={setStories} />
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Текст объявления
          </Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Краткий цепляющий текст с CTA…"
            className="rounded-xl bg-background/60"
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="h-12 w-full rounded-xl bg-success text-white hover:bg-success/90"
        >
          {submitting ? "Отправляем…" : "🚀 Отправить на запуск AI"}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default CreateCampaignDialog;