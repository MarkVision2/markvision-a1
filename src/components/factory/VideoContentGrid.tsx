import { ArrowRight, Bot, Mic, Scissors } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface VideoFormat {
  id: string;
  title: string;
  subtitle: string;
  route: string;
  icon: typeof Bot;
  badge?: string;
}

// Три инструмента видео — по тому, что даёт пользователь на входе:
// только сценарий → сценарий + аватар → своя съёмка.
const VIDEO_FORMATS: VideoFormat[] = [
  {
    id: "voiceover",
    title: "Видео с озвучкой",
    subtitle: "Только сценарий → ИИ-озвучка + графика, б-роллы и титры (без камеры)",
    route: "/create/reels",
    icon: Mic,
    badge: "AI",
  },
  {
    id: "avatar",
    title: "Видео с аватаром",
    subtitle: "Сценарий → говорящий AI-аватар (HeyGen)",
    route: "/create/montage",
    icon: Bot,
    badge: "AI",
  },
  {
    id: "footage-edit",
    title: "Монтаж моей съёмки",
    subtitle: "Загрузи своё видео — соберём динамичный ролик и шортсы",
    route: "/create/montage-lab",
    icon: Scissors,
    badge: "AI",
  },
];

const VideoContentGrid = () => {
  const navigate = useNavigate();
  return (
    <section className="space-y-3 pb-2" aria-label="Выбор формата видео">
      <div className="mb-3 flex items-baseline gap-2 px-0.5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Видео</h3>
        <span className="truncate text-xs text-muted-foreground">· озвучка, аватар, монтаж съёмки</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {VIDEO_FORMATS.map((f) => {
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => navigate(f.route)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/60 p-4 text-left transition",
                "hover:border-primary/40 hover:bg-card active:scale-[0.99]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate text-[15px] font-semibold leading-snug group-hover:text-primary">{f.title}</h3>
                  {f.badge && (
                    <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                      {f.badge}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{f.subtitle}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default VideoContentGrid;
