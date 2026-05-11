import { Wand2 } from "lucide-react";

const Hero = () => {
  return (
    <section className="container animate-fade-in-up pb-3 pt-6 sm:pt-8">
      <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:gap-4 sm:text-left">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
          <Wand2 className="h-6 w-6" />
        </span>
        <div className="leading-tight">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-success animate-pulse-dot" />
            Контент-завод
          </div>
          <h1 className="mt-1 text-balance text-xl font-bold tracking-tight sm:text-2xl">
            <span className="text-gradient">Создавайте конверсионные креативы</span>
          </h1>
          <p className="mt-0.5 max-w-xl text-balance text-xs text-muted-foreground sm:text-sm">
            Выберите формат — система соберёт промт, структуру и стиль под него
          </p>
        </div>
      </div>
    </section>
  );
};

export default Hero;
