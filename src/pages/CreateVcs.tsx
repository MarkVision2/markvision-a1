import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clapperboard, Loader2, Mic2, Music, Settings2, Sparkles, Type, Wand2 } from "lucide-react";
import Header from "@/components/factory/Header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  enqueueVcsJob,
  fetchActiveVcsJobs,
  fetchFinishedVcs,
  type VcsConfig,
  type VcsProfile,
} from "@/lib/vcsQueue";
import { ELEVEN_VOICES, DEFAULT_ELEVEN_VOICE } from "@/lib/elevenVoices";

const PROFILE_OPTIONS: { id: VcsProfile; title: string; description: string; icon: typeof Type }[] = [
  { id: "kinetic_clipart_v4", title: "Кинетик + клипарт", description: "Кинетические титры по словам, инфографика и анимированный клипарт", icon: Sparkles },
  { id: "classic", title: "Классический", description: "Видео-хук и субтитры поверх кадров — сдержанная подача", icon: Clapperboard },
];

const SPEED_OPTIONS = [
  { value: 1.0, label: "1.0×" },
  { value: 1.1, label: "1.1×" },
  { value: 1.2, label: "1.2×" },
  { value: 1.3, label: "1.3×" },
];

const STATUS_LABELS: Record<string, string> = {
  queued: "в очереди",
  processing: "в работе",
  rendering: "рендерится",
  failed: "ошибка",
};

const CreateVcs = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeId: projectId } = useProjectsStore();

  const [script, setScript] = useState("");
  const [profile, setProfile] = useState<VcsProfile>("kinetic_clipart_v4");
  const [elevenVoice, setElevenVoice] = useState<string>(DEFAULT_ELEVEN_VOICE);
  const [speed, setSpeed] = useState(1.2);
  const [music, setMusic] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const activeQ = useQuery({
    queryKey: ["vcs-jobs", projectId],
    queryFn: () => fetchActiveVcsJobs(projectId),
    enabled: !!projectId,
    refetchInterval: 15000,
  });
  const finishedQ = useQuery({
    queryKey: ["vcs-finished", projectId],
    queryFn: () => fetchFinishedVcs(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    setScript("");
  }, [projectId]);

  const canSubmit = !!projectId && script.trim().length > 10 && !submitting;
  const selectedVoice = useMemo(
    () => ELEVEN_VOICES.find((voice) => voice.id === elevenVoice),
    [elevenVoice],
  );

  const handleSubmit = async () => {
    if (!projectId) {
      toast.error("Сначала выбери проект");
      return;
    }
    if (script.trim().length <= 10) {
      toast.error("Слишком короткий сценарий");
      return;
    }
    setSubmitting(true);
    const config: VcsConfig = {
      profile,
      elevenVoice,
      voiceGenerationSpeed: speed,
      music,
      format: "9:16",
    };
    const res = await enqueueVcsJob(projectId, script, config);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error ?? "Не удалось поставить задачу");
      return;
    }
    toast.success("Креатив в очереди — ролик появится ниже");
    setScript("");
    queryClient.invalidateQueries({ queryKey: ["vcs-jobs", projectId] });
  };

  const activeJobs = activeQ.data ?? [];
  const finished = finishedQ.data ?? [];

  return (
    <div className="min-h-screen bg-background pb-20">
      <Header onClose={() => navigate("/")} />

      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4">
        <div className="mb-6 flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            <Type className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Вертикальные креативы</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              Сценарий → вертикальный VoiceOver-ролик: озвучка, кинетические титры, инфографика и музыка собираются автоматически. Готовый ролик появится в разделе «AI монтаж → Готовые».
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                <div>
                  <h2 className="text-sm font-semibold">Сценарий</h2>
                  <p className="text-[11px] text-muted-foreground">Точный текст озвучки — по нему собирается ролик</p>
                </div>
              </div>
              <Textarea
                value={script}
                onChange={(event) => setScript(event.target.value)}
                placeholder="Создай своё первое приложение за вечер. И узнай, как продавать такие решения бизнесу от $1 000. С нуля, без опыта, на удалёнке. Бесплатный воркшоп — жми «Подробнее» и получи доступ."
                className="min-h-40 resize-y bg-background text-sm"
                maxLength={4000}
              />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{script.trim().length < 11 ? "Минимум 11 символов" : "Сценарий готов"}</span>
                <span>{script.length} / 4000</span>
              </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                <div>
                  <h2 className="text-sm font-semibold">Стиль ролика</h2>
                  <p className="text-[11px] text-muted-foreground">Профиль рендера video-creative-system</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROFILE_OPTIONS.map((option) => {
                  const active = profile === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setProfile(option.id)}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border-2 p-3 text-left transition",
                        active ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/30",
                      )}
                    >
                      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
                        <option.icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{option.title}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{option.description}</span>
                      </span>
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                <div>
                  <h2 className="text-sm font-semibold">Озвучка</h2>
                  <p className="text-[11px] text-muted-foreground">Голос ElevenLabs и скорость</p>
                </div>
              </div>
              <Select value={elevenVoice} onValueChange={setElevenVoice}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Выберите голос" />
                </SelectTrigger>
                <SelectContent>
                  {ELEVEN_VOICES.some((voice) => voice.cloned) && (
                    <SelectGroup>
                      <SelectLabel>Ваши голоса (клон)</SelectLabel>
                      {ELEVEN_VOICES.filter((voice) => voice.cloned).map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>{voice.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Мужские</SelectLabel>
                    {ELEVEN_VOICES.filter((voice) => !voice.cloned && voice.gender === "male").map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>{voice.label}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Женские</SelectLabel>
                    {ELEVEN_VOICES.filter((voice) => !voice.cloned && voice.gender === "female").map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>{voice.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Mic2 className="h-3 w-3" /> {selectedVoice?.vibe}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">Скорость:</span>
                {SPEED_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSpeed(option.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      speed === option.value ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setMusic((value) => !value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    music ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Music className="h-3.5 w-3.5" /> Музыка {music ? "вкл" : "выкл"}
                  </span>
                </button>
              </div>
            </section>

            {activeJobs.length > 0 && (
              <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-semibold">В работе</h2>
                <ul className="space-y-2">
                  {activeJobs.map((job) => (
                    <li key={job.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{job.script?.slice(0, 60) ?? "—"}</span>
                      <span className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        job.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
                      )}>
                        {job.progress || STATUS_LABELS[job.status] || job.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <section className="rounded-2xl border border-border/60 bg-card/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Сводка ролика</h3>
              </div>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Сценарий</dt>
                  <dd className="font-medium">{script.trim().length > 10 ? `${script.trim().length} символов` : "не готов"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Стиль</dt>
                  <dd className="font-medium">{PROFILE_OPTIONS.find((item) => item.id === profile)?.title}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Голос</dt>
                  <dd className="max-w-[180px] truncate font-medium">{selectedVoice?.label ?? "ElevenLabs"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Скорость</dt>
                  <dd className="font-medium">{speed.toFixed(1)}×</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Музыка</dt>
                  <dd className="font-medium">{music ? "включена" : "без музыки"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Формат</dt>
                  <dd className="font-medium">1080×1920</dd>
                </div>
              </dl>

              <Button onClick={() => void handleSubmit()} disabled={!canSubmit} className="mt-4 w-full gap-2" size="lg">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Создать креатив
              </Button>
              {!projectId && <p className="mt-2 text-center text-[11px] text-destructive">Выберите проект в шапке.</p>}
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                Задача уйдёт в очередь; вкладку можно закрыть
              </p>
            </section>
          </aside>
        </div>

        {finished.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">Готовые креативы</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {finished.map((item) => (
                <a
                  key={item.id}
                  href={item.video_url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-xl border border-border/60 bg-card/60 transition hover:border-primary/40"
                >
                  <div className="aspect-[9/16] w-full overflow-hidden bg-secondary">
                    {item.thumbnail_url ? (
                      <img src={item.thumbnail_url} alt={item.title ?? ""} className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-muted-foreground/40">
                        <Type className="h-8 w-8" />
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-medium group-hover:text-primary">{item.title ?? "Креатив"}</p>
                    {item.duration_sec != null && (
                      <p className="text-[10px] text-muted-foreground">{item.duration_sec} c</p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default CreateVcs;
