import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Send,
  Palette,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Check,
  Users,
  Package,
  Layers,
  Sparkles,
  Camera,
  Mic,
  GitCompareArrows,
  Type,
  Wand2,
  User,
  Briefcase,
  Sun,
  Trees,
  Dumbbell,
  Shirt,
} from "lucide-react";
import Header from "@/components/factory/Header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CONTENT_TYPES } from "@/data/contentTypes";
import { postContentFactory } from "@/lib/contentFactory";
import { buildStyleBrief, type StyleId as BriefStyleId } from "@/data/styleBriefs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type StyleId =
  | "auto"
  | "ugc_people"
  | "ugc_product"
  | "ugc_mixed"
  | "motion"
  | "studio"
  | "talking_head"
  | "before_after"
  | "typography"
  // Neuro photo session styles
  | "neuro_business"
  | "neuro_lifestyle"
  | "neuro_studio"
  | "neuro_outdoor"
  | "neuro_fashion"
  | "neuro_sport"
  | "neuro_casual";

interface StyleDef {
  id: StyleId;
  label: string;
  description: string;
  icon: typeof Users;
  preview: string;
  fallbackSeed: string;
  isAuto?: boolean;
}

const STYLES: StyleDef[] = [
  {
    id: "auto",
    label: "АВТО",
    description: "ИИ сам подберёт лучший формат под ваше ТЗ",
    icon: Wand2,
    preview: "/style-previews/auto.png",
    fallbackSeed: "auto-pick",
    isAuto: true,
  },
  {
    id: "ugc_people",
    label: "UGC с людьми",
    description: "Селфи-стиль, лицо на камеру, лайфстайл",
    icon: Users,
    preview: "/style-previews/ugc-people.png",
    fallbackSeed: "ugc-people",
  },
  {
    id: "ugc_product",
    label: "UGC без людей",
    description: "Только продукт: в руках, дома, в использовании",
    icon: Package,
    preview: "/style-previews/ugc-product.png",
    fallbackSeed: "ugc-product",
  },
  {
    id: "ugc_mixed",
    label: "UGC смешанный",
    description: "Человек + крупные планы продукта",
    icon: Layers,
    preview: "/style-previews/ugc-mixed.png",
    fallbackSeed: "ugc-mixed",
  },
  {
    id: "motion",
    label: "Motion / Анимация",
    description: "Анимированный креатив, кинетическая типографика",
    icon: Sparkles,
    preview: "/style-previews/motion.png",
    fallbackSeed: "motion-anim",
  },
  {
    id: "studio",
    label: "Студийный",
    description: "Чистый фон, постановочный свет",
    icon: Camera,
    preview: "/style-previews/studio.png",
    fallbackSeed: "studio-shot",
  },
  {
    id: "talking_head",
    label: "Talking Head",
    description: "Эксперт говорит в камеру",
    icon: Mic,
    preview: "/style-previews/talking-head.png",
    fallbackSeed: "talking-head",
  },
  {
    id: "before_after",
    label: "До-После",
    description: "Transformation, проблема→решение",
    icon: GitCompareArrows,
    preview: "/style-previews/before-after.png",
    fallbackSeed: "before-after",
  },
  {
    id: "typography",
    label: "Графический",
    description: "Жирный текст, цвет, цифры, цитаты",
    icon: Type,
    preview: "/style-previews/typography.png",
    fallbackSeed: "typography",
  },
];

// Стили для нейрофотосессии (category: "ai")
const NEURO_STYLES: StyleDef[] = [
  {
    id: "auto",
    label: "АВТО",
    description: "ИИ сам подберёт лучшие сеттинги под ваше ТЗ",
    icon: Wand2,
    preview: "/style-previews/auto.png",
    fallbackSeed: "auto-pick",
    isAuto: true,
  },
  {
    id: "neuro_business",
    label: "Деловой портрет",
    description: "Костюм, нейтральный фон, для LinkedIn / сайта",
    icon: Briefcase,
    preview: "/style-previews/neuro-business.jpg",
    fallbackSeed: "neuro-business",
  },
  {
    id: "neuro_lifestyle",
    label: "Лайфстайл",
    description: "Естественный свет, кафе/дом/город, расслабленно",
    icon: User,
    preview: "/style-previews/neuro-lifestyle.jpg",
    fallbackSeed: "neuro-lifestyle",
  },
  {
    id: "neuro_studio",
    label: "Студия",
    description: "Постановочный свет, цветной/чёрный/белый фон",
    icon: Camera,
    preview: "/style-previews/neuro-studio.jpg",
    fallbackSeed: "neuro-studio",
  },
  {
    id: "neuro_outdoor",
    label: "На улице",
    description: "Природа, город, золотой час, аутдор",
    icon: Trees,
    preview: "/style-previews/neuro-outdoor.jpg",
    fallbackSeed: "neuro-outdoor",
  },
  {
    id: "neuro_fashion",
    label: "Фэшн",
    description: "Модный лук, журнальная съёмка, стиль",
    icon: Shirt,
    preview: "/style-previews/neuro-fashion.jpg",
    fallbackSeed: "neuro-fashion",
  },
  {
    id: "neuro_sport",
    label: "Спорт",
    description: "Активный образ, спортивная одежда, динамика",
    icon: Dumbbell,
    preview: "/style-previews/neuro-sport.jpg",
    fallbackSeed: "neuro-sport",
  },
  {
    id: "neuro_casual",
    label: "Casual",
    description: "Повседневный образ, дневной свет",
    icon: Sun,
    preview: "/style-previews/neuro-casual.jpg",
    fallbackSeed: "neuro-casual",
  },
];

type AngleId =
  | "front"
  | "three_quarter"
  | "side"
  | "back"
  | "close_up"
  | "half_body"
  | "full_body";

const ANGLES: { id: AngleId; label: string; description: string }[] = [
  { id: "front", label: "Анфас", description: "Лицо строго в камеру" },
  { id: "three_quarter", label: "3/4", description: "Полупрофиль" },
  { id: "side", label: "Профиль", description: "Боком к камере" },
  { id: "back", label: "Со спины", description: "Спиной к камере" },
  { id: "close_up", label: "Крупный план", description: "Только лицо/плечи" },
  { id: "half_body", label: "По пояс", description: "Поясной портрет" },
  { id: "full_body", label: "В полный рост", description: "Полный рост" },
];

const MAX_STYLES = 4;
const AUTO_ID: StyleId = "auto";

type ColorId =
  | "auto"
  | "magenta"
  | "violet"
  | "lavender"
  | "cyan"
  | "lime"
  | "yellow"
  | "black"
  | "white"
  | "custom";

const COLORS: { id: ColorId; label: string; swatch: string }[] = [
  { id: "auto", label: "АВТО", swatch: "auto" },
  { id: "magenta", label: "Magenta", swatch: "#E0269B" },
  { id: "violet", label: "Violet", swatch: "#6D28D9" },
  { id: "lavender", label: "Lavender", swatch: "#C4A6F7" },
  { id: "cyan", label: "Cyan", swatch: "#67E8F9" },
  { id: "lime", label: "Lime", swatch: "#A3E635" },
  { id: "yellow", label: "Yellow", swatch: "#FACC15" },
  { id: "black", label: "Black", swatch: "#1A1A1A" },
  { id: "white", label: "White", swatch: "#FFFFFF" },
  { id: "custom", label: "Custom", swatch: "custom" },
];

interface GeneratedVariant {
  styleId: StyleId;
  styleLabel: string;
  imageUrl: string | null;
  raw: unknown;
  error?: string;
}

const StylePreviewImage = ({ style, selected }: { style: StyleDef; selected: boolean }) => {
  const [errored, setErrored] = useState(false);
  const src = errored
    ? `https://picsum.photos/seed/${style.fallbackSeed}/400/400`
    : style.preview;
  return (
    <img
      src={src}
      alt={`Пример креатива в формате «${style.label}»`}
      onError={() => setErrored(true)}
      className={cn(
        "h-full w-full object-cover transition-transform duration-300",
        selected ? "scale-[1.02]" : "group-hover:scale-[1.02]",
      )}
      loading="lazy"
    />
  );
};

const CreateStep3 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prevState = (location.state ?? {}) as Record<string, unknown>;

  const contentType = CONTENT_TYPES.find(
    (t) => t.id === (prevState.typeId as string | undefined),
  );
  const isNeuroPhoto = contentType?.category === "ai";
  const activeStyles = isNeuroPhoto ? NEURO_STYLES : STYLES;
  const defaultStyle: StyleId = isNeuroPhoto ? "neuro_business" : "ugc_people";

  const [selectedStyles, setSelectedStyles] = useState<StyleId[]>([defaultStyle]);
  const [selectedAngles, setSelectedAngles] = useState<AngleId[]>(
    isNeuroPhoto ? ["front", "three_quarter"] : [],
  );
  const [colorId, setColorId] = useState<ColorId>("auto");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">(
    "idle",
  );
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<GeneratedVariant[] | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  // Отредактированные пользователем ТЗ (по styleId). Если пусто — используется авто-бриф.
  const [editedBriefs, setEditedBriefs] = useState<Partial<Record<StyleId, string>>>({});

  const toggleStyle = (id: StyleId) => {
    setSelectedStyles((prev) => {
      // АВТО — эксклюзивный режим: всегда один и сам по себе.
      if (id === AUTO_ID) {
        return prev.includes(AUTO_ID) ? prev : [AUTO_ID];
      }
      // Если был выбран АВТО — снимаем его при выборе любого ручного стиля.
      const base = prev.filter((s) => s !== AUTO_ID);
      if (prev.includes(id)) {
        if (base.length === 1) {
          toast.error("Минимум 1 стиль обязателен");
          return prev;
        }
        return base.filter((s) => s !== id);
      }
      if (base.length >= MAX_STYLES) {
        toast.error(`Максимум ${MAX_STYLES} стиля одновременно`);
        return prev;
      }
      return [...base, id];
    });
  };

  const toggleAngle = (id: AngleId) => {
    setSelectedAngles((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id],
    );
  };

  const buildBriefPrompt = async () => {
    const mode = (prevState.mode as string | undefined) ?? null;
    const linkUrl = (prevState.linkUrl as string | undefined) ?? "";
    const description = (prevState.description as string | undefined) ?? "";
    const productName = (prevState.productName as string | undefined) ?? "";
    const extraInstructions =
      (prevState.extraInstructions as string | undefined) ?? "";
    const photos = (prevState.photos as File[] | undefined) ?? [];

    const promptParts: string[] = [];
    if (productName.trim()) promptParts.push(`Товар: ${productName.trim()}`);
    if (mode === "link" && linkUrl.trim())
      promptParts.push(`Ссылка на источник: ${linkUrl.trim()}`);
    if (mode === "description" && description.trim())
      promptParts.push(description.trim());
    if (mode === "photo")
      promptParts.push(
        `Создать креативы на основе ${photos.length} загруженных фото (включая логотип, если он среди них). Используй визуал, цвета и фирменный стиль из приложенных изображений.`,
      );
    if (extraInstructions.trim())
      promptParts.push(`Инструкции:\n${extraInstructions.trim()}`);

    // Метаданные о фото — без base64. Сами файлы прикрепляются к FormData
    // отдельно (поля photo_0, photo_1, ...), чтобы не раздувать JSON.
    const photoMeta = photos.map((f, idx) => ({
      index: idx,
      field: `photo_${idx}`,
      name: f.name,
      mimeType: f.type,
      size: f.size,
    }));

    return {
      prompt: promptParts.join("\n\n"),
      mode,
      linkUrl,
      description,
      productName,
      extraInstructions,
      photoMeta,
      photos,
    };
  };

  const extractImageUrl = (data: unknown): string | null => {
    if (!data) return null;
    if (typeof data === "string" && /^https?:\/\//.test(data)) return data;
    if (Array.isArray(data)) {
      for (const item of data) {
        const url = extractImageUrl(item);
        if (url) return url;
      }
      return null;
    }
    if (typeof data === "object") {
      const obj = data as Record<string, unknown>;
      const candidateKeys = ["imageUrl", "image_url", "url", "image", "src", "output"];
      for (const k of candidateKeys) {
        if (typeof obj[k] === "string" && /^https?:\/\//.test(obj[k] as string)) {
          return obj[k] as string;
        }
      }
      for (const v of Object.values(obj)) {
        const url = extractImageUrl(v);
        if (url) return url;
      }
    }
    return null;
  };

  const handleCreate = async () => {
    if (selectedStyles.length === 0) {
      toast.error("Выберите минимум 1 стиль");
      return;
    }
    setSubmitting(true);
    setResults(null);
    setStatus("sending");
    setStatusMessage("Подготавливаем данные...");
    setProgress(10);
    setTaskDialogOpen(true);

    let progressTimer: ReturnType<typeof setInterval> | null = null;
    try {
      const brief = await buildBriefPrompt();
      const color = COLORS.find((c) => c.id === colorId);

      setStatusMessage(
        `Запускаем ${selectedStyles.length} ${selectedStyles.length === 1 ? "генерацию" : "генерации"}...`,
      );
      setProgress(25);
      progressTimer = setInterval(() => {
        setProgress((p) => (p < 85 ? p + 2 : p));
      }, 350);

      const settled = await Promise.allSettled(
        selectedStyles.map(async (styleId): Promise<GeneratedVariant> => {
          const styleDef = activeStyles.find((s) => s.id === styleId)!;
          const isAuto = styleDef.isAuto === true;
          const autoCandidates = activeStyles.filter((s) => !s.isAuto).map((s) => ({
            id: s.id,
            label: s.label,
            description: s.description,
          }));
          const task = isNeuroPhoto ? "neuro_photo_session" : "ad_creative";
          const anglesPayload = isNeuroPhoto
            ? selectedAngles.map((aid) => {
                const a = ANGLES.find((x) => x.id === aid)!;
                return { id: a.id, label: a.label, description: a.description };
              })
            : [];
          const built = buildStyleBrief({
            styleId: styleDef.id as BriefStyleId,
            userBrief: brief.prompt,
            format: {
              aspect: (prevState.aspect as string | undefined) ?? null,
              lang: (prevState.lang as string | undefined) ?? null,
              variants: (prevState.variants as number | undefined) ?? null,
            },
            color: color
              ? { id: color.id, label: color.label, swatch: color.swatch }
              : null,
            angles: anglesPayload,
            autoCandidates: isAuto ? autoCandidates : null,
          });

          // Если пользователь отредактировал ТЗ — отправляем его, иначе авто.
          const userEdited =
            typeof editedBriefs[styleDef.id] === "string" &&
            (editedBriefs[styleDef.id] as string).trim().length > 0 &&
            editedBriefs[styleDef.id] !== built.technicalBrief;
          const finalTechnicalBrief = userEdited
            ? (editedBriefs[styleDef.id] as string)
            : built.technicalBrief;

          const payload = {
            source: "lovable.content-factory",
            submittedAt: new Date().toISOString(),
            task,
            // Готовый промпт со стилевыми инструкциями + бриф пользователя.
            // В n8n именно это поле передаётся в AI image generator.
            finalPrompt: finalTechnicalBrief,
            contentType: contentType
              ? {
                  id: contentType.id,
                  title: contentType.title,
                  subtitle: contentType.subtitle,
                  category: contentType.category,
                  tooltip: contentType.tooltip,
                }
              : { id: prevState.typeId ?? null },
            prompt: brief.prompt,
            source_input: {
              mode: brief.mode,
              linkUrl: brief.mode === "link" ? brief.linkUrl || null : null,
              description:
                brief.mode === "description" ? brief.description || null : null,
              productName:
                brief.mode === "description"
                  ? brief.productName || null
                  : null,
              photosCount:
                brief.mode === "photo" ? brief.photos.length : 0,
              // Только метаданные. Сами файлы — в FormData как photo_0..N.
              photos: brief.mode === "photo" ? brief.photoMeta : [],
              photosRole: isNeuroPhoto ? "face_reference" : "brand_assets",
              extraInstructions: brief.extraInstructions || null,
            },
            format: {
              aspect: prevState.aspect ?? null,
              lang: prevState.lang ?? null,
              variants: prevState.variants ?? null,
            },
            design: {
              style: selectedStyles,
              currentStyle: {
                id: styleDef.id,
                label: styleDef.label,
                description: styleDef.description,
                auto: isAuto,
                // Структурированный бриф стиля (composition, lighting, cameraAngle, ...)
                brief: built.structured,
                // Готовый текстовый промпт для AI.
                technicalBrief: finalTechnicalBrief,
                userEdited,
                // Negative prompt — чего избегать.
                avoid: built.avoid,
              },
              auto: isAuto,
              autoCandidates: isAuto ? autoCandidates : null,
              angles: anglesPayload,
              color: {
                id: color?.id ?? null,
                label: color?.label ?? null,
                swatch: color?.swatch ?? null,
              },
            },
          };

          // Multipart: payload как JSON-строка + бинарные файлы рядом.
          // Это в разы быстрее и легче, чем base64 в JSON.
          const fd = new FormData();
          fd.append("payload", JSON.stringify(payload));
          if (brief.mode === "photo") {
            brief.photos.forEach((file, idx) => {
              fd.append(`photo_${idx}`, file, file.name);
            });
          }
          const data = await postContentFactory(fd);
          return {
            styleId: styleDef.id,
            styleLabel: styleDef.label,
            imageUrl: extractImageUrl(data),
            raw: data,
          };
        }),
      );

      // Map settled results — keep failed ones visible with an error message
      // instead of throwing the whole batch away.
      const variants: GeneratedVariant[] = settled.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        const styleDef = activeStyles.find((s) => s.id === selectedStyles[i])!;
        return {
          styleId: styleDef.id,
          styleLabel: styleDef.label,
          imageUrl: null,
          raw: null,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        };
      });

      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      setProgress(100);
      const okCount = variants.filter((v) => !v.error).length;
      const failCount = variants.length - okCount;
      setResults(variants);
      if (okCount === 0) {
        setStatus("error");
        setStatusMessage(
          variants[0]?.error ?? "Не удалось сгенерировать ни один вариант",
        );
        toast.error("Все варианты упали", {
          description: variants[0]?.error,
        });
      } else {
        setStatus("success");
        setStatusMessage(
          failCount > 0
            ? `Готово: ${okCount} из ${variants.length} (${failCount} с ошибкой)`
            : `Готово: ${variants.length} ${variants.length === 1 ? "вариант" : "варианта(ов)"} сгенерировано`,
        );
        toast.success("Креативы готовы", {
          description: variants
            .filter((v) => !v.error)
            .map((v) => v.styleLabel)
            .join(" · "),
        });
      }
    } catch (e) {
      if (progressTimer) clearInterval(progressTimer);
      setProgress(100);
      setStatus("error");
      setStatusMessage(
        e instanceof Error ? e.message : "Неизвестная ошибка при отправке",
      );
      toast.error("Не удалось отправить задачу", {
        description: e instanceof Error ? e.message : "Неизвестная ошибка",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen">
      <Header onClose={() => navigate("/")} />

      <section className="container max-w-5xl pt-10 pb-16 sm:pt-14 animate-fade-in-up">
        <div className="inline-flex items-center rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Шаг 3 из 3
        </div>

        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          {isNeuroPhoto ? "Стиль фотосессии" : "Стиль дизайна"}
        </h1>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">
          {isNeuroPhoto
            ? `Выберите от 1 до ${MAX_STYLES} стилей съёмки — сгенерируем по одному варианту для каждого`
            : `Выберите от 1 до ${MAX_STYLES} форматов — сгенерируем по одному креативу для каждого`}
        </p>

        {/* Style multi-select */}
        <div className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                <Palette className="h-4 w-4" />
              </span>
              {isNeuroPhoto ? "Стиль съёмки" : "Стиль креатива"}
            </div>
            <div className="text-xs text-muted-foreground">
              Выбрано:{" "}
              <span className="font-semibold text-foreground">
                {selectedStyles.length}
              </span>{" "}
              / {MAX_STYLES}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {activeStyles.map((s) => {
              const Icon = s.icon;
              const selected = selectedStyles.includes(s.id);
              const order = selected ? selectedStyles.indexOf(s.id) + 1 : null;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStyle(s.id)}
                  aria-pressed={selected}
                  aria-label={`${s.label}: ${s.description}`}
                  style={{ minHeight: 260 }}
                  className={cn(
                    "group relative flex w-full flex-col overflow-hidden rounded-2xl border bg-card text-left transition-all duration-300",
                    "hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-elevated",
                    selected
                      ? "border-primary shadow-glow ring-2 ring-primary/60"
                      : "border-border",
                  )}
                >
                  {/* Preview — top 60% */}
                  <div className="relative aspect-[5/3] w-full overflow-hidden bg-secondary/40">
                    <StylePreviewImage style={s} selected={selected} />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/90 via-card/10 to-transparent" />
                    {selected && order !== null && (
                      <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-glow">
                        {order}
                      </span>
                    )}
                    <span
                      className={cn(
                        "absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border-2 transition-all",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-white/70 bg-black/30 text-transparent backdrop-blur-sm",
                      )}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                    <span className="absolute bottom-2 left-2 grid h-8 w-8 place-items-center rounded-lg bg-background/85 text-primary backdrop-blur">
                      <Icon className="h-4 w-4" strokeWidth={2} />
                    </span>
                  </div>

                  {/* Text — bottom 40% */}
                  <div className="flex flex-1 flex-col justify-center gap-1 px-3 py-3">
                    <div className="text-sm font-semibold leading-tight text-foreground">
                      {s.label}
                    </div>
                    <div className="text-xs leading-snug text-muted-foreground line-clamp-2">
                      {s.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Angles — only for neuro photo */}
        {isNeuroPhoto && (
          <div className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Camera className="h-4 w-4" />
                </span>
                Ракурсы
              </div>
              <div className="text-xs text-muted-foreground">
                Выбрано:{" "}
                <span className="font-semibold text-foreground">
                  {selectedAngles.length}
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Выберите один или несколько ракурсов для съёмки
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ANGLES.map((a) => {
                const selected = selectedAngles.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAngle(a.id)}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
                      selected
                        ? "border-primary bg-primary/10 text-primary shadow-glow"
                        : "border-border bg-card text-foreground hover:border-primary/60",
                    )}
                    title={a.description}
                  >
                    {selected && <Check className="mr-1.5 inline h-3.5 w-3.5" />}
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Color */}
        <div className="mt-10">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Palette className="h-4 w-4" />
            </span>
            Основной цвет
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            {COLORS.map((c) => {
              const selected = colorId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColorId(c.id)}
                  aria-label={c.label}
                  aria-pressed={selected}
                  className={cn(
                    "relative h-14 w-14 overflow-hidden rounded-2xl border-2 transition-all duration-200",
                    "hover:-translate-y-0.5 hover:scale-105",
                    selected
                      ? "border-foreground shadow-glow"
                      : "border-transparent",
                  )}
                  style={
                    c.swatch === "auto"
                      ? {
                          background:
                            "linear-gradient(135deg, #E0269B 0%, #6D28D9 100%)",
                        }
                      : c.swatch === "custom"
                        ? {
                            background:
                              "conic-gradient(from 180deg, #ff0000, #ffae00, #fff700, #00ff15, #00fff7, #002bff, #aa00ff, #ff00aa, #ff0000)",
                          }
                        : { backgroundColor: c.swatch }
                  }
                >
                  {c.id === "auto" && (
                    <span className="absolute inset-0 grid place-items-center text-[11px] font-bold tracking-wider text-white">
                      АВТО
                    </span>
                  )}
                  {c.id === "custom" && (
                    <span className="absolute inset-1 grid place-items-center rounded-xl bg-background text-foreground">
                      <Plus className="h-5 w-5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => navigate(-1)}
            disabled={submitting}
            className="h-14 rounded-2xl border-border bg-card text-base"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Button>
          <Button
            size="lg"
            onClick={handleCreate}
            disabled={submitting || selectedStyles.length === 0}
            className="h-14 rounded-2xl bg-gradient-primary text-base font-semibold text-primary-foreground shadow-glow hover:opacity-90"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {submitting ? "Создаём дизайн…" : "Создать дизайн"}
          </Button>
        </div>

        {/* ТЗ-превью перед отправкой */}
        <Collapsible className="mt-6">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-left transition-all hover:border-primary/60"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
                  <FileText className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Посмотреть ТЗ перед отправкой
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Финальный промпт, который пойдёт в AI-генератор
                  </div>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {selectedStyles.map((sid) => {
              const styleDef = activeStyles.find((s) => s.id === sid)!;
              const Icon = styleDef.icon;
              const color = COLORS.find((c) => c.id === colorId);
              const isAuto = styleDef.isAuto === true;
              const autoCandidates = activeStyles
                .filter((s) => !s.isAuto)
                .map((s) => ({ id: s.id, label: s.label, description: s.description }));
              const anglesPayload = isNeuroPhoto
                ? selectedAngles.map((aid) => {
                    const a = ANGLES.find((x) => x.id === aid)!;
                    return { id: a.id, label: a.label, description: a.description };
                  })
                : [];
              const built = buildStyleBrief({
                styleId: styleDef.id as BriefStyleId,
                userBrief:
                  ((prevState.description as string | undefined) ?? "") ||
                  ((prevState.linkUrl as string | undefined) ?? "") ||
                  ((prevState.productName as string | undefined) ?? ""),
                format: {
                  aspect: (prevState.aspect as string | undefined) ?? null,
                  lang: (prevState.lang as string | undefined) ?? null,
                  variants: (prevState.variants as number | undefined) ?? null,
                },
                color: color ? { id: color.id, label: color.label, swatch: color.swatch } : null,
                angles: anglesPayload,
                autoCandidates: isAuto ? autoCandidates : null,
              });
              const currentValue =
                typeof editedBriefs[sid] === "string"
                  ? (editedBriefs[sid] as string)
                  : built.technicalBrief;
              const isEdited =
                typeof editedBriefs[sid] === "string" &&
                editedBriefs[sid] !== built.technicalBrief;
              return (
                <div
                  key={sid}
                  className="overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="text-sm font-semibold">{styleDef.label}</div>
                      {isEdited && (
                        <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                          Отредактировано
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      {isEdited && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditedBriefs((prev) => {
                              const next = { ...prev };
                              delete next[sid];
                              return next;
                            });
                            toast.success("ТЗ сброшено к авто");
                          }}
                          className="text-muted-foreground hover:text-foreground hover:underline"
                        >
                          Сбросить
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(currentValue);
                          toast.success("ТЗ скопировано");
                        }}
                        className="text-primary hover:underline"
                      >
                        Копировать
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 px-5 py-4 text-xs sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">Композиция: </span>
                      <span className="text-foreground">{built.structured.composition}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Свет: </span>
                      <span className="text-foreground">{built.structured.lighting}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Ракурс: </span>
                      <span className="text-foreground">{built.structured.cameraAngle}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Цветокор: </span>
                      <span className="text-foreground">{built.structured.colorTreatment}</span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">Типографика: </span>
                      <span className="text-foreground">{built.structured.typography}</span>
                    </div>
                  </div>
                  <div className="border-t border-border bg-background/40 px-5 py-4">
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Финальный промпт (можно редактировать)
                    </label>
                    <textarea
                      value={currentValue}
                      onChange={(e) =>
                        setEditedBriefs((prev) => ({ ...prev, [sid]: e.target.value }))
                      }
                      rows={10}
                      spellCheck={false}
                      className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-xs leading-relaxed text-foreground/90 outline-none transition-colors focus:border-primary/60"
                    />
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Этот текст уйдёт в AI-генератор как финальный промпт.
                    </div>
                  </div>
                </div>
              );
            })}
          </CollapsibleContent>
        </Collapsible>

        {/* Status */}
        {status !== "idle" && (
          <div
            className={cn(
              "mt-6 rounded-2xl border p-4 transition-all",
              status === "sending" && "border-primary/40 bg-primary/5",
              status === "success" && "border-emerald-500/40 bg-emerald-500/10",
              status === "error" && "border-destructive/50 bg-destructive/10",
            )}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              {status === "sending" && (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
              )}
              {status === "success" && (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              )}
              {status === "error" && (
                <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              )}
              <div className="flex-1">
                <div
                  className={cn(
                    "text-sm font-semibold",
                    status === "sending" && "text-foreground",
                    status === "success" &&
                      "text-emerald-600 dark:text-emerald-400",
                    status === "error" && "text-destructive",
                  )}
                >
                  {status === "sending" && "Генерируем креативы..."}
                  {status === "success" && "Готово"}
                  {status === "error" && "Ошибка отправки"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {statusMessage}
                </div>
              </div>
              <div className="text-xs font-mono text-muted-foreground tabular-nums">
                {Math.round(progress)}%
              </div>
            </div>
            <Progress
              value={progress}
              className={cn(
                "mt-3 h-2",
                status === "error" && "[&>div]:bg-destructive",
                status === "success" && "[&>div]:bg-emerald-500",
              )}
            />
          </div>
        )}

        {/* Results */}
        {results && results.length > 0 && (
          <div className="mt-10">
            <h2 className="text-2xl font-bold tracking-tight">
              Результаты генерации
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              По одному варианту на каждый выбранный стиль
            </p>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {results.map((v, i) => (
                <div
                  key={`${v.styleId}-${i}`}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-elevated"
                >
                  <div className="aspect-square w-full overflow-hidden bg-secondary/40">
                    {v.imageUrl ? (
                      <img
                        src={v.imageUrl}
                        alt={`Креатив в стиле ${v.styleLabel}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-pulse text-primary" />
                        <span>
                          Задача отправлена, изображение появится после ответа n8n
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-3">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Стиль
                    </div>
                    <div className="text-sm font-semibold text-foreground">
                      {v.styleLabel}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
};

export default CreateStep3;
