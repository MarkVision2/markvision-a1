import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clapperboard, Download, Film, Loader2, Play, Sparkles } from "lucide-react";
import Header from "@/components/factory/Header";
import { AspectRatioPicker } from "@/components/factory/AspectRatioPicker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AspectId } from "@/data/contentTypeFlows";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  fetchAvatars,
  fetchTemplates,
  fetchVideoStatus,
  fetchVoices,
  generateAvatarVideo,
  generateTemplateVideo,
  type HeygenVideoStatus,
} from "@/hooks/useHeygen";

const ASPECTS: AspectId[] = ["9:16", "16:9", "1:1", "4:5"];

const DIMENSIONS: Record<AspectId, { width: number; height: number }> = {
  "9:16": { width: 720, height: 1280 },
  "16:9": { width: 1280, height: 720 },
  "1:1": { width: 720, height: 720 },
  "4:5": { width: 864, height: 1080 },
  "3:4": { width: 810, height: 1080 },
  "21:9": { width: 1280, height: 548 },
};

const isTerminal = (s?: string) => s === "completed" || s === "failed";

const CreateMontage = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"avatar" | "template">("avatar");
  const [aspect, setAspect] = useState<AspectId>("9:16");

  // Аватар + сценарий
  const [avatarId, setAvatarId] = useState<string>("");
  const [voiceId, setVoiceId] = useState<string>("");
  const [script, setScript] = useState("");

  // Шаблон
  const [templateId, setTemplateId] = useState<string>("");

  const [videoId, setVideoId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const avatarsQ = useQuery({ queryKey: ["heygen-avatars"], queryFn: fetchAvatars, staleTime: 300_000 });
  const voicesQ = useQuery({ queryKey: ["heygen-voices"], queryFn: fetchVoices, staleTime: 300_000 });
  const templatesQ = useQuery({
    queryKey: ["heygen-templates"],
    queryFn: fetchTemplates,
    staleTime: 300_000,
    enabled: mode === "template",
  });

  // Поллинг рендера, пока не терминальный статус.
  const statusQ = useQuery<HeygenVideoStatus>({
    queryKey: ["heygen-status", videoId],
    queryFn: () => fetchVideoStatus(videoId as string),
    enabled: !!videoId,
    refetchInterval: (q) => (isTerminal(q.state.data?.status) ? false : 8_000),
  });

  const loadError = avatarsQ.error || voicesQ.error;

  useEffect(() => {
    if (statusQ.data?.status === "failed") {
      toast.error("HeyGen: рендер не удался");
    }
  }, [statusQ.data?.status]);

  const canSubmitAvatar = !!avatarId && !!voiceId && script.trim().length > 0;
  const canSubmitTemplate = !!templateId;

  const handleGenerate = async () => {
    const dim = DIMENSIONS[aspect];
    setSubmitting(true);
    setVideoId(null);
    try {
      let id: string;
      if (mode === "avatar") {
        id = await generateAvatarVideo({
          avatarId,
          voiceId,
          script: script.trim(),
          width: dim.width,
          height: dim.height,
        });
      } else {
        id = await generateTemplateVideo({
          templateId,
          width: dim.width,
          height: dim.height,
        });
      }
      setVideoId(id);
      toast.success("Рендер запущен — собираем видео");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось запустить рендер");
    } finally {
      setSubmitting(false);
    }
  };

  const status = statusQ.data?.status;
  const rendering = !!videoId && !isTerminal(status);
  const done = status === "completed" && statusQ.data?.video_url;

  const busyLabel = useMemo(() => {
    if (submitting) return "Отправляем в HeyGen…";
    if (rendering) return "HeyGen собирает видео…";
    return null;
  }, [submitting, rendering]);

  return (
    <main className="min-h-screen bg-background pb-16">
      <Header onClose={() => navigate("/")} />

      <div className="container max-w-3xl px-3 pt-6 sm:px-4">
        <div className="mb-6 flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Clapperboard className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">AI монтаж</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Видео через HeyGen: аватар со сценарием или сборка по шаблону
            </p>
          </div>
        </div>

        {loadError && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Не удалось получить данные HeyGen: {(loadError as Error).message}.
              <br />
              Проверь, что в секретах Supabase задан <code>HEYGEN_API_KEY</code> и план даёт доступ к API.
            </div>
          </div>
        )}

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="grid w-full grid-cols-2 rounded-2xl">
            <TabsTrigger value="avatar" className="gap-2 rounded-xl">
              <Sparkles className="h-4 w-4" /> Аватар + сценарий
            </TabsTrigger>
            <TabsTrigger value="template" className="gap-2 rounded-xl">
              <Film className="h-4 w-4" /> По шаблону
            </TabsTrigger>
          </TabsList>

          {/* Аватар + сценарий */}
          <TabsContent value="avatar" className="mt-6 space-y-6 focus-visible:outline-none">
            <section>
              <label className="mb-2 block text-sm font-semibold">Аватар</label>
              {avatarsQ.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загружаем аватаров…
                </div>
              ) : (
                <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
                  {(avatarsQ.data ?? []).map((a) => (
                    <button
                      key={a.avatar_id}
                      type="button"
                      onClick={() => setAvatarId(a.avatar_id)}
                      className={cn(
                        "overflow-hidden rounded-xl border border-border/60 bg-card/60 text-left transition hover:border-primary/40",
                        avatarId === a.avatar_id && "border-primary ring-1 ring-primary/40",
                      )}
                    >
                      {a.preview_image_url ? (
                        <img src={a.preview_image_url} alt={a.avatar_name} className="aspect-[3/4] w-full object-cover" />
                      ) : (
                        <div className="grid aspect-[3/4] w-full place-items-center bg-secondary/50 text-muted-foreground">
                          <Sparkles className="h-6 w-6" />
                        </div>
                      )}
                      <div className="truncate p-2 text-xs font-medium">{a.avatar_name}</div>
                    </button>
                  ))}
                  {(avatarsQ.data ?? []).length === 0 && (
                    <p className="col-span-full text-sm text-muted-foreground">Аватары не найдены.</p>
                  )}
                </div>
              )}
            </section>

            <section>
              <label className="mb-2 block text-sm font-semibold">Голос</label>
              <Select value={voiceId} onValueChange={setVoiceId} disabled={voicesQ.isLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={voicesQ.isLoading ? "Загружаем голоса…" : "Выберите голос"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(voicesQ.data ?? []).map((v) => (
                    <SelectItem key={v.voice_id} value={v.voice_id}>
                      {v.name}
                      {v.language ? ` · ${v.language}` : ""}
                      {v.gender ? ` · ${v.gender}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            <section>
              <label className="mb-2 block text-sm font-semibold">Сценарий</label>
              <Textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={6}
                placeholder="Вставьте текст, который проговорит аватар…"
                className="resize-y"
              />
              <p className="mt-1 text-xs text-muted-foreground">{script.trim().length} символов</p>
            </section>
          </TabsContent>

          {/* По шаблону */}
          <TabsContent value="template" className="mt-6 space-y-6 focus-visible:outline-none">
            <section>
              <label className="mb-2 block text-sm font-semibold">Шаблон HeyGen</label>
              {templatesQ.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загружаем шаблоны…
                </div>
              ) : templatesQ.error ? (
                <p className="text-sm text-warning">
                  Шаблоны недоступны: {(templatesQ.error as Error).message}
                </p>
              ) : (
                <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
                  {(templatesQ.data ?? []).map((t) => (
                    <button
                      key={t.template_id}
                      type="button"
                      onClick={() => setTemplateId(t.template_id)}
                      className={cn(
                        "overflow-hidden rounded-xl border border-border/60 bg-card/60 text-left transition hover:border-primary/40",
                        templateId === t.template_id && "border-primary ring-1 ring-primary/40",
                      )}
                    >
                      {t.thumbnail_image_url ? (
                        <img src={t.thumbnail_image_url} alt={t.name} className="aspect-video w-full object-cover" />
                      ) : (
                        <div className="grid aspect-video w-full place-items-center bg-secondary/50 text-muted-foreground">
                          <Film className="h-6 w-6" />
                        </div>
                      )}
                      <div className="truncate p-2 text-xs font-medium">{t.name}</div>
                    </button>
                  ))}
                  {(templatesQ.data ?? []).length === 0 && (
                    <p className="col-span-full text-sm text-muted-foreground">Шаблоны не найдены.</p>
                  )}
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>

        {/* Формат — общий для обоих режимов */}
        <section className="mt-6">
          <label className="mb-2 block text-sm font-semibold">Формат</label>
          <AspectRatioPicker value={aspect} onChange={setAspect} allowed={ASPECTS} />
        </section>

        {/* Действие */}
        <div className="mt-8">
          <Button
            size="lg"
            className="w-full gap-2"
            disabled={submitting || rendering || (mode === "avatar" ? !canSubmitAvatar : !canSubmitTemplate)}
            onClick={handleGenerate}
          >
            {submitting || rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busyLabel ?? "Собрать видео"}
          </Button>
          {rendering && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Рендер обычно занимает пару минут — можно не закрывать вкладку.
            </p>
          )}
        </div>

        {/* Результат */}
        {done && (
          <section className="mt-8 rounded-2xl border border-border/60 bg-card/60 p-4">
            <h2 className="mb-3 text-sm font-semibold">Готово</h2>
            <video src={statusQ.data!.video_url} controls className="w-full rounded-xl" poster={statusQ.data?.thumbnail_url} />
            <a href={statusQ.data!.video_url} target="_blank" rel="noreferrer" download>
              <Button variant="secondary" className="mt-3 w-full gap-2">
                <Download className="h-4 w-4" /> Скачать MP4
              </Button>
            </a>
          </section>
        )}
      </div>
    </main>
  );
};

export default CreateMontage;
