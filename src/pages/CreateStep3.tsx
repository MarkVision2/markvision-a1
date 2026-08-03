import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
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
  Sparkles,
  Camera,
  Wand2,
  User,
  Briefcase,
  Sun,
  Trees,
  Dumbbell,
  Shirt,
  Megaphone,
  Target,
  MessageCircle,
  KeyRound,
  FileCheck,
  Gift,
} from "lucide-react";

import Header from "@/components/factory/Header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CONTENT_TYPES } from "@/data/contentTypes";
import { getContentTypeFlow } from "@/data/contentTypeFlows";
import { postContentFactory } from "@/lib/contentFactory";
import {
  uploadContentFactoryPhotos,
  type UploadedAsset,
} from "@/lib/contentFactoryUpload";
import { CreativeFormatPicker } from "@/components/factory/CreativeFormatPicker";
import {
  AUTO_FORMAT_ID,
  CREATIVE_FORMATS,
  type CreativeFormatId,
} from "@/data/creativeFormats";
import { buildStyleBrief, type StyleId as BriefStyleId } from "@/data/styleBriefs";
import { buildFormatWebhookFields, resolveCreativeFormat } from "@/lib/contentFactoryFormat";
import {
  assertPromptWebhookContract,
  buildBriefWithMarketing,
  buildUserBriefText,
  isBriefTooEmpty,
  loadWizardState,
  persistWizardState,
  resolveProductDescription,
  resolveProductName,
  type WizardInputState,
} from "@/lib/contentFactoryBrief";
import {
  buildAspectWebhookFields,
  normalizeWizardAspect,
  resolveAspectPixels,
} from "@/lib/contentFactoryAspect";
import {
  enrichWizardState,
  resolveWizardFiles,
} from "@/lib/contentFactoryWizardContext";
import {
  brandImageUrls,
  brandPromptBlock,
  buildBrandWebhookFields,
} from "@/lib/contentFactoryBrand";
import {
  buildCopyWebhookFields,
  copyPromptBlock,
  normalizeCopyMode,
} from "@/lib/contentFactoryCopy";
import {
  buildFaceWebhookFields,
  neuroFacePromptBlock,
  resolveFacePipeline,
} from "@/lib/contentFactoryFace";
import {
  assertLogoWebhookContract,
  buildLogoWebhookFields,
  logoPromptBlock,
  peoplePhotosPromptBlock,
} from "@/lib/contentFactoryLogo";
import { readWizardFiles } from "@/lib/wizardFilesStore";
import { useBrandTemplates } from "@/hooks/useBrandTemplates";
import { useContentFactoryGallery } from "@/hooks/useContentFactoryGallery";
import { registerGalleryBatch } from "@/lib/contentFactoryGalleryStore";
import { buildContentFactoryRequestId } from "@/lib/contentFactoryRequestId";
import {
  assertNeuroPhotoPayload,
  buildContentFactoryFormatFields,
  buildContentFactoryImageUrls,
  buildMarketingWebhookFields,
} from "@/lib/contentFactoryPayload";
import {
  buildContentFactoryWebhookPayload,
  buildNicheContext,
} from "@/lib/contentFactoryWebhook";
import {
  isNeuroPhotoTypeId,
  resolveContentTypeRoute,
} from "@/lib/contentFactoryRoutes";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { buildCreativeUsernameWebhookFields } from "@/lib/projectCreativeUsername";
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

type NeuroStyleId =
  | "neuro_business"
  | "neuro_lifestyle"
  | "neuro_studio"
  | "neuro_outdoor"
  | "neuro_fashion"
  | "neuro_sport"
  | "neuro_casual";

type StyleId = CreativeFormatId | NeuroStyleId;

interface StyleDef {
  id: StyleId;
  label: string;
  description: string;
  icon: typeof Users;
  preview: string;
  fallbackSeed: string;
  isAuto?: boolean;
}

const STYLES: StyleDef[] = CREATIVE_FORMATS.map((f) => ({
  id: f.id,
  label: f.label,
  description: f.description,
  icon: f.icon,
  preview: `/style-previews/${f.previewSeed}.png`,
  fallbackSeed: f.previewSeed,
  isAuto: f.isAuto,
}));

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
const AUTO_ID: StyleId = AUTO_FORMAT_ID;

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

type CtaId = "learn_more" | "leave_request" | "get_offer" | "code_word";

const CTAS: {
  id: CtaId;
  label: string;
  phrase: string;
  description: string;
  icon: typeof MessageCircle;
}[] = [
  {
    id: "learn_more",
    label: "Узнать подробнее",
    phrase: "Узнать подробнее →",
    description: "Мягкий переход: сайт, профиль или директ без жёсткой заявки",
    icon: MessageCircle,
  },
  {
    id: "leave_request",
    label: "Оставить заявку",
    phrase: "Оставьте заявку — свяжемся с вами",
    description: "Прямой сбор контакта: форма, WhatsApp или директ",
    icon: FileCheck,
  },
  {
    id: "get_offer",
    label: "Получить предложение",
    phrase: "Получите персональное предложение",
    description: "Оффер / расчёт / КП — следующий шаг после интереса",
    icon: Gift,
  },
  {
    id: "code_word",
    label: "Код-слово",
    phrase: "Пишите код-слово в директ",
    description: "Своё слово на креативе — запускает автоворонку в DM",
    icon: KeyRound,
  },
];

/** Фраза CTA с подстановкой код-слова для оверлея и брифа. */
function resolveCtaPhrase(ctaId: CtaId, codeWord: string): string {
  if (ctaId !== "code_word") {
    return CTAS.find((c) => c.id === ctaId)?.phrase ?? "";
  }
  const word = codeWord.trim() || "ХАБ";
  return `Пишите код-слово «${word}» в директ`;
}

type ToneId = "selling" | "native" | "engaging" | "expert" | "ugc";

const TONES: { id: ToneId; label: string; description: string; icon: typeof Megaphone }[] = [
  {
    id: "selling",
    label: "Продающий",
    description: "Прямой оффер: выгода → доказательство → призыв. Для акций и запусков.",
    icon: Megaphone,
  },
  {
    id: "native",
    label: "Нативный",
    description: "Как совет друга, без «рекламного» тона. Для холодной аудитории.",
    icon: User,
  },
  {
    id: "engaging",
    label: "Вовлекающий",
    description: "Крючок, вопрос, интрига. Цель — реакция, а не сразу продажа.",
    icon: MessageCircle,
  },
  {
    id: "expert",
    label: "Экспертный",
    description: "Факты, цифры, кейсы. Строит доверие перед оффером.",
    icon: Sparkles,
  },
  {
    id: "ugc",
    label: "UGC / отзыв",
    description: "От первого лица, как реальный отзыв. Максимум доверия.",
    icon: Users,
  },
];

type GoalId = "traffic" | "conversions" | "engagement" | "awareness" | "leads";

const GOALS: { id: GoalId; label: string; description: string; icon: typeof Target }[] = [
  {
    id: "traffic",
    label: "Трафик",
    description: "Переходы в профиль / на сайт. Копирайт ведёт «куда кликнуть», CTA — мягкий переход.",
    icon: Users,
  },
  {
    id: "conversions",
    label: "Конверсии",
    description: "Покупка или целевое действие. Жёсткий оффер, выгода, срочность, сильный CTA.",
    icon: Target,
  },
  {
    id: "engagement",
    label: "Вовлечённость",
    description: "Лайки, комменты, сохранения. Провокация и вопрос — CTA на реакцию.",
    icon: MessageCircle,
  },
  {
    id: "awareness",
    label: "Охват",
    description: "Запомнить бренд. Яркий визуал, простое сообщение, без сложного оффера.",
    icon: Megaphone,
  },
  {
    id: "leads",
    label: "Лиды",
    description: "Заявки в директ / WhatsApp. Код-слово или «оставьте заявку» собирают контакт.",
    icon: Send,
  },
];

interface GeneratedVariant {

  styleId: StyleId;
  styleLabel: string;
  imageUrl: string | null;
  raw: unknown;
  error?: string;
  // request_id, который ушёл в n8n для этой задачи. По нему фронт
  // подписывается на supabase realtime и ловит готовое изображение.
  requestId?: string;
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
  const wizardState = loadWizardState((location.state ?? {}) as WizardInputState);
  const { activeId: projectId, active: activeProject } = useProjectsStore();
  const { getById: getBrandTemplate } = useBrandTemplates();
  const { saveItem: saveGalleryItem } = useContentFactoryGallery();
  const brandTemplate = getBrandTemplate(wizardState.brandTemplateId);
  const galleryMetaRef = useRef<{
    batchId: string;
    typeId: string;
    typeTitle: string;
    brandTemplateId: string | null;
    promptsByRequestId: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    // Мержим location + sessionStorage, чтобы не затереть aspect/variants.
    persistWizardState(loadWizardState((location.state ?? {}) as WizardInputState));
  }, [location.state]);

  const neuroAutoSubmit = wizardState.neuroAutoSubmit === true;
  const effectiveTypeId =
    wizardState.typeId ?? (neuroAutoSubmit ? "neuro-photo" : undefined);
  const contentType = CONTENT_TYPES.find((t) => t.id === effectiveTypeId);
  const isNeuroPhoto = isNeuroPhotoTypeId(effectiveTypeId);
  const flow = getContentTypeFlow(effectiveTypeId);
  const autoSubmitStarted = useRef(false);

  /** File[] не сохраняются в sessionStorage — держим из location.state + stash. */
  const initialStash = readWizardFiles();
  const initialState = (location.state ?? {}) as WizardInputState;
  const wizardFilesRef = useRef({
    peoplePhotos: initialState.peoplePhotos?.length
      ? initialState.peoplePhotos
      : initialStash.peoplePhotos,
    photos: initialState.photos?.length ? initialState.photos : initialStash.photos,
    logoFile: initialState.logoFile ?? initialStash.logoFile,
  });

  useEffect(() => {
    const s = (location.state ?? {}) as WizardInputState;
    const stashed = readWizardFiles();
    if (s.peoplePhotos?.length) wizardFilesRef.current.peoplePhotos = s.peoplePhotos;
    else if (stashed.peoplePhotos.length) wizardFilesRef.current.peoplePhotos = stashed.peoplePhotos;
    if (s.photos?.length) wizardFilesRef.current.photos = s.photos;
    else if (stashed.photos.length) wizardFilesRef.current.photos = stashed.photos;
    if (s.logoFile) wizardFilesRef.current.logoFile = s.logoFile;
    else if (stashed.logoFile) wizardFilesRef.current.logoFile = stashed.logoFile;
  }, [location.state]);

  useEffect(() => {
    if (!neuroAutoSubmit || autoSubmitStarted.current) return;
    const selfies =
      wizardFilesRef.current.peoplePhotos.length ||
      (wizardState.peoplePhotos?.length ?? 0);
    if (!isNeuroPhotoTypeId(effectiveTypeId) || selfies === 0) return;
    autoSubmitStarted.current = true;
    const t = window.setTimeout(() => void handleCreate(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neuroAutoSubmit, effectiveTypeId, wizardState.peoplePhotos?.length]);

  const activeStyles = isNeuroPhoto ? NEURO_STYLES : STYLES;
  const allowedCreativeFormats = (flow.step3.allowedCreativeFormats ?? []) as CreativeFormatId[];
  const defaultStyle: StyleId = isNeuroPhoto
    ? "neuro_business"
    : allowedCreativeFormats.includes("auto")
      ? "auto"
      : (allowedCreativeFormats[0] as StyleId) || "auto";
  const initialStylesRaw =
    wizardState.selectedStyles?.length
      ? (wizardState.selectedStyles as StyleId[])
      : [defaultStyle];
  const initialStyles =
    !isNeuroPhoto && allowedCreativeFormats.length
      ? initialStylesRaw.filter((id) => allowedCreativeFormats.includes(id as CreativeFormatId))
      : initialStylesRaw;
  const safeInitialStyles = initialStyles.length ? initialStyles : [defaultStyle];
  const initialAngles: AngleId[] =
    wizardState.selectedAngles?.length
      ? (wizardState.selectedAngles as AngleId[])
      : isNeuroPhoto
        ? (["front", "three_quarter"] as AngleId[])
        : [];


  const [selectedStyles, setSelectedStyles] = useState<StyleId[]>(safeInitialStyles);
  const [selectedAngles, setSelectedAngles] = useState<AngleId[]>(initialAngles);
  const [colorId, setColorId] = useState<ColorId>(
    (wizardState.colorId as ColorId) ?? "auto",
  );
  const [ctaId, setCtaId] = useState<CtaId>(() => {
    const raw = wizardState.ctaId as CtaId | undefined;
    return CTAS.some((c) => c.id === raw) ? (raw as CtaId) : "learn_more";
  });
  const [codeWord, setCodeWord] = useState(
    (wizardState.codeWord ?? "").trim() || "Хаб",
  );
  const [toneId, setToneId] = useState<ToneId>(
    (wizardState.toneId as ToneId) ?? "selling",
  );
  const [goalId, setGoalId] = useState<GoalId>(
    (wizardState.goalId as GoalId) ?? "conversions",
  );
  // Format с шага 2 — в локальном state, чтобы webhook не зависел от потерянного location.state.
  const [aspect] = useState(
    () =>
      normalizeWizardAspect(wizardState.aspect) ??
      flow.step2.defaultAspect ??
      "1:1",
  );
  const [lang] = useState(() => wizardState.lang ?? "ru");
  const [variants] = useState(() => {
    const v = wizardState.variants;
    if (typeof v === "number" && v > 0) return v;
    return flow.step2.defaultVariants ?? 3;
  });


  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "sending" | "queued" | "success" | "error"
  >("idle");
  const [taskStartedAt, setTaskStartedAt] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<GeneratedVariant[] | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  // Отредактированные пользователем ТЗ (по styleId). Если пусто — используется авто-бриф.
  const [editedBriefs, setEditedBriefs] = useState<Partial<Record<StyleId, string>>>({});
  // Ref на актуальные results — чтобы realtime-обработчик не зависел от
  // closure и не пере-подписывался при каждом обновлении карточки.
  const resultsRef = useRef<GeneratedVariant[] | null>(null);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  // Realtime подписка: ловим INSERT/UPDATE в content_factory_results и
  // подменяем imageUrl в нужной карточке по request_id. n8n воркфлоу
  // должен сделать INSERT в эту таблицу после каждого готового слайда.
  useEffect(() => {
    if (!results || results.length === 0) return;
    const requestIds = Array.from(
      new Set(results.map((r) => r.requestId).filter(Boolean) as string[]),
    );
    if (requestIds.length === 0) return;

    const idSet = new Set(requestIds);

    const applyRow = (row: {
      request_id?: string;
      status?: string;
      image_url?: string | null;
      error_message?: string | null;
    }) => {
      if (!row.request_id || !idSet.has(row.request_id)) return;
      setResults((prev) => {
        if (!prev) return prev;
        let touched = false;
        const next = prev.map((v) => {
          if (v.requestId !== row.request_id) return v;
          if (row.status === "ready" && row.image_url) {
            touched = true;
            const meta = galleryMetaRef.current;
            if (meta && v.requestId) {
              void saveGalleryItem({
                requestId: v.requestId,
                sessionId: meta.batchId,
                typeId: meta.typeId,
                typeTitle: meta.typeTitle,
                styleId: v.styleId,
                styleLabel: v.styleLabel,
                imageUrl: row.image_url,
                promptSnapshot: meta.promptsByRequestId[v.requestId],
                brandTemplateId: meta.brandTemplateId,
                metadata: { source: "realtime" },
              });
            }
            return { ...v, imageUrl: row.image_url, error: undefined };
          }
          if (row.status === "error") {
            touched = true;
            return {
              ...v,
              error: row.error_message || "Генератор вернул ошибку",
            };
          }
          return v;
        });
        if (!touched) return prev;
        // Если все карточки получили картинку — переводим общий статус в success.
        const allReady = next.every((v) => v.imageUrl || v.error);
        if (allReady) {
          setStatus("success");
          const readyCount = next.filter((v) => v.imageUrl).length;
          setStatusMessage(
            `Готово: ${readyCount} ${readyCount === 1 ? "вариант" : "варианта(ов)"} сгенерировано`,
          );
          toast.success("Креативы готовы", {
            description: next
              .filter((v) => v.imageUrl)
              .map((v) => v.styleLabel)
              .join(" · "),
          });
        }
        return next;
      });
    };

    if (!clientConfigSupabase) return;
    const sb = clientConfigSupabase;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (sb as any)
      .channel(`content-factory:${requestIds.join(",")}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "content_factory_results",
        },
        (payload: { new: Record<string, unknown> }) =>
          applyRow(payload.new as Parameters<typeof applyRow>[0]),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "content_factory_results",
        },
        (payload: { new: Record<string, unknown> }) =>
          applyRow(payload.new as Parameters<typeof applyRow>[0]),
      )
      .subscribe();

    // На случай, если строка успела появиться до подписки (race),
    // делаем initial fetch.
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (sb as any)
        .from("content_factory_results")
        .select("request_id,status,image_url,error_message")
        .in("request_id", requestIds);
      if (error) return;
      (data ?? []).forEach((row: Parameters<typeof applyRow>[0]) =>
        applyRow(row),
      );
    })();

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb as any).removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results?.map((r) => r.requestId).join("|")]);

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
    if (flow.step3.showCta && ctaId === "code_word" && !codeWord.trim()) {
      toast.error("Введите код-слово", {
        description: "Оно отобразится на креативе — например «Хаб».",
      });
      return;
    }
    const selfieCount =
      wizardFilesRef.current.peoplePhotos.length ||
      (wizardState.peoplePhotos?.length ?? 0);

    const wizardFiles = resolveWizardFiles(wizardState, wizardFilesRef.current);
    const wizardForValidation = enrichWizardState(wizardState, wizardFiles);

    if (!isNeuroPhoto && isBriefTooEmpty(wizardForValidation)) {
      toast.error("ТЗ пустое", {
        description: "Вернитесь на шаг 1: добавьте ссылку, описание, логотип или фото.",
      });
      return;
    }
    if (
      !isNeuroPhoto &&
      normalizeCopyMode(wizardState.copyMode) === "custom" &&
      !(wizardState.overlayText ?? "").trim()
    ) {
      toast.error("Введите текст для наложения", {
        description: "Режим «Вставить свой текст» — укажите точную подпись на шаге 1.",
      });
      return;
    }
    if (isNeuroPhoto && selfieCount === 0) {
      toast.error("Загрузите фото человека", {
        description: "Для нейрофотосессии нужно селфи или портрет.",
      });
      return;
    }
    if (isNeuroPhoto && !clientConfigSupabase) {
      toast.error("Storage Clony не настроен", {
        description:
          "Задайте VITE_CLIENT_SUPABASE_URL и VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY в Lovable → Environment.",
      });
      return;
    }
    persistWizardState({
      colorId,
      ctaId,
      codeWord: ctaId === "code_word" ? codeWord.trim() : undefined,
      toneId,
      goalId,
      aspect,
      lang,
      variants,
      selectedStyles,
      selectedAngles,
    });

    setSubmitting(true);
    setResults(null);
    setStatus("sending");
    setStatusMessage("Подготавливаем данные...");
    setProgress(10);
    setTaskDialogOpen(true);
    setTaskStartedAt(Date.now());

    let progressTimer: ReturnType<typeof setInterval> | null = null;
    try {
      const ctaBase = CTAS.find((c) => c.id === ctaId)!;
      const cta = {
        ...ctaBase,
        phrase: resolveCtaPhrase(ctaId, codeWord),
      };
      const tone = TONES.find((t) => t.id === toneId)!;
      const goal = GOALS.find((g) => g.id === goalId)!;
      const color = COLORS.find((c) => c.id === colorId);
      const mode = wizardState.mode ?? (isNeuroPhoto ? "photo" : null);

      // Одна партия = один batch_id. По нему аплоад фото и подписка на realtime.
      const batchId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Аплоад фото в Supabase Storage ДО сборки промта и n8n.
      // n8n читает image_urls: string[] из body — multipart-файлы не парсит.
      let logoUrl: string | null = null;
      let uploadedPeople: UploadedAsset[] = [];
      let uploadedAssets: UploadedAsset[] = [];

      const uploadTotal =
        (wizardFiles.logoFile ? 1 : 0) +
        (mode === "photo" ? wizardFiles.peoplePhotos.length + wizardFiles.photos.length : 0);

      if (uploadTotal > 0) {
        setStatusMessage(`Загружаем ${uploadTotal} файл(ов)…`);
        setProgress(15);
      }

      if (wizardFiles.logoFile) {
        if (!clientConfigSupabase) {
          throw new Error(
            "Storage для логотипа не настроен. Задайте VITE_CLIENT_SUPABASE_URL и VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY в Lovable → Environment Variables.",
          );
        }
        const logoAssets = await uploadContentFactoryPhotos([wizardFiles.logoFile], batchId, "logo");
        logoUrl = logoAssets[0]?.url ?? null;
        if (!logoUrl) {
          throw new Error(
            "Логотип не загрузился в Storage (bucket content-factory-uploads). Проверьте права bucket и повторите.",
          );
        }
      }

      if ((mode === "photo" || isNeuroPhoto) && wizardFiles.peoplePhotos.length > 0) {
        uploadedPeople = await uploadContentFactoryPhotos(wizardFiles.peoplePhotos, batchId, "people");
        if (uploadedPeople.length < wizardFiles.peoplePhotos.length) {
          toast.warning(
            `Загружено ${uploadedPeople.length} из ${wizardFiles.peoplePhotos.length} фото людей`,
            { description: "Часть файлов не залилась — генерация пойдёт без них." },
          );
        }
      }

      if (mode === "photo" && wizardFiles.photos.length > 0) {
        uploadedAssets = await uploadContentFactoryPhotos(wizardFiles.photos, batchId, "assets");
        if (uploadedAssets.length < wizardFiles.photos.length) {
          toast.warning(
            `Загружено ${uploadedAssets.length} из ${wizardFiles.photos.length} фото`,
            { description: "Часть файлов не залилась — генерация пойдёт без них." },
          );
        }
      }

      const enrichedWizard = enrichWizardState(wizardState, wizardFiles, logoUrl);
      const briefPromptWithMeta = isNeuroPhoto
        ? buildUserBriefText(enrichedWizard)
        : buildBriefWithMarketing(enrichedWizard, {
            goalLabel: goal.label,
            goalDescription: goal.description,
            toneLabel: tone.label,
            toneDescription: tone.description,
            ctaPhrase: cta.phrase,
          });
      const brief = {
        prompt: briefPromptWithMeta,
        mode,
        linkUrl: enrichedWizard.linkUrl ?? "",
        description: enrichedWizard.description ?? "",
        productName: enrichedWizard.productName ?? "",
        extraInstructions: enrichedWizard.extraInstructions ?? "",
        photoMeta: wizardFiles.photos.map((f, idx) => ({
          index: idx,
          field: `photo_${idx}`,
          name: f.name,
          mimeType: f.type,
          size: f.size,
        })),
        photos: wizardFiles.photos,
        peoplePhotos: wizardFiles.peoplePhotos,
        peoplePhotoMeta: wizardFiles.peoplePhotos.map((f, idx) => ({
          index: idx,
          field: `people_photo_${idx}`,
          name: f.name,
          mimeType: f.type,
          size: f.size,
        })),
        logoFile: wizardFiles.logoFile,
      };

      const peoplePhotoUrls = uploadedPeople.map((a) => a.url);
      const productPhotoUrls = uploadedAssets.map((a) => a.url);
      const effectiveLogoUrl = isNeuroPhoto
        ? null
        : (logoUrl ?? brandTemplate?.logo_url ?? null);

      if (isNeuroPhoto && peoplePhotoUrls.length === 0 && brief.peoplePhotos.length > 0) {
        throw new Error(
          "Селфи не загрузилось в Storage. Проверьте VITE_CLIENT_SUPABASE_URL в настройках Lovable.",
        );
      }

      const batchTypeId = (effectiveTypeId ?? contentType?.id ?? "") as string;
      const batchFacePipeline = resolveFacePipeline({
        typeId: batchTypeId,
        isNeuroPhotoType: isNeuroPhoto,
        inputMode: brief.mode ?? (isNeuroPhoto ? "photo" : null),
        peoplePhotosCount: brief.peoplePhotos.length,
      });
      const imageUrls = buildContentFactoryImageUrls({
        isNeuroPhoto,
        facePipeline: batchFacePipeline,
        logoUrl: effectiveLogoUrl,
        peoplePhotoUrls,
        productPhotoUrls,
        brandUrls: brandImageUrls(brandTemplate).filter((u) => u !== effectiveLogoUrl),
      });

      const marketingFields = buildMarketingWebhookFields({
        step3: flow.step3,
        isNeuroPhoto,
        cta,
        tone,
        goal,
        codeWord: ctaId === "code_word" ? codeWord.trim() : "",
      });

      galleryMetaRef.current = {
        batchId,
        typeId: effectiveTypeId ?? contentType?.id ?? "",
        typeTitle: contentType?.title ?? "",
        brandTemplateId: brandTemplate?.id ?? null,
        promptsByRequestId: {},
      };

      if (projectId) {
        registerGalleryBatch({
          batchId,
          projectId,
          typeId: galleryMetaRef.current.typeId,
          typeTitle: galleryMetaRef.current.typeTitle,
          brandTemplateId: galleryMetaRef.current.brandTemplateId,
          createdAt: new Date().toISOString(),
          items: selectedStyles.map((styleId) => {
            const styleDef = activeStyles.find((s) => s.id === styleId)!;
            return {
              requestId: buildContentFactoryRequestId(
                projectId ?? "",
                batchId,
                styleDef.id,
              ),
              styleId: styleDef.id,
              styleLabel: styleDef.label,
            };
          }),
        });
      }

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
          const typeId = (effectiveTypeId ?? contentType?.id ?? "") as string;
          const facePipeline = resolveFacePipeline({
            typeId,
            isNeuroPhotoType: isNeuroPhoto,
            inputMode: brief.mode ?? (isNeuroPhoto ? "photo" : null),
            peoplePhotosCount: brief.peoplePhotos.length,
          });
          const task = facePipeline.task;
          const route = resolveContentTypeRoute(typeId);
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
              aspect,
              lang,
              variants,
            },
            color: color
              ? { id: color.id, label: color.label, swatch: color.swatch }
              : null,
            angles: anglesPayload,
            autoCandidates: isAuto ? autoCandidates : null,
          });
          const aspectFields = buildAspectWebhookFields(aspect);
          let finalTechnicalBriefBase = built.technicalBrief;
          if (aspectFields.briefLine) {
            finalTechnicalBriefBase = `${aspectFields.briefLine}\n\n${finalTechnicalBriefBase}`;
          }

          // Если пользователь отредактировал ТЗ — отправляем его, иначе авто.
          const userEdited =
            typeof editedBriefs[styleDef.id] === "string" &&
            (editedBriefs[styleDef.id] as string).trim().length > 0 &&
            editedBriefs[styleDef.id] !== finalTechnicalBriefBase;
          let finalTechnicalBrief = userEdited
            ? (editedBriefs[styleDef.id] as string)
            : finalTechnicalBriefBase;
          if (!isNeuroPhoto && effectiveLogoUrl) {
            finalTechnicalBrief = `${finalTechnicalBrief}\n\n--- Логотип ---\n${logoPromptBlock(effectiveLogoUrl)}`;
          }
          if (facePipeline.enabled) {
            finalTechnicalBrief = `${finalTechnicalBrief}\n\n--- Нейрофотосессия / лицо ---\n${neuroFacePromptBlock(
              brief.peoplePhotos.length,
              facePipeline.pipeline,
              contentType?.title,
            )}`;
          } else if (!isNeuroPhoto && brief.mode === "photo" && brief.peoplePhotos.length > 0) {
            finalTechnicalBrief = `${finalTechnicalBrief}\n\n--- Фото людей ---\n${peoplePhotosPromptBlock(brief.peoplePhotos.length)}`;
          }
          if (!isNeuroPhoto && brandTemplate) {
            finalTechnicalBrief = `${finalTechnicalBrief}\n\n--- Бренд ---\n${brandPromptBlock(brandTemplate)}`;
          }
          const copyMode = isNeuroPhoto ? "auto" : normalizeCopyMode(wizardState.copyMode);
          const overlayText = isNeuroPhoto ? "" : (wizardState.overlayText ?? "").trim();
          if (!isNeuroPhoto) {
            finalTechnicalBrief = `${finalTechnicalBrief}\n\n--- Текст на креативе ---\n${copyPromptBlock(copyMode, overlayText)}`;
          }

          const requestId = buildContentFactoryRequestId(
            projectId ?? "",
            batchId,
            styleDef.id,
          );
          if (galleryMetaRef.current) {
            galleryMetaRef.current.promptsByRequestId[requestId] = finalTechnicalBrief;
          }

          const brandFields = isNeuroPhoto
            ? buildBrandWebhookFields(null)
            : buildBrandWebhookFields(brandTemplate);
          const copyFields = isNeuroPhoto
            ? { copy_mode: "auto", overlay_text: "", overlay_text_required: false, use_exact_overlay_text: false, extra_instructions: brief.extraInstructions ?? "" }
            : buildCopyWebhookFields(copyMode, overlayText, brief.extraInstructions);
          const logoFields = isNeuroPhoto
            ? buildLogoWebhookFields(null)
            : buildLogoWebhookFields(
                effectiveLogoUrl,
                logoUrl ? "wizard_upload" : brandTemplate?.logo_url ? "brand_template" : "",
              );
          const faceFields = buildFaceWebhookFields({
            resolution: facePipeline,
            peoplePhotoUrls,
            outputContentType: route,
            outputFormatLabel: contentType?.title,
          });

          // ВАЖНО: эти ключи (content_type, prompt, name, description, link,
          // image_urls, color, style, language, aspect, slides, fb_niche,
          // ctas, request_id, ...) читаются нодами n8n воркфлоу "Clony AI"
          // напрямую из $node["Webhook"].json.body. Если их переименовать
          // или вложить — AI начнёт галлюцинировать (см. кейс "часы вместо
          // мир без границ"). Менять имена этих полей только синхронно с
          // workflow в https://n8n.zapoinov.com/workflow/dCQ20aXv6B9LRjDe
          // Один request_id на стиль — фронт по нему ловит результат
          // в content_factory_results через realtime.
          const slidesCount =
            typeof variants === "number" && variants > 0
              ? variants
              : 1;
          // Niche / контекст — собираем из всех источников ТЗ.
          const nicheBits = buildNicheContext({
            productName: brief.productName,
            description: brief.description,
            linkUrl: brief.linkUrl,
            extraInstructions: brief.extraInstructions,
          });
          // ВАЖНО: опциональные поля (audio_url, link) НЕ включаем когда они
          // пустые — n8n IF-ноды проверяют их через `exists`, пустая строка
          // проходит как существующая, и последующие HTTP/audio ноды падают
          // с "Invalid URL". Используем undefined чтобы ключ не попал в JSON.
          const linkValue =
            brief.mode === "link" && brief.linkUrl ? brief.linkUrl : undefined;
          const creativeFormat = !isNeuroPhoto ? resolveCreativeFormat(styleDef.id) : null;
          const formatFields = buildContentFactoryFormatFields({
            isNeuroPhoto,
            styleId: styleDef.id,
            styleLabel: styleDef.label,
            creativeFormatFields: creativeFormat
              ? buildFormatWebhookFields(creativeFormat)
              : null,
          });

          const flatForN8n: Record<string, unknown> = {
            // routing ключ для Switch1 (читает body.content_type)
            content_type: route,
            // основной brief — это поле читает каждая chainLlm-нода как "ТЗ".
            // Сюда идёт finalTechnicalBrief — полная техзадача со стилевыми
            // инструкциями и пользовательским запросом, а не сырой текст.
            prompt: finalTechnicalBrief,
            // n8n-ноды иногда читают name/description вместо prompt — не оставляем пустыми
            name: resolveProductName(enrichedWizard, contentType?.title),
            description: resolveProductDescription(enrichedWizard, finalTechnicalBrief),
            // Публичные URL фото из Supabase Storage. n8n берёт первое как референс.
            image_urls: imageUrls,
            ...formatFields,
            color: color?.label ?? "auto",
            color_id: color?.id ?? "auto",
            color_swatch: color?.swatch && color.swatch !== "custom" ? color.swatch : "",
            language: lang ?? "ru",
            ...aspectFields.flat,
            slides: slidesCount,
            image_count: slidesCount,
            variants: slidesCount,
            // niche / cta — содержательные сведения о продукте для fb-target.
            fb_niche: nicheBits,
            ...marketingFields.flat,
            generation_pipeline: facePipeline.pipeline,
            platform: "web",
            // tracking
            request_id: requestId,
            session_id: batchId,
            input_mode: brief.mode,
            project_id: projectId ?? "",
            people_photo_urls: peoplePhotoUrls,
            product_photo_urls: productPhotoUrls,
            ...copyFields,
            ...faceFields,
            ...logoFields,
            ...brandFields,
            ...buildCreativeUsernameWebhookFields(activeProject?.creativeUsername),
          };
          // Опциональные поля только если есть значение — иначе n8n IF=exists
          // пропустит пустую строку дальше и HTTP-нода упадёт.
          if (linkValue) flatForN8n.link = linkValue;
          // audio_url намеренно НЕ выставляем — нет аудио в content-factory.

          // Wizard-логотип приоритетнее brand_template — фиксируем оба ключа для n8n.
          if (effectiveLogoUrl) {
            flatForN8n.logo_url = effectiveLogoUrl;
            flatForN8n.brand_logo_url = effectiveLogoUrl;
          }

          const logoCheck = assertLogoWebhookContract(
            Boolean(brief.logoFile),
            flatForN8n,
            imageUrls,
          );
          if (!logoCheck.ok) {
            throw new Error(`Логотип не попал в webhook: ${(logoCheck as { ok: false; reason: string }).reason}`);
          }


          if (isNeuroPhoto) {
            const check = assertNeuroPhotoPayload({
              content_type: flatForN8n.content_type as string,
              route,
              task,
              generation_pipeline: facePipeline.pipeline,
              neuro_photo_session: Boolean(faceFields.neuro_photo_session),
              face_reference_enabled: Boolean(faceFields.face_reference_enabled),
              photos_role: String(faceFields.photos_role ?? ""),
              people_photo_urls: peoplePhotoUrls,
              primary_face_url: String(faceFields.primary_face_url ?? ""),
              image_urls: imageUrls,
            });
            if (!check.ok) {
              throw new Error(`Нейрофото: ${(check as { ok: false; reason: string }).reason}`);
            }
          }

          if (!isNeuroPhoto) {
            const promptCheck = assertPromptWebhookContract(finalTechnicalBrief, enrichedWizard);
            if (!promptCheck.ok) {
              throw new Error((promptCheck as { ok: false; reason: string }).reason);
            }

          }

          const contentTypeBlock = contentType
            ? {
                id: contentType.id,
                title: contentType.title,
                subtitle: contentType.subtitle,
                category: contentType.category,
                tooltip: contentType.tooltip,
              }
            : { id: wizardState.typeId ?? null };

          const sourceInputBlock = {
            mode: brief.mode,
            linkUrl: brief.linkUrl || null,
            description: brief.description || null,
            productName: brief.productName || null,
            photosCount: brief.photos.length,
            peoplePhotosCount: brief.peoplePhotos.length,
            photos: brief.photoMeta,
            peoplePhotos: brief.peoplePhotoMeta,
            logo: brief.logoFile
              ? {
                  name: brief.logoFile.name,
                  mimeType: brief.logoFile.type,
                  size: brief.logoFile.size,
                  url: effectiveLogoUrl,
                }
              : null,
            brandTemplateId: wizardState.brandTemplateId ?? null,
            photosRole: facePipeline.photosRole,
            facePipeline: facePipeline.pipeline,
            faceReferenceEnabled: facePipeline.enabled,
            copyMode,
            overlayText: copyMode === "custom" ? overlayText : null,
            extraInstructions: brief.extraInstructions || null,
            hasLogo: Boolean(brief.logoFile || enrichedWizard.hasLogo),
            logoUrl: effectiveLogoUrl,
            ...buildCreativeUsernameWebhookFields(activeProject?.creativeUsername),
          };

          const formatBlock = {
            aspect,
            lang,
            variants,
            ...(() => {
              const px = resolveAspectPixels(aspect);
              return px
                ? { width: px.width, height: px.height, aspect_ratio: px.aspect }
                : {};
            })(),
          };

          const designBlock = {
            style: selectedStyles,
            currentStyle: {
              id: styleDef.id,
              label: styleDef.label,
              description: styleDef.description,
              auto: isAuto,
              brief: built.structured,
              technicalBrief: finalTechnicalBrief,
              userEdited,
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
          };

          const payload = buildContentFactoryWebhookPayload({
            flat: flatForN8n,
            finalTechnicalBrief,
            userRawPrompt: brief.prompt,
            task,
            route,
            typeId,
            category: contentType?.category ?? null,
            sourceInput: sourceInputBlock,
            formatBlock,
            designBlock,
            marketingBlock: marketingFields.nested,
            contentTypeBlock,
            angles: anglesPayload.length ? anglesPayload : undefined,
            autoCandidates: isAuto ? autoCandidates : null,
          });


          // Шлём JSON. Фото уже залиты в Supabase Storage и присутствуют
          // в payload.image_urls. n8n при multipart клал бы всё в
          // body.payload как строку, и body.content_type / .prompt были бы
          // undefined — AI сгенерил бы шляпу вместо ТЗ.
          const data = await postContentFactory(payload);
          const syncImageUrl = extractImageUrl(data);
          if (syncImageUrl && galleryMetaRef.current) {
            void saveGalleryItem({
              requestId,
              sessionId: galleryMetaRef.current.batchId,
              typeId: galleryMetaRef.current.typeId,
              typeTitle: galleryMetaRef.current.typeTitle,
              styleId: styleDef.id,
              styleLabel: styleDef.label,
              imageUrl: syncImageUrl,
              promptSnapshot: finalTechnicalBrief,
              brandTemplateId: galleryMetaRef.current.brandTemplateId,
              metadata: { source: "sync" },
            });
          }
          return {
            styleId: styleDef.id,
            styleLabel: styleDef.label,
            imageUrl: syncImageUrl,
            raw: data,
            requestId,
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
        } as GeneratedVariant;
      });

      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      setProgress(100);
      const okCount = variants.filter((v) => !v.error).length;
      const failCount = variants.length - okCount;
      const readyCount = variants.filter((v) => !v.error && v.imageUrl).length;
      setResults(variants);

      const meta = galleryMetaRef.current;
      if (meta && projectId) {
        for (const v of variants) {
          if (!v.imageUrl || !v.requestId) continue;
          void saveGalleryItem({
            requestId: v.requestId,
            sessionId: meta.batchId,
            typeId: meta.typeId,
            typeTitle: meta.typeTitle,
            styleId: v.styleId,
            styleLabel: v.styleLabel,
            imageUrl: v.imageUrl,
            promptSnapshot: meta.promptsByRequestId[v.requestId],
            brandTemplateId: meta.brandTemplateId,
            metadata: { source: "batch-complete" },
          });
        }
      }

      if (okCount === 0) {
        setStatus("error");
        setStatusMessage(
          variants[0]?.error ?? "Не удалось поставить задачу",
        );
        toast.error("Все варианты упали", {
          description: variants[0]?.error,
        });
      } else if (readyCount === 0) {
        // n8n принял задачу, но картинку ещё не вернул — это нормальный
        // асинхронный режим. Не врём пользователю «готово».
        setStatus("queued");
        setStatusMessage(
          `Задача поставлена дизайнеру: ${okCount} ${okCount === 1 ? "вариант" : "вариант(а/ов)"} в работе. Результат появится автоматически.`,
        );
        toast.success("Задача поставлена в работу", {
          description: "Дизайнер начал генерацию. Это может занять до пары минут.",
        });
      } else {
        setStatus("success");
        setStatusMessage(
          failCount > 0
            ? `Готово: ${readyCount} из ${variants.length} (${failCount} с ошибкой)`
            : `Готово: ${readyCount} ${readyCount === 1 ? "вариант" : "варианта(ов)"} сгенерировано`,
        );
        toast.success("Креативы готовы", {
          description: variants
            .filter((v) => !v.error && v.imageUrl)
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

  const startNewDesign = () => {
    setTaskDialogOpen(false);
    try {
      sessionStorage.removeItem("mv:create-wizard:v1");
    } catch {
      /* ignore */
    }
    navigate("/");
  };

  return (
    <main className="min-h-screen">
      <Header onClose={() => navigate("/")} />

      {neuroAutoSubmit && (
        <section className="container flex min-h-[40vh] max-w-lg flex-col items-center justify-center gap-4 py-16 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <h1 className="text-xl font-semibold">Генерируем нейрофотосессию…</h1>
          <p className="text-sm text-muted-foreground">{statusMessage || "Подготавливаем данные"}</p>
        </section>
      )}

      {!neuroAutoSubmit && (
      <section className="container max-w-4xl pt-6 pb-16 animate-fade-in-up">
        <div className="inline-flex items-center rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Шаг 3 из {flow.totalSteps}
        </div>

        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          {flow.step3.label}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          {flow.step3.subtitle}
        </p>

        {/* Формат с шага 2 — что реально уйдёт в webhook */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/50 px-4 py-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">В ТЗ</span>
          <span className="rounded-lg bg-primary/15 px-2.5 py-1 font-semibold text-primary">
            {aspect}
            {(() => {
              const px = resolveAspectPixels(aspect);
              return px ? ` · ${px.width}×${px.height}` : "";
            })()}
          </span>
          <span className="rounded-lg bg-secondary/80 px-2.5 py-1 text-foreground">
            {variants} {variants === 1 ? "вариант" : "вариантов"}
          </span>
          <span className="rounded-lg bg-secondary/80 px-2.5 py-1 text-muted-foreground">
            {lang === "kz" ? "KZ" : lang === "en" ? "EN" : "RU"}
          </span>
          <button
            type="button"
            onClick={() => navigate("/create/step-2", { state: loadWizardState(wizardState) })}
            className="ml-auto text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Изменить формат
          </button>
        </div>

        {/* Format / style multi-select */}
        {(flow.step3.showCreativeFormats || flow.step3.showNeuroStyles) && (
        <div className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
                <Palette className="h-4 w-4" />
              </span>
              {isNeuroPhoto ? "Стиль съёмки" : "Формат"}
            </div>
            <div className="text-xs text-muted-foreground">
              Выбрано:{" "}
              <span className="font-semibold text-foreground">
                {selectedStyles.length}
              </span>
              {!isNeuroPhoto && allowedCreativeFormats.length > 0
                ? null
                : (
                  <>
                    {" "}
                    / {MAX_STYLES}
                  </>
                )}
            </div>
          </div>

          {isNeuroPhoto ? (
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
                      "group relative flex w-full flex-col overflow-hidden rounded-2xl border bg-card/60 text-left transition-all duration-300",
                      " hover:border-primary/40 ",
                      selected
                        ? "border-primary/50 ring-1 ring-primary/30"
                        : "border-border/60",
                    )}
                  >
                    <div className="relative aspect-[5/3] w-full overflow-hidden bg-secondary/40">
                      <StylePreviewImage style={s} selected={selected} />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/90 via-card/10 to-transparent" />
                      {selected && order !== null && (
                        <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground ">
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
          ) : (
            <div className="mt-4">
              <CreativeFormatPicker
                selected={selectedStyles as CreativeFormatId[]}
                onToggle={(id) => toggleStyle(id)}
                allowed={
                  allowedCreativeFormats.length
                    ? allowedCreativeFormats
                    : undefined
                }
              />
            </div>
          )}
        </div>
        )}

        {/* Angles — only for neuro photo */}
        {flow.step3.showAngles && (
          <div className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
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
                        ? "border-primary bg-primary/10 text-primary "
                        : "border-border bg-card text-foreground hover:border-primary/40",
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

        {/* Goal */}
        {flow.step3.showGoal && (
        <div className="mt-10">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <Target className="h-4 w-4" />
            </span>
            Цель контента
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Логика: цель задаёт акценты копирайта и силу CTA. Трафик — мягкий переход; конверсии — жёсткий оффер;
            вовлечённость — реакция; охват — запомнить бренд; лиды — собрать контакт.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GOALS.map((g) => {
              const Icon = g.icon;
              const selected = goalId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGoalId(g.id)}
                  aria-pressed={selected}
                  className={cn(
                    "group relative flex flex-col items-start gap-2 rounded-2xl border bg-card/60 p-4 text-left transition touch-manipulation active:scale-[0.99]",
                    " hover:border-primary/40 ",
                    selected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30" : "border-border/60",
                  )}
                >
                  <span className={cn(
                    "grid h-8 w-8 place-items-center rounded-lg",
                    selected ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="text-sm font-semibold text-foreground">{g.label}</div>
                  <div className="text-xs leading-snug text-muted-foreground">{g.description}</div>
                  {selected && (
                    <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* Tone */}
        {flow.step3.showTone && (
        <div className="mt-10">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <Megaphone className="h-4 w-4" />
            </span>
            Стиль подачи
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Как говорит креатив: продающий — прямо; нативный — как совет; вовлекающий — крючок;
            экспертный — факты; UGC — «как отзыв».
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TONES.map((t) => {
              const Icon = t.icon;
              const selected = toneId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setToneId(t.id)}
                  aria-pressed={selected}
                  className={cn(
                    "group relative flex flex-col items-start gap-2 rounded-2xl border bg-card/60 p-4 text-left transition touch-manipulation active:scale-[0.99]",
                    " hover:border-primary/40 ",
                    selected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30" : "border-border/60",
                  )}
                >
                  <span className={cn(
                    "grid h-8 w-8 place-items-center rounded-lg",
                    selected ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="text-sm font-semibold text-foreground">{t.label}</div>
                  <div className="text-xs leading-snug text-muted-foreground">{t.description}</div>
                  {selected && (
                    <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* CTA */}
        {flow.step3.showCta && (
        <div className="mt-10">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <MessageCircle className="h-4 w-4" />
            </span>
            Призыв к действию (CTA)
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Эта фраза попадёт в подпись и оверлей креатива. Код-слово — пишете сами, оно же отобразится на макете.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CTAS.map((c) => {
              const Icon = c.icon;
              const selected = ctaId === c.id;
              const phrase =
                c.id === "code_word" ? resolveCtaPhrase("code_word", codeWord) : c.phrase;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCtaId(c.id)}
                  aria-pressed={selected}
                  className={cn(
                    "group relative flex flex-col items-start gap-2 rounded-2xl border bg-card/60 p-4 text-left transition touch-manipulation active:scale-[0.99]",
                    " hover:border-primary/40 ",
                    selected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30" : "border-border/60",
                  )}
                >
                  <div className="flex w-full items-center gap-2.5 pr-6">
                    <span
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                        selected ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="text-sm font-semibold text-foreground">{c.label}</div>
                  </div>
                  <div className="text-xs italic text-primary/90 line-clamp-2">«{phrase}»</div>
                  <div className="text-[11px] leading-snug text-muted-foreground">{c.description}</div>
                  {selected && (
                    <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {ctaId === "code_word" && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card">
              <div className="grid gap-4 p-4 sm:grid-cols-[1fr_minmax(140px,180px)] sm:items-end">
                <div className="space-y-2">
                  <label htmlFor="code-word-input" className="text-sm font-semibold text-foreground">
                    Ваше код-слово
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Например «Хаб» — именно это слово увидят на креативе и напишут в директ.
                  </p>
                  <input
                    id="code-word-input"
                    type="text"
                    value={codeWord}
                    onChange={(e) => setCodeWord(e.target.value.slice(0, 24))}
                    placeholder="Хаб"
                    maxLength={24}
                    className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base font-semibold tracking-wide text-foreground outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2"
                    autoComplete="off"
                  />
                </div>
                <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-border/60 bg-zinc-950 shadow-inner">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.35),_transparent_60%)]" />
                  <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2.5 backdrop-blur-sm">
                    <p className="text-[10px] uppercase tracking-wider text-white/60">На креативе</p>
                    <p className="mt-0.5 text-sm font-bold leading-snug text-white">
                      Пишите код-слово{" "}
                      <span className="rounded-md bg-primary px-1.5 py-0.5 text-primary-foreground">
                        {codeWord.trim() || "ХАБ"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Color */}
        {flow.step3.showColor && (
        <div className="mt-10">

          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
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
                    " hover:scale-105",
                    selected
                      ? "border-foreground "
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
        )}

        {/* Footer — sticky on phone */}
        <div className="h-28 sm:h-0" aria-hidden />
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:static sm:mt-12 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate(-1)}
              disabled={submitting}
              className="h-14 rounded-2xl border-border bg-card text-base touch-manipulation active:scale-[0.98]"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </Button>
            <Button
              size="lg"
              onClick={handleCreate}
              disabled={
                submitting ||
                selectedStyles.length === 0 ||
                (ctaId === "code_word" && !codeWord.trim())
              }
              className="h-14 rounded-2xl bg-gradient-primary text-base font-semibold text-primary-foreground hover:opacity-90 touch-manipulation active:scale-[0.98]"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {submitting ? "Создаём…" : "Создать"}
            </Button>
          </div>
        </div>

        {/* ТЗ-превью перед отправкой */}
        <Collapsible className="mt-6">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-left transition-all hover:border-primary/40"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
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
              const previewCta = {
                ...CTAS.find((c) => c.id === ctaId)!,
                phrase: resolveCtaPhrase(ctaId, codeWord),
              };
              const previewTone = TONES.find((t) => t.id === toneId)!;
              const previewGoal = GOALS.find((g) => g.id === goalId)!;
              const userBriefWithMeta = buildBriefWithMarketing(wizardState, {
                goalLabel: previewGoal.label,
                goalDescription: previewGoal.description,
                toneLabel: previewTone.label,
                toneDescription: previewTone.description,
                ctaPhrase: previewCta.phrase,
              });
              const built = buildStyleBrief({
                styleId: styleDef.id as BriefStyleId,
                userBrief: userBriefWithMeta,
                format: {
                  aspect,
                  lang,
                  variants,
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
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
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
      </section>
      )}

      <section
        className={cn(
          "container max-w-5xl pb-16",
          neuroAutoSubmit ? "pt-4" : "-mt-6",
        )}
      >
        {/* Status */}
        {status !== "idle" && (
          <div
            className={cn(
              "mt-6 rounded-2xl border p-4 transition-all",
              status === "sending" && "border-primary/40 bg-primary/5",
              status === "queued" && "border-primary/40 bg-primary/5",
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
              {status === "queued" && (
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
                    status === "queued" && "text-foreground",
                    status === "success" &&
                      "text-emerald-600 dark:text-emerald-400",
                    status === "error" && "text-destructive",
                  )}
                >
                  {status === "sending" && "Отправляем задачу дизайнеру…"}
                  {status === "queued" && "Креатив в работе — ожидайте результат"}
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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  Результаты генерации
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {status === "queued"
                    ? "Дизайнер в работе. Карточки обновятся, как только придёт изображение."
                    : "По одному варианту на каждый выбранный стиль"}
                </p>
              </div>
              {status === "queued" && (
                <div className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
                  В очереди: {results.filter((v) => !v.error && !v.imageUrl).length}
                  {" · "}
                  Готово: {results.filter((v) => v.imageUrl).length}
                  {" · "}
                  Ошибок: {results.filter((v) => v.error).length}
                </div>
              )}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {results.map((v, i) => {
                const isReady = Boolean(v.imageUrl) && !v.error;
                const isError = Boolean(v.error);
                const isPending = !isReady && !isError;
                return (
                  <div
                    key={`${v.styleId}-${i}`}
                    className={cn(
                      "overflow-hidden rounded-2xl border bg-card  transition-colors",
                      isReady && "border-emerald-500/50",
                      isPending && "border-primary/40",
                      isError && "border-destructive/50",
                    )}
                  >
                    <div className="relative aspect-square w-full overflow-hidden bg-secondary/40">
                      {isReady && (
                        <img
                          src={v.imageUrl as string}
                          alt={`Креатив в стиле ${v.styleLabel}`}
                          className="h-full w-full object-cover"
                        />
                      )}
                      {isPending && (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-5 text-center">
                          <Loader2 className="h-7 w-7 animate-spin text-primary" />
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-foreground">
                              Дизайнер работает
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Изображение появится здесь автоматически
                            </div>
                          </div>
                        </div>
                      )}
                      {isError && (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-5 text-center">
                          <AlertCircle className="h-7 w-7 text-destructive" />
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-destructive">
                              Ошибка
                            </div>
                            <div className="line-clamp-3 text-xs text-muted-foreground">
                              {v.error}
                            </div>
                          </div>
                        </div>
                      )}
                      <span
                        className={cn(
                          "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                          isReady && "bg-emerald-500 text-white",
                          isPending && "bg-primary text-primary-foreground",
                          isError && "bg-destructive text-destructive-foreground",
                        )}
                      >
                        {isReady ? "Готово" : isPending ? "В работе" : "Ошибка"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-3 py-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">
                          Стиль
                        </div>
                        <div className="truncate text-sm font-semibold text-foreground">
                          {v.styleLabel}
                        </div>
                      </div>
                      {isReady && (
                        <a
                          href={v.imageUrl as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                        >
                          Открыть
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {status === "queued" && taskStartedAt && (
              <p className="mt-4 text-xs text-muted-foreground">
                Задача отправлена {new Date(taskStartedAt).toLocaleTimeString("ru-RU")}.
                Можно закрыть это окно и вернуться позже — результат сохранится
                после ответа n8n.
              </p>
            )}
          </div>
        )}
      </section>

      <Dialog
        open={taskDialogOpen}
        onOpenChange={(o) => {
          // Не даём закрыть пока идёт генерация
          if (submitting) return;
          setTaskDialogOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground ">
              {status === "success" ? (
                <CheckCircle2 className="h-7 w-7" />
              ) : status === "error" ? (
                <AlertCircle className="h-7 w-7" />
              ) : (
                <Loader2 className="h-7 w-7 animate-spin" />
              )}
            </div>
            <DialogTitle className="text-center text-xl">
              {status === "success"
                ? "Креативы готовы"
                : status === "error"
                  ? "Не удалось отправить задачу"
                  : status === "queued"
                    ? "Задача поставлена дизайнеру"
                    : "Отправляем задачу дизайнеру…"}
            </DialogTitle>
            <DialogDescription className="text-center">
              {status === "success"
                ? statusMessage || "Готово. Результаты появились ниже на странице."
                : status === "error"
                  ? statusMessage || "Произошла ошибка. Попробуйте ещё раз."
                  : status === "queued"
                    ? "Креатив в работе. Ожидайте — это может занять до пары минут. Изображение появится в карточках ниже автоматически."
                    : "Готовим payload и поднимаем AI-дизайнера…"}
            </DialogDescription>
          </DialogHeader>

          {(status === "sending" || status === "queued") && (
            <div className="space-y-3 px-1">
              <Progress
                value={status === "queued" ? 100 : progress}
                className={cn(
                  "h-2",
                  status === "queued" && "[&>div]:animate-pulse [&>div]:bg-primary",
                )}
              />
              <div className="text-center text-xs text-muted-foreground">
                {statusMessage ||
                  (status === "queued"
                    ? "Дизайнер начал работу…"
                    : "Отправляем задачу AI-дизайнеру…")}
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-primary" />
                {(() => {
                  const variantsPerStyle =
                    typeof variants === "number" && variants > 0
                      ? variants
                      : 1;
                  const total = selectedStyles.length * variantsPerStyle;
                  return variantsPerStyle > 1
                    ? `${selectedStyles.length} ${selectedStyles.length === 1 ? "стиль" : "стилей"} × ${variantsPerStyle} ${variantsPerStyle === 1 ? "вариант" : "вариантов"} = ${total} креативов в работе`
                    : `${selectedStyles.length} ${selectedStyles.length === 1 ? "вариант" : "вариантов"} в работе`;
                })()}
              </div>
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-col sm:justify-center">
            {status === "queued" ? (
              <Button onClick={startNewDesign} className="min-w-[200px] gap-2">
                <Plus className="h-4 w-4" />
                Создать новый дизайн
              </Button>
            ) : status === "success" ? (
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
                <Button variant="outline" onClick={() => setTaskDialogOpen(false)} className="min-w-[160px]">
                  Посмотреть результат
                </Button>
                <Button onClick={startNewDesign} className="min-w-[200px] gap-2">
                  <Plus className="h-4 w-4" />
                  Создать новый дизайн
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setTaskDialogOpen(false)}
                disabled={submitting}
                className="min-w-[140px]"
              >
                {submitting ? "Отправляем…" : status === "error" ? "Закрыть" : "Скрыть"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default CreateStep3;
