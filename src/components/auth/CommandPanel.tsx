import {
  Activity,
  BarChart3,
  Bot,
  ChevronRight,
  Lock,
  Megaphone,
  ShieldCheck,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

type Module = {
  icon: typeof Megaphone;
  title: string;
  items: string;
};

/** Контуры платформы — совпадают с группами меню в AppSidebar. */
const MODULES: Module[] = [
  {
    icon: Megaphone,
    title: "Маркетинг",
    items: "Реклама, контент-завод, контент-план, радар идей, сетка аккаунтов",
  },
  {
    icon: Users,
    title: "Продажи",
    items: "CRM, AI РОП по звонкам, рассылки, лидген, AI-агенты",
  },
  {
    icon: BarChart3,
    title: "Аналитика",
    items: "Сквозная аналитика, воронка по креативам, таблица показателей",
  },
  {
    icon: Wallet,
    title: "Финансы",
    items: "Юнит-экономика, ROMI по каналам, отчётность для собственника",
  },
];

/** Путь лида по системе — от показа до денег в кассе. */
const PIPELINE = ["Трафик", "Заявка", "Диалог", "Сделка", "Выручка"];

export function CommandPanel() {
  return (
    <aside className="relative hidden h-full flex-col overflow-hidden bg-[hsl(215_48%_7%)] lg:flex">
      {/* фон: сетка + свечения */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(215 30% 26% / 0.35) 1px, transparent 1px), linear-gradient(90deg, hsl(215 30% 26% / 0.35) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 80% 70% at 30% 40%, #000 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at 30% 40%, #000 30%, transparent 100%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute -left-32 top-1/4 h-[26rem] w-[26rem] rounded-full bg-success/20 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 h-[22rem] w-[22rem] rounded-full bg-primary/15 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-border to-transparent" />

      {/* шапка */}
      <header className="relative z-10 flex items-center justify-between px-10 pt-8 xl:px-16">
        <div className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-foreground">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15 text-success ring-1 ring-success/40">
            <Zap className="h-4 w-4" />
          </span>
          MarkVision
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <Lock className="h-3 w-3" />
          Рабочая среда команды
        </div>
      </header>

      {/* контент */}
      <div className="relative z-10 flex flex-1 flex-col justify-center px-10 py-8 xl:px-16">
        <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-success/35 bg-success/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-success">
          <Activity className="h-3.5 w-3.5" />
          Единый контур управления
        </div>

        <h1 className="max-w-xl text-[36px] 2xl:max-w-2xl font-extrabold leading-[1.06] tracking-tight text-foreground xl:text-[42px] 2xl:text-[46px]">
          Центр управления{" "}
          <span className="bg-gradient-to-r from-[hsl(162_70%_52%)] to-[hsl(162_70%_68%)] bg-clip-text text-transparent">
            коммерческим отделом
          </span>
        </h1>

        <p className="mt-4 max-w-lg text-[15px] 2xl:max-w-xl leading-relaxed text-muted-foreground">
          Реклама, контент, CRM, звонки и деньги — в одном окне. Каждая заявка прослеживается
          от клика до оплаты, а решения принимаются по цифрам, а не по ощущениям.
        </p>

        {/* модули */}
        <div className="mt-6 grid max-w-2xl grid-cols-2 gap-3 2xl:max-w-3xl">
          {MODULES.map(({ icon: Icon, title, items }) => (
            <div
              key={title}
              className="group rounded-2xl border border-border/60 bg-card/40 p-3.5 backdrop-blur-sm transition hover:border-success/40 hover:bg-card/70"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-success ring-1 ring-border/60 transition group-hover:bg-success/15 group-hover:ring-success/40">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-foreground">{title}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{items}</p>
            </div>
          ))}
        </div>

        {/* путь лида */}
        <div className="mt-6 hidden max-w-2xl rounded-2xl 2xl:max-w-3xl border border-border/60 bg-card/30 p-4 backdrop-blur-sm [@media(min-height:800px)]:block">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <Bot className="h-3.5 w-3.5 text-success" />
            Сквозной путь заявки
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {PIPELINE.map((stage, i) => (
              <div key={stage} className="flex items-center gap-1.5">
                <span className="rounded-lg border border-border/60 bg-secondary/60 px-2.5 py-1.5 text-xs font-medium text-foreground">
                  {stage}
                </span>
                {i < PIPELINE.length - 1 && (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-success/70" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* подвал */}
      <footer className="relative z-10 flex flex-wrap items-center gap-x-6 gap-y-2 px-10 pb-7 text-[11px] text-muted-foreground xl:px-16">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-success/80" />
          Роли и доступы по модулям
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-success/80" />
          Данные проектов изолированы
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-success/80" />
          История решений и отчёты
        </span>
      </footer>
    </aside>
  );
}
