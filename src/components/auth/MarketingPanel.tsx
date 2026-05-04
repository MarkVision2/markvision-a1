import { ArrowRight, CheckCircle2, Clock, PlayCircle, Zap } from "lucide-react";

export function MarketingPanel() {
  return (
    <div className="relative hidden h-full overflow-hidden bg-gradient-to-br from-[hsl(220_60%_12%)] via-[hsl(220_55%_10%)] to-[hsl(220_65%_8%)] lg:flex lg:flex-col">
      {/* glow */}
      <div className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-success/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-10 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />

      {/* nav */}
      <header className="relative z-10 flex items-center gap-8 px-10 pt-8 text-sm">
        <div className="flex items-center gap-2 font-bold text-foreground">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-success/20 text-success ring-1 ring-success/40">
            <Zap className="h-4 w-4" />
          </span>
          MarkVision
        </div>
        <nav className="flex gap-6 text-muted-foreground">
          <a className="hover:text-foreground" href="#about">О проекте</a>
          <a className="hover:text-foreground" href="#features">Возможности</a>
        </nav>
      </header>

      {/* content */}
      <div className="relative z-10 flex flex-1 flex-col justify-center px-10 xl:px-16">
        <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-success/40 bg-success/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Умная система управления
        </div>

        <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground xl:text-[44px]">
          Хватит терять клиентов. Увеличьте выручку{" "}
          <span className="text-success">без дополнительных расходов на рекламу</span>
        </h1>

        <p className="mt-5 max-w-md text-base text-muted-foreground">
          Мы управляем маркетингом, продажами и аналитикой — вы управляйте бизнесом.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-5">
          <button
            type="button"
            className="group inline-flex items-center gap-2 rounded-full bg-success px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-success/30 transition hover:bg-success/90"
          >
            Забронировать аудит
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </button>
          <button type="button" className="inline-flex items-center gap-3 text-sm text-foreground">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-success/40 text-success">
              <PlayCircle className="h-5 w-5" />
            </span>
            <span className="text-left">
              <div className="font-semibold">Посмотрите видео <span className="text-muted-foreground">(3 мин)</span></div>
              <div className="text-xs text-muted-foreground">и получите доступ к полной демонстрации</div>
            </span>
          </button>
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-2 px-10 pb-7 text-xs text-muted-foreground xl:px-16">
        <Clock className="h-3.5 w-3.5" />
        Обычно занимает 20 минут <span className="opacity-50">|</span> Без обязательств
      </div>
    </div>
  );
}
