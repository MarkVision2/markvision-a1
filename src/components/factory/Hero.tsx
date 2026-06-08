import { Wand2 } from "lucide-react";

const Hero = () => {
  return (
    <section className="container animate-fade-in-up px-3 pb-2 pt-4 sm:px-4 sm:pb-3 sm:pt-8">
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow sm:h-12 sm:w-12">
          <Wand2 className="h-5 w-5 sm:h-6 sm:w-6" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-success animate-pulse-dot" />
            Контент-завод
          </div>
          <h1 className="mt-1.5 text-balance text-lg font-bold tracking-tight sm:text-2xl">
            <span className="text-gradient">Создавайте конверсионные креативы</span>
          </h1>
          <p className="mt-1 max-w-xl text-pretty text-xs leading-relaxed text-muted-foreground sm:mt-0.5 sm:text-sm">
            Выберите формат — система соберёт промт, структуру и стиль под него
          </p>
        </div>
      </div>
    </section>
  );
};

export default Hero;
