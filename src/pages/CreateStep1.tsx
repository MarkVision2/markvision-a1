import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "@/components/factory/Header";
import LinkSource from "@/components/factory/sources/LinkSource";
import PhotoSource from "@/components/factory/sources/PhotoSource";
import LogoSource from "@/components/factory/sources/LogoSource";
import DescriptionSource from "@/components/factory/sources/DescriptionSource";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ArrowLeft,
  ArrowRight,
  Link2,
  Image as ImageIcon,
  FileText,
  Users,
  BookOpen,
  Type,
  AtSign,
  Check,
} from "lucide-react";
import { CONTENT_TYPES } from "@/data/contentTypes";
import { CopyModePanel } from "@/components/factory/CopyModePanel";
import { persistWizardState } from "@/lib/contentFactoryBrief";
import { stashWizardFiles } from "@/lib/wizardFilesStore";
import type { CopyMode } from "@/lib/contentFactoryCopy";
import { BrandTemplatePicker } from "@/components/factory/BrandTemplatePicker";
import { CreativeUsernamePanel } from "@/components/factory/CreativeUsernamePanel";
import { useBrandTemplates } from "@/hooks/useBrandTemplates";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { formatCreativeUsernameDisplay } from "@/lib/projectCreativeUsername";
import { getContentTypeFlow, type SourceMode } from "@/data/contentTypeFlows";
import { cn } from "@/lib/utils";

interface LocationState {
  typeId?: string;
}

const MODE_META: Record<
  SourceMode,
  { title: string; subtitle: string; icon: typeof Link2 }
> = {
  link: { title: "По ссылке", subtitle: "URL товара", icon: Link2 },
  photo: { title: "По фото", subtitle: "Изображения", icon: ImageIcon },
  description: { title: "По описанию", subtitle: "Текст брифа", icon: FileText },
};

const CreateStep1 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const type = CONTENT_TYPES.find((t) => t.id === state.typeId);
  const flow = getContentTypeFlow(state.typeId);
  const step1 = flow.step1;

  const [mode, setMode] = useState<SourceMode>(step1.defaultMode);
  const [linkUrl, setLinkUrl] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [peoplePhotos, setPeoplePhotos] = useState<File[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [productName, setProductName] = useState("");
  const [copyMode, setCopyMode] = useState<CopyMode>("auto");
  const [overlayText, setOverlayText] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [brandTemplateId, setBrandTemplateId] = useState<string | null>(null);
  const { templates } = useBrandTemplates();
  const { active } = useProjectsStore();

  useEffect(() => {
    const def = templates.find((t) => t.is_default);
    if (def && !brandTemplateId) setBrandTemplateId(def.id);
  }, [templates, brandTemplateId]);

  useEffect(() => {
    if (!step1.allowedModes.includes(mode)) {
      setMode(step1.defaultMode);
    }
  }, [state.typeId, step1.defaultMode, step1.allowedModes, mode]);

  const hasLogo = Boolean(logoFile);
  const hasLink = linkUrl.trim().length > 0;
  const hasDescription = description.trim().length > 0;
  const hasProductName = productName.trim().length > 0;
  const hasContentPhotos = photos.length > 0;
  const hasPeoplePhotos = peoplePhotos.length > 0;

  const canContinue =
    (mode === "link" && (hasLink || hasLogo)) ||
    (mode === "photo" &&
      (step1.peoplePhotoRequired
        ? hasPeoplePhotos
        : hasContentPhotos || hasPeoplePhotos || hasLogo)) ||
    (mode === "description" && (hasDescription || hasProductName || hasLogo));

  const visibleModes = step1.allowedModes.map((id) => ({ id, ...MODE_META[id] }));

  const activeTemplate = templates.find((t) => t.id === brandTemplateId);
  const usernameDisplay = formatCreativeUsernameDisplay(active?.creativeUsername);

  const summaryChips = useMemo(() => {
    const chips: { label: string; done: boolean }[] = [];
    if (mode === "link") chips.push({ label: hasLink ? "Ссылка ✓" : "Ссылка", done: hasLink });
    if (mode === "description")
      chips.push({ label: hasDescription || hasProductName ? "Описание ✓" : "Описание", done: hasDescription || hasProductName });
    chips.push({ label: hasLogo ? "Логотип ✓" : "Логотип", done: hasLogo });
    if (step1.showPeoplePhoto)
      chips.push({ label: `Люди${hasPeoplePhotos ? ` · ${peoplePhotos.length}` : ""}`, done: hasPeoplePhotos });
    if (mode === "photo" && step1.showProductPhoto)
      chips.push({ label: `Товар${hasContentPhotos ? ` · ${photos.length}` : ""}`, done: hasContentPhotos });
    return chips;
  }, [mode, hasLink, hasDescription, hasProductName, hasLogo, hasPeoplePhotos, hasContentPhotos, peoplePhotos.length, photos.length, step1.showPeoplePhoto, step1.showProductPhoto]);

  return (
    <main className="min-h-screen pb-28">
      <Header onClose={() => navigate("/")} />

      <section className="container max-w-3xl pt-6 animate-fade-in-up">
        {/* Compact header */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 font-semibold uppercase tracking-wider text-primary">
            Шаг 1 / {flow.totalSteps}
          </span>
          {type && (
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{type.title}</span> · {type.subtitle}
            </span>
          )}
        </div>

        <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
          {step1.label}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{step1.subtitle}</p>

        {/* Live summary chips */}
        {summaryChips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {summaryChips.map((c, i) => (
              <span
                key={i}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  c.done
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-secondary/40 text-muted-foreground",
                )}
              >
                {c.done && <Check className="h-3 w-3" />}
                {c.label}
              </span>
            ))}
          </div>
        )}

        {/* Source mode: segmented control */}
        {step1.showModeSelector && visibleModes.length > 1 && (
          <div className="mt-6">
            <div className="inline-flex w-full rounded-2xl border border-border bg-secondary/30 p-1">
              {visibleModes.map((m) => {
                const Icon = m.icon;
                const selected = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                      selected
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{m.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Source input (link / photo / description) */}
        <div className="mt-5">
          {mode === "link" && <LinkSource value={linkUrl} onChange={setLinkUrl} />}
          {mode === "description" && step1.showDescription && (
            <DescriptionSource
              value={description}
              onChange={setDescription}
              productName={productName}
              onProductNameChange={setProductName}
            />
          )}
          {mode === "photo" && step1.showProductPhoto && (
            <PhotoSource
              files={photos}
              onChange={setPhotos}
              title="Фото товара / контента"
              subtitle="(необязательно)"
              hint="Продукт, интерьер, референсы — до 14 файлов."
            />
          )}
        </div>

        {/* Logo — primary, always visible */}
        {step1.showLogo && (
          <div className="mt-6">
            <LogoSource file={logoFile} onChange={setLogoFile} />
          </div>
        )}

        {/* People photos — dedicated section for photo mode with people */}
        {mode === "photo" && step1.showPeoplePhoto && (
          <div className="mt-6">
            <PhotoSource
              files={peoplePhotos}
              onChange={setPeoplePhotos}
              title={step1.peoplePhotoTitle}
              subtitle={step1.peoplePhotoRequired ? "(обязательно)" : "(отдельная загрузка)"}
              hint={
                step1.peoplePhotoRequired
                  ? "Селфи или портрет — нейрофотосессия создаст креативы с вашим лицом."
                  : "Фото человека — баннер через нейрофотосессию с узнаваемым лицом."
              }
              maxFiles={10}
            />
            {peoplePhotos.length > 0 && step1.showProductPhoto && (
              <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground">
                Включена <span className="font-semibold">нейрофотосессия</span>: баннер будет с лицом
                загруженного человека.
              </p>
            )}
          </div>
        )}

        {/* Optional advanced settings — collapsed by default */}
        <div className="mt-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Дополнительно
          </h2>
          <Accordion
            type="multiple"
            className="space-y-2"
          >
            {step1.showBrandTemplate && (
              <AccordionItem
                value="brand"
                className="overflow-hidden rounded-2xl border border-border/60 bg-card/50"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex flex-1 items-center gap-3 pr-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-semibold">Шаблон бренда</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {activeTemplate ? activeTemplate.name : "Без шаблона"}
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <BrandTemplatePicker value={brandTemplateId} onChange={setBrandTemplateId} />
                </AccordionContent>
              </AccordionItem>
            )}

            {step1.showCopyMode && (
              <AccordionItem
                value="copy"
                className="overflow-hidden rounded-2xl border border-border/60 bg-card/50"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex flex-1 items-center gap-3 pr-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Type className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-semibold">Текст на креативе</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {copyMode === "custom"
                          ? overlayText.trim()
                            ? `Свой текст: ${overlayText.slice(0, 40)}${overlayText.length > 40 ? "…" : ""}`
                            : "Свой текст (не введён)"
                          : "AI сам напишет сценарий"}
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <CopyModePanel
                    mode={copyMode}
                    onModeChange={setCopyMode}
                    overlayText={overlayText}
                    onOverlayTextChange={setOverlayText}
                    extraHints={extraInstructions}
                    onExtraHintsChange={setExtraInstructions}
                  />
                </AccordionContent>
              </AccordionItem>
            )}

            <AccordionItem
              value="username"
              className="overflow-hidden rounded-2xl border border-border/60 bg-card/50"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex flex-1 items-center gap-3 pr-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <AtSign className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold">Ник на креативах</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {usernameDisplay ?? "Не указан — подпись не ставится"}
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <CreativeUsernamePanel variant="wizard" />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {!canContinue && (
          <p className="mt-6 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {mode === "photo" && step1.peoplePhotoRequired
              ? "Загрузите селфи или портрет, чтобы продолжить."
              : mode === "link"
                ? "Вставьте ссылку или загрузите логотип."
                : mode === "photo"
                  ? "Достаточно логотипа — фото товара и людей необязательны."
                  : "Достаточно логотипа, описания или названия товара."}
          </p>
        )}
      </section>

      {/* Sticky footer nav */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/85 backdrop-blur-md">
        <div className="container flex max-w-3xl items-center justify-between gap-3 py-3">
          <Button variant="outline" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Button>
          <Button
            disabled={!canContinue}
            onClick={() => {
              const nextState = {
                typeId: state.typeId,
                mode,
                linkUrl,
                description,
                productName,
                copyMode,
                overlayText,
                extraInstructions,
                photosCount: photos.length,
                photos,
                peoplePhotos,
                peoplePhotosCount: peoplePhotos.length,
                logoFile,
                brandTemplateId,
              };
              stashWizardFiles({ logoFile, photos, peoplePhotos });
              persistWizardState({ ...nextState, hasLogo: Boolean(logoFile) });
              navigate("/create/step-2", { state: nextState });
            }}
            className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90 disabled:bg-secondary disabled:bg-none disabled:text-muted-foreground disabled:shadow-none"
          >
            Далее
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </main>
  );
};

export default CreateStep1;
