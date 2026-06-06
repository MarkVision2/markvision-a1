import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Send, Sparkles, Maximize, Layers, FileText } from "lucide-react";
import Header from "@/components/factory/Header";
import PhotoSource from "@/components/factory/sources/PhotoSource";
import { NeuroStylePicker } from "@/components/factory/NeuroStylePicker";
import { AspectRatioPicker } from "@/components/factory/AspectRatioPicker";
import { VariantCountPicker } from "@/components/factory/VariantCountPicker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getContentTypeFlow } from "@/data/contentTypeFlows";
import type { AspectId } from "@/data/contentTypeFlows";
import type { AngleId, NeuroStyleId } from "@/data/neuroStyles";
import { persistWizardState } from "@/lib/contentFactoryBrief";
import { CONTENT_TYPES } from "@/data/contentTypes";
import { toast } from "sonner";

const flow = getContentTypeFlow("neuro-photo");
const type = CONTENT_TYPES.find((t) => t.id === "neuro-photo")!;

const CreateNeuroPhoto = () => {
  const navigate = useNavigate();
  const [peoplePhotos, setPeoplePhotos] = useState<File[]>([]);
  const [styleNotes, setStyleNotes] = useState("");
  const [selectedStyles, setSelectedStyles] = useState<NeuroStyleId[]>(["neuro_business"]);
  const [selectedAngles, setSelectedAngles] = useState<AngleId[]>(["front", "three_quarter"]);
  const [aspect, setAspect] = useState<AspectId>(flow.step2.defaultAspect);
  const [variants, setVariants] = useState(flow.step2.defaultVariants);
  const [submitting, setSubmitting] = useState(false);

  const canCreate = peoplePhotos.length > 0 && selectedStyles.length > 0;

  const handleCreate = () => {
    if (!canCreate) {
      toast.error("Загрузите селфи и выберите стиль");
      return;
    }

    setSubmitting(true);
    const state = {
      typeId: "neuro-photo",
      mode: "photo" as const,
      peoplePhotos,
      peoplePhotosCount: peoplePhotos.length,
      photos: [] as File[],
      photosCount: 0,
      extraInstructions: styleNotes.trim(),
      description: styleNotes.trim(),
      aspect,
      lang: "ru" as const,
      variants,
      selectedStyles,
      selectedAngles,
      neuroAutoSubmit: true,
      brandTemplateId: null,
      copyMode: "auto" as const,
      overlayText: "",
    };

    persistWizardState(state);
    navigate("/create/step-3", { state });
  };

  return (
    <main className="min-h-screen">
      <Header onClose={() => navigate("/")} />

      <section className="container max-w-4xl pt-10 pb-16 sm:pt-14 animate-fade-in-up">
        <div className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Нейрофотосессия
        </div>

        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{type.title}</h1>
        <p className="mt-2 text-muted-foreground">{flow.step1.subtitle}</p>

        {/* 1. Фото */}
        <div className="mt-10 rounded-2xl border border-border bg-card/50 p-5 sm:p-6">
          <h2 className="text-sm font-semibold">1. Загрузите фото</h2>
          <p className="mt-1 text-xs text-muted-foreground">Селфи или портрет — лицо будет на всех кадрах</p>
          <div className="mt-4">
            <PhotoSource
              files={peoplePhotos}
              onChange={setPeoplePhotos}
              title={flow.step1.peoplePhotoTitle}
              subtitle="(обязательно)"
              hint="Чёткое лицо анфас или 3/4, без сильных фильтров."
              maxFiles={10}
            />
          </div>
        </div>

        {/* 2. Стиль */}
        <div className="mt-6 rounded-2xl border border-border bg-card/50 p-5 sm:p-6">
          <h2 className="text-sm font-semibold">2. Стиль фотосессии</h2>
          <p className="mt-1 text-xs text-muted-foreground">Можно выбрать до 4 стилей — по одному фото на каждый</p>
          <div className="mt-4">
            <NeuroStylePicker
              selectedStyles={selectedStyles}
              onStylesChange={setSelectedStyles}
              selectedAngles={selectedAngles}
              onAnglesChange={setSelectedAngles}
            />
          </div>
        </div>

        {/* 3. Свой стиль */}
        <div className="mt-6 rounded-2xl border border-border bg-card/50 p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" />
            3. Свой стиль / пожелания
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Опишите образ, одежду, фон, настроение — необязательно
          </p>
          <Textarea
            value={styleNotes}
            onChange={(e) => setStyleNotes(e.target.value)}
            placeholder="Например: деловой костюм, светлый фон, уверенная улыбка, без очков…"
            className="mt-3 min-h-[100px] resize-y"
          />
        </div>

        {/* 4. Формат */}
        <div className="mt-6 rounded-2xl border border-border bg-card/50 p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Maximize className="h-4 w-4 text-primary" />
            4. Формат
          </div>
          <div className="mt-4">
            <AspectRatioPicker
              value={aspect}
              onChange={setAspect}
              allowed={flow.step2.aspects}
            />
          </div>
        </div>

        {/* 5. Количество */}
        <div className="mt-6 rounded-2xl border border-border bg-card/50 p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="h-4 w-4 text-primary" />
            5. {flow.step2.variantsLabel}
          </div>
          <div className="mt-4">
            <VariantCountPicker
              value={variants}
              onChange={setVariants}
              counts={flow.step2.variantCounts}
              unitLabel="фото"
            />
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={() => navigate("/")} disabled={submitting}>
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Button>
          <Button
            size="lg"
            disabled={!canCreate || submitting}
            onClick={handleCreate}
            className="h-14 rounded-2xl bg-gradient-primary px-8 text-primary-foreground shadow-glow"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {submitting ? "Запускаем…" : "Создать фотосессию"}
          </Button>
        </div>
      </section>
    </main>
  );
};

export default CreateNeuroPhoto;
