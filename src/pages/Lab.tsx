import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Factory,
  FileText,
  Gift,
  Globe,
  LayoutDashboard,
  MessageCircle,
  Monitor,
  Rocket,
  Sparkles,
  Target,
  Video,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* ------------------------------------------------------------------ */
/* Конфигурация лендинга: правится в одном месте                      */
/* ------------------------------------------------------------------ */

// TODO: заменить на реальную ссылку WhatsApp-группы
const WHATSAPP_URL = "https://chat.whatsapp.com/REPLACE_ME";
const EVENT_DATE = "1 августа";
const EVENT_TIME = "19:00 (GMT+5)";

/* ------------------------------------------------------------------ */
/* Вспомогательные компоненты                                          */
/* ------------------------------------------------------------------ */

/** Плавное появление секции при скролле */
const Reveal = ({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      /* после появления transform снимается полностью: transform-слой над
         background-clip:text ломает градиентный текст в Chromium */
      className={`transition-all duration-700 ease-out ${
        visible ? "opacity-100" : "translate-y-6 opacity-0"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

const CtaButton = ({
  children,
  size = "lg",
  className = "",
  id,
}: {
  children: ReactNode;
  size?: "md" | "lg" | "xl";
  className?: string;
  id?: string;
}) => {
  const sizes = {
    md: "px-5 py-2.5 text-sm",
    lg: "px-7 py-3.5 text-base",
    xl: "px-9 py-5 text-lg",
  } as const;
  return (
    <a
      id={id}
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`group inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-primary font-semibold text-primary-foreground shadow-glow transition-all duration-300 hover:scale-[1.03] hover:shadow-elevated active:scale-[0.98] ${sizes[size]} ${className}`}
    >
      <MessageCircle className={size === "xl" ? "h-6 w-6" : "h-5 w-5"} />
      {children}
      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
    </a>
  );
};

const EventMeta = ({ className = "" }: { className?: string }) => (
  <div className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground ${className}`}>
    <span className="inline-flex items-center gap-1.5"><Calendar className="h-4 w-4 text-primary" /> {EVENT_DATE}</span>
    <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" /> {EVENT_TIME}</span>
    <span className="inline-flex items-center gap-1.5"><Video className="h-4 w-4 text-primary" /> Zoom, онлайн</span>
    <span className="inline-flex items-center gap-1.5"><Gift className="h-4 w-4 text-primary" /> Участие бесплатное</span>
  </div>
);

/** Логотип бренда: public/lab-logo.png, при отсутствии файла — фирменная «M» */
const BrandLogo = () => {
  const [imgOk, setImgOk] = useState(true);
  if (!imgOk) {
    return (
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary text-sm font-extrabold text-primary-foreground">
        M
      </div>
    );
  }
  return (
    <img
      src="/lab-logo.png"
      alt="MarkVision AI"
      className="h-10 w-auto"
      onError={() => setImgOk(false)}
    />
  );
};

/** Фото спикера: public/lab-author.jpg, при отсутствии файла — плейсхолдер «Ю» */
const AuthorPhoto = () => {
  const [imgOk, setImgOk] = useState(true);
  if (!imgOk) {
    return (
      <div className="mx-auto grid aspect-square w-full max-w-[260px] place-items-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-7xl font-extrabold text-primary">
        Ю
      </div>
    );
  }
  return (
    <img
      src="/lab-author-face.jpg"
      alt="Юрий, создатель MarkVision AI"
      className="mx-auto aspect-square w-full max-w-[260px] rounded-2xl object-cover"
      onError={() => setImgOk(false)}
    />
  );
};

const SectionTag = ({ children }: { children: ReactNode }) => (
  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
    <Sparkles className="h-3.5 w-3.5" />
    {children}
  </div>
);

/* ------------------------------------------------------------------ */
/* Данные секций                                                       */
/* ------------------------------------------------------------------ */

const forWhom = [
  "Работаешь таргетологом или маркетологом",
  "Ведёшь несколько клиентов одновременно",
  "Устал вручную собирать отчёты",
  "Каждый день сидишь в Ads Manager",
  "Не успеваешь брать новых клиентов",
  "Хочешь увеличить доход и продавать дороже",
  "Хочешь создавать собственные инструменты и ботов",
  "Хочешь перестать зависеть от дизайнеров и программистов",
  "Чувствуешь, что рынок уходит вперёд, а времени разбираться нет",
];

const oldWay = [
  "Сам делает сайты",
  "Сам пишет тексты",
  "Сам собирает креативы",
  "Сам запускает рекламу",
  "Сам делает отчёты",
  "Сам сводит аналитику",
  "Работает по вечерам и выходным",
  "Боится брать новых клиентов",
];

const newWay = [
  "Сайты собирает система",
  "Тексты пишет нейросеть",
  "Баннеры и креативы генерируются сами",
  "Отчёты складываются автоматически",
  "CRM ведёт ассистент",
  "Рекламу анализирует алгоритм",
  "Вечера снова свободны",
  "Берёт больше клиентов без найма команды",
];

const webinarShow = [
  { icon: Target, text: "Таргетолог на автопилоте: анализ кампаний и рекомендации без ручного копания в Ads Manager" },
  { icon: Globe, text: "Как создаются сайты за минуты, а не за недели" },
  { icon: Sparkles, text: "Как генерируются креативы и баннеры под разные офферы" },
  { icon: Video, text: "Как пишутся сценарии для видео и рилсов без копирайтера" },
  { icon: FileText, text: "Как отчёты для клиентов собираются автоматически" },
  { icon: LayoutDashboard, text: "Как CRM наполняется и ведётся без ручного труда" },
  { icon: Bot, text: "Как создаются собственные приложения" },
  { icon: Workflow, text: "Как собрать всю эту систему самостоятельно, по шагам" },
];

const resultCards = [
  { icon: Target, label: "Таргетолог" },
  { icon: Zap, label: "Маркетолог" },
  { icon: Factory, label: "Контент-завод" },
  { icon: BarChart3, label: "Аналитика" },
  { icon: LayoutDashboard, label: "CRM" },
  { icon: FileText, label: "Отчётность" },
  { icon: Bot, label: "Ассистент" },
  { icon: Monitor, label: "Приложения" },
  { icon: Globe, label: "Сайты" },
  { icon: Workflow, label: "Автоматизации" },
];

const bonuses = [
  { title: "Готовые сайты", desc: "Шаблоны под стоматологию, медицину, автосервис, услуги и другие ниши" },
  { title: "Готовые автоматизации", desc: "Сценарии, которые забирают рутину сразу после установки" },
  { title: "Готовые AI-агенты", desc: "Рабочие агенты, которых можно адаптировать под своих клиентов" },
  { title: "Шаблоны продаж", desc: "Скрипты и структуры, по которым продаются услуги дороже" },
  { title: "Шаблоны диагностик", desc: "Готовый формат аудита, с которого начинается работа с клиентом" },
];

const afterCourse = [
  { bold: "Запускать клиента за несколько часов", rest: " вместо нескольких дней" },
  { bold: "Брать больше проектов", rest: " без расширения команды" },
  { bold: "Поднимать средний чек", rest: ": ты продаёшь систему, а не часы" },
  { bold: "Продавать внедрение автоматизации", rest: " как отдельную услугу" },
  { bold: "Создавать сайты", rest: " без разработчиков" },
  { bold: "Создавать CRM", rest: " без программистов" },
  { bold: "Создавать собственные приложения", rest: " под задачи клиентов" },
  { bold: "Автоматизировать большую часть работы", rest: " и заняться стратегией" },
];

const steps = [
  { title: "Оставляешь заявку", desc: "Жмёшь кнопку и переходишь в WhatsApp" },
  { title: "Попадаешь в группу", desc: "Там уже ждут материалы и инструкции" },
  { title: "Получаешь подготовку", desc: "Короткие видео и разборы до эфира" },
  { title: "Приходишь в Zoom", desc: "В назначенные дату и время" },
  { title: "Смотришь демонстрацию", desc: "Живой экран и живая система, а не слайды" },
  { title: "Задаёшь вопросы", desc: "Разбираем твою ситуацию в прямом эфире" },
  { title: "Получаешь предложение", desc: "Возможность попасть в AI Marketing Lab" },
];

const whatsappInside = [
  { icon: Video, text: "Короткие видео с демонстрацией AI-инструментов" },
  { icon: FileText, text: "Полезные материалы и разборы до эфира" },
  { icon: Calendar, text: "Напоминания о времени проведения" },
  { icon: MessageCircle, text: "Ссылку на Zoom в день эфира" },
  { icon: Gift, text: "Дополнительные бонусы для участников группы" },
];

const faq = [
  {
    q: "Это бесплатно?",
    a: "Да. Практикум полностью бесплатный. В конце я расскажу про программу AI Marketing Lab для тех, кто захочет пойти дальше. Сам практикум ни к чему не обязывает.",
  },
  {
    q: "Будет ли запись?",
    a: "Запись не гарантируется. Практикум рассчитан на живое участие: я показываю систему на своём экране и отвечаю на вопросы в реальном времени. Приходи на эфир.",
  },
  {
    q: "Нужен ли опыт в маркетинге?",
    a: "Базовое понимание маркетинга будет плюсом: ты быстрее поймёшь, куда встраивать инструменты. Но освоить их можно и без глубоких технических знаний, программировать не нужно.",
  },
  {
    q: "Это курс по ChatGPT?",
    a: "Нет. Мы говорим о построении целостной системы автоматизации маркетинга: сайты, CRM, аналитика, отчёты, контент. ChatGPT лишь один из инструментов внутри этой системы.",
  },
  {
    q: "Это только для таргетологов?",
    a: "Нет. Практикум будет полезен маркетологам, SMM-специалистам, владельцам небольших агентств и всем, кто хочет автоматизировать маркетинговые процессы и продавать дороже.",
  },
  {
    q: "Что нужно подготовить к эфиру?",
    a: "Ничего особенного: стабильный интернет, Zoom и час времени без отвлечений. Все материалы для подготовки придут в WhatsApp-группу заранее.",
  },
];

/* ------------------------------------------------------------------ */
/* Страница                                                            */
/* ------------------------------------------------------------------ */

const Lab = () => {
  const [showStickyCta, setShowStickyCta] = useState(false);

  useEffect(() => {
    document.title = "AI Marketing Lab: практикум по автоматизации маркетинга | MarkVision AI";
    const meta = document.querySelector('meta[name="description"]');
    const prev = meta?.getAttribute("content") ?? "";
    meta?.setAttribute(
      "content",
      "Бесплатный онлайн-практикум: как за 5 недель собрать систему, которая делает сайты, креативы, CRM, аналитику и отчёты без программирования.",
    );
    return () => {
      meta?.setAttribute("content", prev);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setShowStickyCta(window.scrollY > 700);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lab-theme min-h-screen overflow-x-clip bg-background text-foreground">
      {/* ---------------- Header ---------------- */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandLogo />
            <div className="leading-tight">
              <div className="text-sm font-bold">AI Marketing Lab</div>
              <div className="text-[11px] text-muted-foreground">by MarkVision AI</div>
            </div>
          </div>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-2 rounded-lg bg-primary/15 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 sm:inline-flex"
          >
            <MessageCircle className="h-4 w-4" />
            Вступить в группу
          </a>
        </div>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 80% 55% at 50% -5%, hsl(210 90% 55% / 0.16), transparent), radial-gradient(ellipse 40% 35% at 85% 25%, hsl(197 92% 61% / 0.08), transparent)",
          }}
        />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_360px] lg:gap-16">
            <div className="text-center lg:text-left">
              <Reveal>
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary sm:text-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  Бесплатный практикум · 1 августа · Zoom
                </div>
              </Reveal>

              <Reveal delay={80}>
                <h1 className="text-balance text-3xl font-extrabold leading-[1.15] tracking-tight sm:text-4xl sm:leading-[1.1] lg:text-5xl">
                  Как маркетологу и таргетологу выйти на{" "}
                  <span className="text-gradient-primary whitespace-nowrap">5 000 000+ ₸</span> в месяц и при этом работать
                  меньше
                </h1>
              </Reveal>

              <Reveal delay={160}>
                <p className="mx-auto mt-5 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-lg lg:mx-0">
                  Покажу систему, которая сама собирает стратегию, креативы и сайт и сама ведёт рекламу. Запуск клиента,
                  который раньше занимал несколько дней, теперь занимает пару часов.
                </p>
              </Reveal>

              <Reveal delay={240}>
                <div className="mt-8">
                  <CtaButton size="xl" id="cta-hero">Забронировать место</CtaButton>
                  <p className="mt-3 text-xs font-medium text-warning">Количество мест в Zoom ограничено</p>
                  <EventMeta className="mt-4 lg:justify-start" />
                </div>
              </Reveal>
            </div>

            <Reveal delay={200} className="hidden lg:block">
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute -inset-4 -z-10 rounded-3xl"
                  style={{ background: "radial-gradient(ellipse at 50% 40%, hsl(210 90% 55% / 0.25), transparent 70%)" }}
                />
                <img
                  src="/lab-author.jpg"
                  alt="Юрий, создатель MarkVision AI"
                  className="w-full rounded-3xl border border-primary/20 shadow-elevated"
                />
                <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-border/60 bg-background/85 px-4 py-2.5 backdrop-blur-md">
                  <div className="text-sm font-bold">Юрий</div>
                  <div className="text-xs text-muted-foreground">Маркетолог · Создатель MarkVision AI</div>
                </div>
              </div>
            </Reveal>
          </div>

          {/* Social proof */}
          <Reveal delay={400}>
            <div className="mt-12 grid grid-cols-2 gap-4 border-t border-border/60 pt-8 text-center sm:grid-cols-4">
              {[
                ["6+ лет", "в маркетинге"],
                ["100+", "проектов"],
                ["MarkVision AI", "своя AI-платформа"],
                ["Astana Hub", "резидент"],
              ].map(([big, small]) => (
                <div key={big}>
                  <div className="text-xl font-extrabold text-primary sm:text-2xl">{big}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{small}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Для кого ---------------- */}
      <section className="border-t border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="text-center">
            <SectionTag>Для кого</SectionTag>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">Для кого этот практикум</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Пройдись по списку. Если узнаёшь себя{" "}
              <span className="font-semibold text-foreground">хотя бы в трёх пунктах</span>, тебе обязательно стоит прийти.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {forWhom.map((item, i) => (
              <Reveal key={item} delay={i * 50}>
                <div className="flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors duration-300 hover:border-primary/40 hover:bg-gradient-card-hover">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span className="text-sm leading-relaxed sm:text-[15px]">{item}</span>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-10 text-center">
            <CtaButton id="cta-for-whom">Хочу попасть на практикум</CtaButton>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Сравнение ---------------- */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="text-center">
            <SectionTag>Развилка</SectionTag>
            <h2 className="mx-auto max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Почему большинство маркетологов никогда не выйдет на высокий доход
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Дело не в таланте и не в опыте. Дело в том, что один человек физически не может делать всё руками. Дальше
              два пути.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-2xl border border-border bg-card/60 p-6 sm:p-8">
                <div className="mb-6 flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-muted">
                    <X className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-muted-foreground">Обычный маркетолог</div>
                    <div className="text-xs text-muted-foreground/70">всё сам, руками, каждый день</div>
                  </div>
                </div>
                <ul className="space-y-3">
                  {oldWay.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground sm:text-[15px]">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
                  Потолок: сколько часов в сутках, столько и заработал.
                </div>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="relative h-full rounded-2xl border border-primary/40 bg-card p-6 shadow-glow sm:p-8">
                <div className="absolute -top-3 right-6 rounded-full bg-gradient-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                  Новая модель
                </div>
                <div className="mb-6 flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15">
                    <Rocket className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-lg font-bold">Выпускник AI Marketing Lab</div>
                    <div className="text-xs text-muted-foreground">рутину делает система</div>
                  </div>
                </div>
                <ul className="space-y-3">
                  {newWay.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm sm:text-[15px]">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 rounded-xl border border-primary/25 bg-primary/10 p-4 text-sm font-medium">
                  Маркетолог занимается стратегией и продажами. Остальное делает система.
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- Что покажу ---------------- */}
      <section className="border-t border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <SectionTag>Живая демонстрация</SectionTag>
              <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">Что покажу на практикуме</h2>
              <p className="mt-4 text-lg font-semibold">
                Не теория. Не слайды. <span className="text-primary">Мой экран и моя рабочая система.</span>
              </p>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Ты увидишь, как реальная AI-платформа ведёт маркетинг каждый день: от креатива и запуска рекламы до отчёта
                клиенту. И главное, поймёшь, как повторить это самому.
              </p>
              <div className="mt-8 hidden lg:block">
                <CtaButton id="cta-demo">Хочу увидеть систему</CtaButton>
              </div>
            </Reveal>

            <div className="grid gap-3">
              {webinarShow.map(({ icon: Icon, text }, i) => (
                <Reveal key={text} delay={i * 60}>
                  <div className="flex items-start gap-3.5 rounded-xl border border-border bg-card p-4 transition-colors duration-300 hover:border-primary/40">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <span className="pt-1 text-sm leading-relaxed sm:text-[15px]">{text}</span>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal className="text-center lg:hidden">
              <CtaButton id="cta-demo-mobile">Хочу увидеть систему</CtaButton>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- Кто я ---------------- */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid items-start gap-10 lg:grid-cols-[380px_1fr] lg:gap-16">
            <Reveal>
              <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
                <AuthorPhoto />
                <div className="mt-6 text-center">
                  <div className="text-2xl font-extrabold">Юрий</div>
                  <div className="mt-1 text-sm text-muted-foreground">Маркетолог · Создатель MarkVision AI</div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3 text-center">
                  {[
                    ["6+ лет", "в маркетинге"],
                    ["100+", "проектов"],
                    ["MarkVision AI", "создатель"],
                    ["Astana Hub", "резидент"],
                  ].map(([big, small]) => (
                    <div key={big} className="rounded-xl bg-muted/60 px-2 py-3">
                      <div className="text-sm font-bold text-primary">{big}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{small}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <SectionTag>Кто ведёт</SectionTag>
              <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
                Я не создавал эту систему для продажи курса
              </h2>
              <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
                <p>
                  Я собирал её <span className="font-semibold text-foreground">для себя</span>. Потому что устал делать всё
                  руками: сайты, тексты, креативы, отчёты, аналитику.
                </p>
                <p>
                  Когда клиентов стало больше, я упёрся в потолок: масштабироваться дальше было физически невозможно.
                  Нанимать дорого и медленно. Тогда я начал строить собственную платформу.
                </p>
                <p>
                  Сегодня <span className="font-semibold text-foreground">MarkVision AI</span> заменяет большую часть моей
                  рутины: запускает рекламу, ведёт CRM, собирает отчёты и производит контент.
                </p>
                <p className="border-l-2 border-primary pl-4 font-medium text-foreground">
                  Теперь я показываю другим маркетологам, как собрать такую же систему под себя. Это и есть AI Marketing Lab.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- Результат через 5 недель ---------------- */}
      <section className="border-t border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="text-center">
            <SectionTag>Результат обучения</SectionTag>
            <h2 className="mx-auto max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Через 5 недель у тебя будет собственная{" "}
              <span className="text-gradient-primary">AI-инфраструктура</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Не набор разрозненных «фишек», а связанная система, где каждый блок усиливает остальные.
            </p>
          </Reveal>

          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            {resultCards.map(({ icon: Icon, label }, i) => (
              <Reveal key={label} delay={i * 40}>
                <div className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-glow sm:p-6">
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 transition-colors duration-300 group-hover:bg-primary/20">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-sm font-semibold sm:text-[15px]">{label}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Бонусы ---------------- */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="text-center">
            <SectionTag>Стартовый набор</SectionTag>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              Помимо системы ты получишь готовую базу
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Чтобы не начинать с нуля: берёшь готовое, адаптируешь под клиента, запускаешь.
            </p>
          </Reveal>

          <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bonuses.map(({ title, desc }, i) => (
              <Reveal key={title} delay={i * 50}>
                <div className="h-full rounded-2xl border border-border bg-card p-5 transition-colors duration-300 hover:border-primary/40 hover:bg-gradient-card-hover sm:p-6">
                  <Gift className="h-6 w-6 text-primary" />
                  <div className="mt-3 font-bold">{title}</div>
                  <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- После курса ---------------- */}
      <section className="border-t border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="text-center">
            <SectionTag>Что это меняет</SectionTag>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">После курса ты сможешь</h2>
          </Reveal>

          <div className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-2">
            {afterCourse.map(({ bold, rest }, i) => (
              <Reveal key={bold} delay={i * 50}>
                <div className="flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 sm:p-5">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span className="text-sm leading-relaxed sm:text-[15px]">
                    <span className="font-semibold">{bold}</span>
                    <span className="text-muted-foreground">{rest}</span>
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Почему сейчас ---------------- */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <Reveal>
            <SectionTag>Почему сейчас</SectionTag>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
              AI не заменит маркетологов.{" "}
              <span className="text-gradient-primary">
                Их заменят маркетологи, которые используют AI
              </span>
            </h2>
            <div className="mx-auto mt-6 max-w-2xl space-y-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              <p>
                Специалисты, которые уже автоматизировали рутину, берут больше проектов, продают дороже и тратят меньше
                времени на ручную работу. Разрыв с теми, кто продолжает делать всё вручную, растёт с каждым месяцем.
              </p>
              <p>
                Компании всё чаще ожидают, что маркетолог умеет автоматизировать процессы. Освоить эти навыки сейчас проще, чем
                догонять рынок позже.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Как пройдёт ---------------- */}
      <section className="border-t border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="text-center">
            <SectionTag>Формат</SectionTag>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">Как пройдёт практикум</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Семь простых шагов от заявки до результата.</p>
          </Reveal>

          <div className="mx-auto mt-12 max-w-2xl">
            {steps.map(({ title, desc }, i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="relative flex gap-5 pb-8 last:pb-0">
                  {i < steps.length - 1 && (
                    <span className="absolute left-[19px] top-11 h-[calc(100%-2.75rem)] w-px bg-border" aria-hidden />
                  )}
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-sm font-extrabold text-primary">
                    {i + 1}
                  </div>
                  <div className="pt-1.5">
                    <div className="font-bold">{title}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">{desc}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Внутри WhatsApp-группы ---------------- */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl rounded-3xl border border-primary/30 bg-card p-8 shadow-card sm:p-12">
            <Reveal className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/15">
                <MessageCircle className="h-7 w-7 text-primary" />
              </div>
              <h2 className="mt-5 text-balance text-2xl font-extrabold tracking-tight sm:text-3xl">
                Что будет внутри WhatsApp-группы
              </h2>
              <p className="mt-3 text-muted-foreground">Группа не просто «ссылка на эфир». Ещё до практикума ты получишь:</p>
            </Reveal>

            <div className="mt-8 space-y-3">
              {whatsappInside.map(({ icon: Icon, text }, i) => (
                <Reveal key={text} delay={i * 60}>
                  <div className="flex items-center gap-3.5 rounded-xl bg-muted/50 p-4">
                    <Icon className="h-5 w-5 shrink-0 text-primary" />
                    <span className="text-sm sm:text-[15px]">{text}</span>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-8 text-center">
              <CtaButton id="cta-whatsapp-block">Вступить в WhatsApp-группу</CtaButton>
              <EventMeta className="mt-4" />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section className="border-t border-border/60 bg-card/40">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
          <Reveal className="text-center">
            <SectionTag>FAQ</SectionTag>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">Частые вопросы</h2>
          </Reveal>

          <Reveal delay={120}>
            <Accordion type="single" collapsible className="mt-10">
              {faq.map(({ q, a }) => (
                <AccordionItem key={q} value={q} className="border-border/60">
                  <AccordionTrigger className="text-left text-base font-semibold hover:no-underline sm:text-lg [&>svg]:text-primary">
                    {q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Финальный CTA ---------------- */}
      <section className="relative border-t border-border/60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 100%, hsl(210 90% 55% / 0.15), transparent)",
          }}
        />
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <Reveal>
            <h2 className="text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Через год ты можешь работать так же, как сейчас.
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground sm:text-xl">
              Или уже сегодня начать строить собственную AI-команду{" "}
              <span className="font-semibold text-foreground">и продавать системы, которые работают вместе с тобой</span>.
            </p>
            <p className="mt-4 text-muted-foreground">Я покажу, как это сделал сам. Теперь очередь за тобой.</p>
          </Reveal>

          <Reveal delay={150}>
            <div className="mt-10">
              <CtaButton size="xl" id="cta-final">
                Вступить в WhatsApp-группу
              </CtaButton>
            </div>
            <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
              После вступления ты получишь все инструкции, материалы для подготовки, дату и время эфира, а также ссылку на
              Zoom. Участие в практикуме бесплатное.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-primary text-[11px] font-extrabold text-primary-foreground">
              M
            </div>
            <span>AI Marketing Lab · MarkVision AI</span>
          </div>
          <span>© {new Date().getFullYear()} MarkVision AI. Все права защищены.</span>
        </div>
      </footer>

      {/* ---------------- Плавающая CTA (мобильная) ---------------- */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/90 p-3 backdrop-blur-md transition-transform duration-300 sm:hidden ${
          showStickyCta ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3.5 font-semibold text-primary-foreground shadow-glow"
        >
          <MessageCircle className="h-5 w-5" />
          Вступить в WhatsApp-группу
          <ChevronRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
};

export default Lab;
