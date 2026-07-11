import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Film, Loader2, Music, Sparkles, Wand2 } from "lucide-react";
import Header from "@/components/factory/Header";
import { ReelsGallery } from "@/components/factory/ReelsGallery";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  enqueueReelsJob,
  type GenProvider,
  type ReelsConfig,
  type VoiceProvider,
} from "@/lib/reelsQueue";

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

  const [script, setScript] = useState("");
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("elevenlabs");
  const [format, setFormat] = useState("auto");
  const [music, setMusic] = useState(true);
  const [genProvider, setGenProvider] = useState<GenProvider>("none");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !!projectId && script.trim().length > 10 && !submitting;

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
    const config: ReelsConfig = {
      voiceProvider,
      videoMode: "faceless",
      format,
      music,
      genProvider,
      genMax: genProvider === "fal" ? 2 : 0,
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
    <div className="min-h-screen bg-background">
      <Header onClose={() => navigate("/")} />

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Film className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-lg font-bold">Reels-видео</h1>
            <p className="text-xs text-muted-foreground">
              Сценарий → вертикальный ролик с озвучкой, титрами и музыкой. Рендер на сервере — можно закрыть вкладку.
            </p>
          </div>
        </div>

        <div className="space-y-5 rounded-2xl border border-border/60 bg-card/60 p-4">
          {/* Сценарий */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Сценарий
            </label>
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Вставь текст ролика. Например: Хватит сливать бюджет на рекламу вслепую. Бесплатный разбор покажет, где вы теряете заявки. Пиши плюс."
              className="min-h-32 resize-y"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{script.trim().length} символов</p>
          </div>

          {/* Озвучка */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Озвучка
            </label>
            <div className="flex flex-wrap gap-2">
              {VOICE_OPTIONS.map((v) => (
                <Chip key={v.id} active={voiceProvider === v.id} onClick={() => setVoiceProvider(v.id)}>
                  {v.label}
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {VOICE_OPTIONS.find((v) => v.id === voiceProvider)?.hint}
            </p>
          </div>

          {/* Формат */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Формат
            </label>
            <div className="flex flex-wrap gap-2">
              {FORMAT_OPTIONS.map((f) => (
                <Chip key={f.id} active={format === f.id} onClick={() => setFormat(f.id)}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>

          {/* Тумблеры */}
          <div className="flex flex-wrap gap-2">
            <Chip active={music} onClick={() => setMusic((m) => !m)}>
              <span className="inline-flex items-center gap-1.5">
                <Music className="h-3.5 w-3.5" /> Музыка {music ? "вкл" : "выкл"}
              </span>
            </Chip>
            <Chip active={genProvider === "fal"} onClick={() => setGenProvider((g) => (g === "fal" ? "none" : "fal"))}>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> ИИ-кадры {genProvider === "fal" ? "вкл" : "выкл"}
              </span>
            </Chip>
          </div>
          {genProvider === "fal" && (
            <p className="-mt-2 text-[11px] text-muted-foreground">
              ИИ-кадры платные (за клип), лимит 2 на ролик. Без них — сток и локальные клипы проекта.
            </p>
          )}

          {/* Кнопка */}
          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full gap-2" size="lg">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Сделать Reels
          </Button>
          {!projectId && (
            <p className="text-center text-[11px] text-destructive">Выбери проект в шапке, чтобы создать ролик.</p>
          )}
        </div>

        <ReelsGallery projectId={projectId} />
      </main>
    </div>
  );
};

export default CreateReels;
