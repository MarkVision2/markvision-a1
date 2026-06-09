import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Globe, Layers, Maximize, Check } from "lucide-react";
import Header from "@/components/factory/Header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { persistWizardState } from "@/lib/contentFactoryBrief";
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

const CreateStep2 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prevState = (location.state ?? {}) as Record<string, unknown>;
  const typeId = typeof prevState.typeId === "string" ? prevState.typeId : undefined;
  const flow = getContentTypeFlow(typeId);
  const step2 = flow.step2;

  const [aspect, setAspect] = useState<AspectId>(step2.defaultAspect);
  const [lang, setLang] = useState<LangId>("ru");
  const [variants, setVariants] = useState<number>(step2.defaultVariants);

  const variantUnit =
    step2.variantsLabel.toLowerCase().includes("слайд")
      ? "слайдов"
      : step2.variantsLabel.toLowerCase().includes("фото")
        ? "фото"
        : "вариантов";

  return (
    <main className="min-h-screen">
      <Header onClose={() => navigate("/")} />

      <section className="container max-w-5xl pt-10 pb-16 sm:pt-14 animate-fade-in-up">
        <div className="inline-flex items-center rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Шаг 2 из {flow.totalSteps}
        </div>

        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          {step2.label}
        </h1>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">
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

        <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => navigate(-1)}
            className="h-14 rounded-2xl border-border bg-card text-base"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Button>
          <Button
            size="lg"
            onClick={() => {
              const stashed = readWizardFiles();
              const nextState = {
                ...prevState,
                aspect,
                lang,
                variants,
                logoFile: (prevState.logoFile as File | null | undefined) ?? stashed.logoFile,
                photos: (prevState.photos as File[] | undefined)?.length
                  ? (prevState.photos as File[])
                  : stashed.photos,
                peoplePhotos: (prevState.peoplePhotos as File[] | undefined)?.length
                  ? (prevState.peoplePhotos as File[])
                  : stashed.peoplePhotos,
              };
              stashWizardFiles({
                logoFile: nextState.logoFile as File | null,
                photos: nextState.photos as File[],
                peoplePhotos: nextState.peoplePhotos as File[],
              });
              persistWizardState(nextState);
              navigate("/create/step-3", { state: nextState });
            }}
            className="h-14 rounded-2xl bg-gradient-primary text-base text-primary-foreground shadow-glow hover:opacity-90"
          >
            Продолжить
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </main>
  );
};

export default CreateStep2;
