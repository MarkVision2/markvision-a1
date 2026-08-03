import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Globe, Layers, Maximize, Check } from "lucide-react";
import Header from "@/components/factory/Header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadWizardState, persistWizardState } from "@/lib/contentFactoryBrief";
import { toSerializableWizardState } from "@/lib/contentFactoryAspect";
import { readWizardFiles, stashWizardFiles } from "@/lib/wizardFilesStore";
import { getContentTypeFlow, type AspectId } from "@/data/contentTypeFlows";
import { AspectRatioPicker } from "@/components/factory/AspectRatioPicker";
import { VariantCountPicker } from "@/components/factory/VariantCountPicker";

type LangId = "ru" | "kz" | "en";

const LANGS: { id: LangId; code: string; label: string }[] = [
  { id: "ru", code: "RU", label: "Русский" },
  { id: "kz", code: "KZ", label: "Қазақша" },
  { id: "en", code: "EN", label: "English" },
];

function isAspectId(v: unknown, allowed: AspectId[]): v is AspectId {
  return typeof v === "string" && (allowed as string[]).includes(v);
}

const CreateStep2 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prevState = (location.state ?? {}) as Record<string, unknown>;
  const saved = loadWizardState(prevState);
  const typeId =
    typeof prevState.typeId === "string"
      ? prevState.typeId
      : typeof saved.typeId === "string"
        ? saved.typeId
        : undefined;
  const flow = getContentTypeFlow(typeId);
  const step2 = flow.step2;

  const initialAspect = isAspectId(saved.aspect, step2.aspects)
    ? saved.aspect
    : step2.defaultAspect;
  const initialLang: LangId =
    saved.lang === "kz" || saved.lang === "en" || saved.lang === "ru"
      ? saved.lang
      : "ru";
  const initialVariants =
    typeof saved.variants === "number" && step2.variantCounts.includes(saved.variants)
      ? saved.variants
      : step2.defaultVariants;

  const [aspect, setAspect] = useState<AspectId>(initialAspect);
  const [lang, setLang] = useState<LangId>(initialLang);
  const [variants, setVariants] = useState<number>(initialVariants);

  const variantUnit =
    step2.variantsLabel.toLowerCase().includes("слайд")
      ? "слайдов"
      : step2.variantsLabel.toLowerCase().includes("фото")
        ? "фото"
        : "вариантов";

  const goNext = () => {
    const stashed = readWizardFiles();
    const merged = {
      ...saved,
      ...prevState,
      typeId,
      aspect,
      lang,
      variants,
    };
    stashWizardFiles({
      logoFile: stashed.logoFile,
      photos: stashed.photos,
      peoplePhotos: stashed.peoplePhotos,
    });
    // Явно пишем format в sessionStorage — источник правды для шага 3 / webhook.
    persistWizardState({
      ...merged,
      aspect,
      lang,
      variants,
      hasLogo: Boolean(stashed.logoFile || saved.hasLogo),
      photosCount: stashed.photos.length || saved.photosCount || 0,
      peoplePhotosCount: stashed.peoplePhotos.length || saved.peoplePhotosCount || 0,
    });
    navigate("/create/step-3", {
      state: toSerializableWizardState({
        ...merged,
        aspect,
        lang,
        variants,
      } as Record<string, unknown>),
    });
  };

  return (
    <main className="min-h-screen">
      <Header onClose={() => navigate("/")} />

      <section className="container max-w-3xl pt-6 pb-4 animate-fade-in-up">
        <div className="inline-flex items-center rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Шаг 2 из {flow.totalSteps}
        </div>

        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          {step2.label}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          {step2.subtitle || "Настройки можно пропустить, если подходят базовые"}
        </p>

        {step2.showAspect && (
          <div className="mt-10">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                <Maximize className="h-4 w-4" />
              </span>
              Соотношение сторон
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Выбрано: <span className="font-semibold text-foreground">{aspect}</span> — уйдёт в ТЗ и webhook как есть
            </p>
            <div className="mt-4">
              <AspectRatioPicker
                value={aspect}
                onChange={setAspect}
                allowed={step2.aspects}
              />
            </div>
          </div>
        )}

        {step2.showLang && (
          <div className="mt-10">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                <Globe className="h-4 w-4" />
              </span>
              Язык текста
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              {LANGS.map((l) => {
                const selected = lang === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLang(l.id)}
                    aria-pressed={selected}
                    className={cn(
                      "group relative flex flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card px-6 py-7 text-center transition-all duration-300",
                      "hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-elevated",
                      selected && "border-primary bg-gradient-card-hover shadow-glow",
                    )}
                  >
                    {selected && (
                      <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div
                      className={cn(
                        "text-3xl font-bold tracking-wider text-primary/80",
                        selected && "text-primary",
                      )}
                    >
                      {l.code}
                    </div>
                    <div className="text-sm text-muted-foreground">{l.label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step2.showVariants && (
          <div className="mt-10">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
                <Layers className="h-4 w-4" />
              </span>
              {step2.variantsLabel}
            </div>
            <div className="mt-4">
              <VariantCountPicker
                value={variants}
                onChange={setVariants}
                counts={step2.variantCounts}
                unitLabel={variantUnit}
              />
            </div>
          </div>
        )}

        {/* Spacer for sticky mobile footer */}
        <div className="h-28 sm:h-0" aria-hidden />

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:static sm:mt-12 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate(-1)}
              className="h-14 rounded-2xl border-border bg-card text-base touch-manipulation active:scale-[0.98]"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </Button>
            <Button
              size="lg"
              onClick={goNext}
              className="h-14 rounded-2xl bg-gradient-primary text-base font-semibold text-primary-foreground shadow-glow hover:opacity-90 touch-manipulation active:scale-[0.98]"
            >
              Далее
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
};

export default CreateStep2;
