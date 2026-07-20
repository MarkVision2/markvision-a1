import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot, Check, Film, FolderOpen, KeyRound, Library, Loader2, Mic2, Music,
  Settings2, Sparkles, Wand2,
} from "lucide-react";
import Header from "@/components/factory/Header";
import { ReelsAssetLibrary } from "@/components/factory/ReelsAssetLibrary";
import { ReelsGallery } from "@/components/factory/ReelsGallery";
import { ReelsProviderKeys } from "@/components/factory/ReelsProviderKeys";
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
  enqueueReelsJob,
  type ReelsConfig,
  type VoiceProvider,
} from "@/lib/reelsQueue";
import { ELEVEN_VOICES, DEFAULT_ELEVEN_VOICE } from "@/lib/elevenVoices";
import {
  buildReelsSourceConfig,
  fetchReelsAssetFolders,
  type ReelsBrollMode,
} from "@/lib/reelsAssets";
import {
  fetchReelsProviderStatus,
} from "@/lib/reelsProviderSettings";

const VOICE_OPTIONS: { id: VoiceProvider; label: string; hint: string }[] = [
  { id: "elevenlabs", label: "ElevenLabs", hint: "естественная озвучка + точные титры" },
  { id: "freedom", label: "Freedom (каз/рус)", hint: "казахский и русский голос" },
];

// Творческие форматы — маппятся на template движка на воркере.
const FORMAT_OPTIONS: { id: string; label: string }[] = [
  { id: "auto", label: "Авто" },
  { id: "expert", label: "Экспертный" },
  { id: "testimonial", label: "Отзыв" },
  { id: "bold_offer", label: "Оффер" },
  { id: "ugc", label: "UGC" },
];

const BROLL_OPTIONS: {
  id: ReelsBrollMode;
  title: string;
  description: string;
  icon: typeof Sparkles;
}[] = [
  { id: "auto", title: "Автоматически", description: "Система сама подберёт графику и вставки", icon: Sparkles },
  { id: "library", title: "Папки проекта", description: "Ваши B-roll по смыслу фразы + motion", icon: FolderOpen },
  { id: "pexels", title: "Pexels", description: "Стоковые видео по смыслу сценария", icon: Film },
  { id: "kie", title: "Kie.ai", description: "Сгенерировать уникальные видео через Kling", icon: Bot },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const CreateReels = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeId: projectId } = useProjectsStore();
  const [searchParams] = useSearchParams();

  const initialTab = (() => {
    const t = searchParams.get("tab");
    return t === "library" || t === "providers" || t === "create" ? t : "create";
  })();
  const [pageTab, setPageTab] = useState<"create" | "library" | "providers">(initialTab);
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "library" || t === "providers" || t === "create") setPageTab(t);
  }, [searchParams]);
  const [script, setScript] = useState("");
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("elevenlabs");
  const [elevenVoice, setElevenVoice] = useState<string>(DEFAULT_ELEVEN_VOICE);
  const [format, setFormat] = useState("auto");
  const [music, setMusic] = useState(true);
  const [brollMode, setBrollMode] = useState<ReelsBrollMode>("auto");
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const foldersQ = useQuery({
    queryKey: ["reels-asset-folders", projectId],
    queryFn: () => fetchReelsAssetFolders(projectId),
    enabled: !!projectId,
  });
  const providersQ = useQuery({
    queryKey: ["reels-provider-status", projectId],
    queryFn: () => fetchReelsProviderStatus(projectId),
    enabled: !!projectId,
  });
  useEffect(() => {
    setSelectedFolderIds([]);
    setBrollMode("auto");
  }, [projectId]);
  const effectiveProviderStatus = providersQ.data ?? {};
  const sourceConfig = useMemo(
    () => buildReelsSourceConfig(brollMode, selectedFolderIds),
    [brollMode, selectedFolderIds],
  );
  const sourceReady =
    (brollMode !== "pexels" || !!effectiveProviderStatus.pexels?.connected) &&
    (brollMode !== "kie" || !!effectiveProviderStatus.kie?.connected);
  const canSubmit = !!projectId && script.trim().length > 10 && sourceReady && !submitting;

  const handleSubmit = async () => {
    if (!projectId) {
      toast.error("Сначала выбери проект");
      return;
    }
    if (script.trim().length <= 10) {
      toast.error("Слишком короткий сценарий");
      return;
    }
    if (!sourceReady) {
      toast.error(`Сначала подключите ${brollMode === "pexels" ? "Pexels" : "Kie.ai"} во вкладке «Источники»`);
      setPageTab("providers");
      return;
    }
    setSubmitting(true);
    const config: ReelsConfig = {
      voiceProvider,
      elevenVoice: voiceProvider === "elevenlabs" ? elevenVoice : undefined,
      videoMode: "faceless",
      format,
      music,
      genProvider: sourceConfig.brollMode === "kie" ? "kie" : "none",
      genMax: sourceConfig.brollMode === "kie" ? 2 : 0,
      ...sourceConfig,
    };
    const res = await enqueueReelsJob(projectId, script, config);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error ?? "Не удалось поставить задачу");
      return;
    }
    toast.success("Reels в очереди — ролик появится ниже");
    setScript("");
    // мгновенно показать новую задачу в галерее
    queryClient.invalidateQueries({ queryKey: ["reels-jobs", projectId] });
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <Header onClose={() => navigate("/")} />

      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4">
        <div className="mb-6 flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            <Film className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Reels-видео</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              Соберите вертикальный ролик из сценария, своего B-roll, Pexels или генерации Kie.ai. Озвучка, титры и монтаж добавятся автоматически.
            </p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-1 rounded-2xl border border-border/60 bg-card/50 p-1">
          {[
            { id: "create" as const, label: "Создать Reels", icon: Wand2 },
            { id: "library" as const, label: "Медиатека проекта", icon: Library },
            { id: "providers" as const, label: "Источники и ключи", icon: KeyRound },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPageTab(tab.id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[11px] font-medium transition sm:text-sm",
                pageTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <tab.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </div>

        {pageTab === "create" && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                  <div>
                    <h2 className="text-sm font-semibold">Сценарий</h2>
                    <p className="text-[11px] text-muted-foreground">Текст озвучки и смысл будущих кадров</p>
                  </div>
                </div>
                <Textarea
                  value={script}
                  onChange={(event) => setScript(event.target.value)}
                  placeholder="Вставьте текст ролика. Например: Хватит сливать бюджет на рекламу вслепую. Бесплатный разбор покажет, где вы теряете заявки. Пишите «плюс»."
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
                    <h2 className="text-sm font-semibold">Озвучка</h2>
                    <p className="text-[11px] text-muted-foreground">Провайдер и голос ролика</p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {VOICE_OPTIONS.map((voice) => (
                    <button
                      key={voice.id}
                      type="button"
                      onClick={() => setVoiceProvider(voice.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border-2 p-3 text-left transition",
                        voiceProvider === voice.id ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/30",
                      )}
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Mic2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{voice.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{voice.hint}</span>
                      </span>
                      {voiceProvider === voice.id && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  ))}
                </div>

                {voiceProvider === "elevenlabs" && (
                  <div className="mt-3">
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
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {ELEVEN_VOICES.find((voice) => voice.id === elevenVoice)?.vibe}
                    </p>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                  <div>
                    <h2 className="text-sm font-semibold">Стиль ролика</h2>
                    <p className="text-[11px] text-muted-foreground">Подача, музыка и структура</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {FORMAT_OPTIONS.map((item) => (
                    <Chip key={item.id} active={format === item.id} onClick={() => setFormat(item.id)}>
                      {item.label}
                    </Chip>
                  ))}
                  <Chip active={music} onClick={() => setMusic((value) => !value)}>
                    <span className="inline-flex items-center gap-1.5">
                      <Music className="h-3.5 w-3.5" /> Музыка {music ? "вкл" : "выкл"}
                    </span>
                  </Chip>
                </div>
              </section>

              <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                  <div>
                    <h2 className="text-sm font-semibold">Откуда брать B-roll</h2>
                    <p className="text-[11px] text-muted-foreground">Выберите один источник визуальных вставок</p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {BROLL_OPTIONS.map((option) => {
                    const connected = option.id === "pexels"
                      ? effectiveProviderStatus.pexels?.connected
                      : option.id === "kie"
                        ? effectiveProviderStatus.kie?.connected
                        : true;
                    const active = brollMode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          if (!connected) {
                            setPageTab("providers");
                            toast.info(`Сначала подключите ${option.title}`);
                            return;
                          }
                          setBrollMode(option.id);
                        }}
                        className={cn(
                          "relative flex items-start gap-3 rounded-xl border-2 p-3 text-left transition",
                          active ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/30",
                        )}
                      >
                        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
                          <option.icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm font-semibold">
                            {option.title}
                            {!connected && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-600">нужен ключ</span>}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{option.description}</span>
                        </span>
                        {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>

                {brollMode === "library" && (
                  <div className="mt-3 rounded-xl border border-border/60 bg-background p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">Папки для вставок по смыслу</span>
                      <button type="button" onClick={() => setPageTab("library")} className="text-[11px] font-medium text-primary hover:underline">
                        Управлять медиатекой
                      </button>
                    </div>
                    {(foldersQ.data ?? []).length === 0 ? (
                      <button type="button" onClick={() => setPageTab("library")} className="w-full rounded-lg border border-dashed border-border/60 py-3 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
                        Создать папку и загрузить B-roll
                      </button>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(foldersQ.data ?? []).map((folder) => (
                          <Chip
                            key={folder.id}
                            active={selectedFolderIds.includes(folder.id)}
                            onClick={() => setSelectedFolderIds((current) =>
                              current.includes(folder.id)
                                ? current.filter((id) => id !== folder.id)
                                : [...current, folder.id])}
                          >
                            <span className="inline-flex items-center gap-1">
                              <FolderOpen className="h-3 w-3" /> {folder.name} · {folder.asset_count ?? 0}
                            </span>
                          </Chip>
                        ))}
                      </div>
                    )}
                    {selectedFolderIds.length === 0 && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Папка не выбрана — для этой заявки система автоматически создаст визуальные вставки.
                      </p>
                    )}
                  </div>
                )}
              </section>
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
                    <dt className="text-muted-foreground">Голос</dt>
                    <dd className="max-w-[180px] truncate font-medium">
                      {voiceProvider === "elevenlabs"
                        ? ELEVEN_VOICES.find((voice) => voice.id === elevenVoice)?.label ?? "ElevenLabs"
                        : "Freedom"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Формат</dt>
                    <dd className="font-medium">{FORMAT_OPTIONS.find((item) => item.id === format)?.label}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">B-roll</dt>
                    <dd className="font-medium">{BROLL_OPTIONS.find((item) => item.id === sourceConfig.brollMode)?.title}</dd>
                  </div>
                  {sourceConfig.brollMode === "library" && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Папки</dt>
                      <dd className="font-medium">{sourceConfig.assetFolderIds.length}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Музыка</dt>
                    <dd className="font-medium">{music ? "включена" : "без музыки"}</dd>
                  </div>
                </dl>

                <Button onClick={() => void handleSubmit()} disabled={!canSubmit} className="mt-4 w-full gap-2" size="lg">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Создать Reels
                </Button>
                {!projectId && <p className="mt-2 text-center text-[11px] text-destructive">Выберите проект в шапке.</p>}
                {projectId && !sourceReady && (
                  <button type="button" onClick={() => setPageTab("providers")} className="mt-2 w-full text-center text-[11px] text-amber-600 hover:underline">
                    Подключите ключ выбранного источника
                  </button>
                )}
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Задача уйдёт в очередь; вкладку можно закрыть
                </p>
              </section>
            </aside>
          </div>
        )}

        {pageTab === "library" && (
          <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
            <ReelsAssetLibrary
              projectId={projectId}
              selectedFolderIds={selectedFolderIds}
              onSelectionChange={setSelectedFolderIds}
            />
          </section>
        )}

        {pageTab === "providers" && (
          <section className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
            <ReelsProviderKeys projectId={projectId} />
          </section>
        )}

        <ReelsGallery projectId={projectId} />
      </main>
    </div>
  );
};

export default CreateReels;
