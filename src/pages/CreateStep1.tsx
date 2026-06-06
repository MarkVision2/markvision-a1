import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "@/components/factory/Header";
import SourceModeCard from "@/components/factory/SourceModeCard";
import LinkSource from "@/components/factory/sources/LinkSource";
import PhotoSource from "@/components/factory/sources/PhotoSource";
import LogoSource from "@/components/factory/sources/LogoSource";
import DescriptionSource from "@/components/factory/sources/DescriptionSource";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Link2, Image as ImageIcon, FileText } from "lucide-react";
import { CONTENT_TYPES } from "@/data/contentTypes";
import { CopyModePanel } from "@/components/factory/CopyModePanel";
import { persistWizardState } from "@/lib/contentFactoryBrief";
import type { CopyMode } from "@/lib/contentFactoryCopy";
import { BrandTemplatePicker } from "@/components/factory/BrandTemplatePicker";
import { useBrandTemplates } from "@/hooks/useBrandTemplates";
import { getContentTypeFlow, type SourceMode } from "@/data/contentTypeFlows";

interface LocationState {
  typeId?: string;
}

const MODE_META = {
  link: {
    title: "По ссылке",
    subtitle: "Вставьте URL",
    icon: Link2,
  },
  photo: {
    title: "По фото",
    subtitle: "Загрузите изображения",
    icon: ImageIcon,
  },
  description: {
    title: "По описанию",
    subtitle: "Опишите что нужно",
    icon: FileText,
  },
} as const;

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

  useEffect(() => {
    const def = templates.find((t) => t.is_default);
    if (def && !brandTemplateId) setBrandTemplateId(def.id);
  }, [templates, brandTemplateId]);

  useEffect(() => {
    if (!step1.allowedModes.includes(mode)) {
      setMode(step1.defaultMode);
    }
  }, [state.typeId, step1.defaultMode, step1.allowedModes, mode]);

  const canContinue =
    (mode === "link" && linkUrl.trim().length > 0) ||
    (mode === "photo" &&
      (step1.peoplePhotoRequired
        ? peoplePhotos.length > 0
        : photos.length > 0 || peoplePhotos.length > 0)) ||
    (mode === "description" && description.trim().length > 0);

  const visibleModes = step1.allowedModes.map((id) => ({
    id,
    ...MODE_META[id],
  }));

  return (
    <main className="min-h-screen">
      <Header onClose={() => navigate("/")} />

      <section className="container max-w-4xl pt-10 pb-16 sm:pt-14 animate-fade-in-up">
        <div className="inline-flex items-center rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Шаг 1 из {flow.totalSteps}
        </div>

        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          {step1.label}
        </h1>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">
          {step1.subtitle}
        </p>
        {type && (
          <p className="mt-2 text-sm text-muted-foreground">
            Формат:{" "}
            <span className="font-medium text-foreground">{type.title}</span>
            <span> — {type.subtitle}</span>
          </p>
        )}

        {step1.showModeSelector && visibleModes.length > 1 && (
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            {visibleModes.map((m) => (
              <SourceModeCard
                key={m.id}
                icon={m.icon}
                title={m.title}
                subtitle={m.subtitle}
                selected={mode === m.id}
                onClick={() => setMode(m.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-10 space-y-10">
          {step1.showLogo && (mode === "photo" || mode === "description") && (
            <LogoSource file={logoFile} onChange={setLogoFile} />
          )}
          {mode === "link" && (
            <LinkSource value={linkUrl} onChange={setLinkUrl} />
          )}
          {mode === "photo" && (
            <>
              {step1.showPeoplePhoto && (
                <PhotoSource
                  files={peoplePhotos}
                  onChange={setPeoplePhotos}
                  title={step1.peoplePhotoTitle}
                  subtitle={step1.peoplePhotoRequired ? "(обязательно)" : "(отдельная загрузка)"}
                  hint={
                    step1.peoplePhotoRequired
                      ? "Загрузите селфи или портрет — нейрофотосессия создаст креативы с вашим лицом."
                      : "Загрузите фото человека — система создаст баннер через нейрофотосессию с узнаваемым лицом."
                  }
                  maxFiles={10}
                />
              )}
              {peoplePhotos.length > 0 && step1.showProductPhoto && (
                <p className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs text-foreground">
                  Включена <span className="font-semibold">нейрофотосессия</span>: баннер будет с лицом
                  загруженного человека.
                </p>
              )}
              {step1.showProductPhoto && (
                <PhotoSource
                  files={photos}
                  onChange={setPhotos}
                  title="Фото товара / контента"
                  subtitle="(до 14 файлов)"
                  hint="Продукт, интерьер, референсы — всё, кроме логотипа и фото людей."
                />
              )}
            </>
          )}
          {mode === "description" && step1.showDescription && (
            <DescriptionSource
              value={description}
              onChange={setDescription}
              productName={productName}
              onProductNameChange={setProductName}
            />
          )}
        </div>

        {step1.showBrandTemplate && (
          <div className="mt-8">
            <BrandTemplatePicker value={brandTemplateId} onChange={setBrandTemplateId} />
          </div>
        )}

        {step1.showCopyMode && (
          <div className="mt-10">
            <CopyModePanel
              mode={copyMode}
              onModeChange={setCopyMode}
              overlayText={overlayText}
              onOverlayTextChange={setOverlayText}
              extraHints={extraInstructions}
              onExtraHintsChange={setExtraInstructions}
            />
          </div>
        )}

        <div className="mt-10 flex items-center justify-between gap-3">
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
              persistWizardState(nextState);
              navigate("/create/step-2", { state: nextState });
            }}
            className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90 disabled:bg-secondary disabled:bg-none disabled:text-muted-foreground disabled:shadow-none"
          >
            Далее
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </main>
  );
};

export default CreateStep1;
