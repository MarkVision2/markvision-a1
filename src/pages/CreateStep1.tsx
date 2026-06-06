import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Header from "@/components/factory/Header";
import SourceModeCard from "@/components/factory/SourceModeCard";
import LinkSource from "@/components/factory/sources/LinkSource";
import PhotoSource from "@/components/factory/sources/PhotoSource";
import DescriptionSource from "@/components/factory/sources/DescriptionSource";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Link2, Image as ImageIcon, FileText } from "lucide-react";
import { CONTENT_TYPES } from "@/data/contentTypes";
import { persistWizardState } from "@/lib/contentFactoryBrief";
import { BrandTemplatePicker } from "@/components/factory/BrandTemplatePicker";
import { useBrandTemplates } from "@/hooks/useBrandTemplates";

interface LocationState {
  typeId?: string;
}

type SourceMode = "link" | "photo" | "description";

const MODES = [
  {
    id: "link" as const,
    title: "По ссылке",
    subtitle: "Вставьте URL",
    icon: Link2,
  },
  {
    id: "photo" as const,
    title: "По фото",
    subtitle: "Загрузите изображения",
    icon: ImageIcon,
  },
  {
    id: "description" as const,
    title: "По описанию",
    subtitle: "Опишите что нужно",
    icon: FileText,
  },
];

const CreateStep1 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const type = CONTENT_TYPES.find((t) => t.id === state.typeId);

  const [mode, setMode] = useState<SourceMode>("link");
  const [linkUrl, setLinkUrl] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [productName, setProductName] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [brandTemplateId, setBrandTemplateId] = useState<string | null>(null);
  const { templates } = useBrandTemplates();

  useEffect(() => {
    const def = templates.find((t) => t.is_default);
    if (def && !brandTemplateId) setBrandTemplateId(def.id);
  }, [templates, brandTemplateId]);

  const canContinue =
    (mode === "link" && linkUrl.trim().length > 0) ||
    (mode === "photo" && photos.length > 0) ||
    (mode === "description" && description.trim().length > 0);

  return (
    <main className="min-h-screen">
      <Header onClose={() => navigate("/")} />

      <section className="container max-w-4xl pt-10 pb-16 sm:pt-14 animate-fade-in-up">
        {/* Step badge */}
        <div className="inline-flex items-center rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Шаг 1 из 3
        </div>

        {/* Title */}
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          Источник контента
        </h1>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">
          Выберите способ создания: по ссылке, по фото или по описанию
        </p>
        {type && (
          <p className="mt-2 text-sm text-muted-foreground">
            Формат:{" "}
            <span className="font-medium text-foreground">{type.title}</span>
            <span> — {type.subtitle}</span>
          </p>
        )}

        {/* Mode selector */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {MODES.map((m) => (
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

        {/* Dynamic source form */}
        <div className="mt-10">
          {mode === "link" && (
            <LinkSource value={linkUrl} onChange={setLinkUrl} />
          )}
          {mode === "photo" && (
            <PhotoSource files={photos} onChange={setPhotos} />
          )}
          {mode === "description" && (
            <DescriptionSource
              value={description}
              onChange={setDescription}
              productName={productName}
              onProductNameChange={setProductName}
            />
          )}
        </div>

        <div className="mt-8">
          <BrandTemplatePicker value={brandTemplateId} onChange={setBrandTemplateId} />
        </div>

        {/* Extra instructions (всегда доступно) */}
        <div className="mt-10 border-t border-border pt-8">
          <label htmlFor="extra-instructions" className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <FileText className="h-4 w-4" />
            </span>
            Дополнительные инструкции (Текст или Голос)
          </label>
          <textarea
            id="extra-instructions"
            value={extraInstructions}
            onChange={(e) => setExtraInstructions(e.target.value)}
            placeholder="Добавьте детали: акцент на преимуществах, яркие цвета, строгий стиль..."
            rows={4}
            className="mt-3 w-full resize-none rounded-2xl border border-border bg-secondary/40 px-5 py-4 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-primary/60 focus:bg-secondary/60"
          />
        </div>

        {/* Footer actions */}
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
                extraInstructions,
                photosCount: photos.length,
                photos,
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