import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Maximize,
  Square,
  Smartphone,
  Monitor,
  FileText,
  Film,
  Globe,
  Layers,
  Check,
} from "lucide-react";
import Header from "@/components/factory/Header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AspectId = "1:1" | "4:5" | "9:16" | "16:9" | "3:4" | "21:9";
type LangId = "ru" | "kz" | "en";

const ASPECTS: {
  id: AspectId;
  label: string;
  sub: string;
  icon: typeof Square;
}[] = [
  { id: "1:1", label: "1:1", sub: "Квадрат", icon: Square },
  { id: "4:5", label: "4:5", sub: "Portrait", icon: Smartphone },
  { id: "9:16", label: "9:16", sub: "Stories / Reels", icon: Smartphone },
  { id: "16:9", label: "16:9", sub: "YouTube", icon: Monitor },
  { id: "3:4", label: "3:4", sub: "Базовый", icon: FileText },
  { id: "21:9", label: "21:9", sub: "Ultrawide", icon: Film },
];

const LANGS: { id: LangId; code: string; label: string }[] = [
  { id: "ru", code: "RU", label: "Русский" },
  { id: "kz", code: "KZ", label: "Қазақша" },
  { id: "en", code: "EN", label: "English" },
];

const VARIANT_COUNTS = [1, 3, 5, 7, 10];

const CreateStep2 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prevState = (location.state ?? {}) as Record<string, unknown>;
  const [aspect, setAspect] = useState<AspectId>("4:5");
  const [lang, setLang] = useState<LangId>("ru");
  const [variants, setVariants] = useState<number>(7);

  return (
    <main className="min-h-screen">
      <Header onClose={() => navigate("/")} />

      <section className="container max-w-5xl pt-10 pb-16 sm:pt-14 animate-fade-in-up">
        {/* Step badge */}
        <div className="inline-flex items-center rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary">
          Шаг 2 из 3
        </div>

        {/* Title */}
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          Настройки формата
        </h1>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">
          Настройки можно пропустить, если подходят базовые
        </p>

        {/* Aspect ratios */}
        <div className="mt-10">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Maximize className="h-4 w-4" />
            </span>
            Соотношение сторон
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
            {ASPECTS.map((a) => {
              const Icon = a.icon;
              const selected = aspect === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAspect(a.id)}
                  aria-pressed={selected}
                  className={cn(
                    "group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-6 text-center transition-all duration-300",
                    "hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-elevated",
                    selected && "border-primary bg-gradient-card-hover shadow-glow",
                  )}
                >
                  {selected && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <Icon
                    className={cn(
                      "h-8 w-8 text-primary/80 transition-colors",
                      selected && "text-primary",
                    )}
                    strokeWidth={1.5}
                  />
                  <div className="mt-1 text-xl font-bold text-foreground">
                    {a.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{a.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Language */}
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

        {/* Variants */}
        <div className="mt-10">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <Layers className="h-4 w-4" />
            </span>
            Количество слайдов / Вариантов
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 sm:gap-4">
            {VARIANT_COUNTS.map((n) => {
              const selected = variants === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setVariants(n)}
                  aria-pressed={selected}
                  className={cn(
                    "group relative flex flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card px-4 py-6 text-center transition-all duration-300",
                    "hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-elevated",
                    selected && "border-primary bg-gradient-card-hover shadow-glow",
                  )}
                >
                  {selected && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <div
                    className={cn(
                      "text-3xl font-bold text-primary/80",
                      selected && "text-primary",
                    )}
                  >
                    {n}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {n === 1 ? "1 вариант" : `${n} вариантов`}
                  </div>
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
            className="h-14 rounded-2xl border-border bg-card text-base"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </Button>
          <Button
            size="lg"
            onClick={() =>
              navigate("/create/step-3", {
                state: { ...prevState, aspect, lang, variants },
              })
            }
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