/**
 * Настройки контент-конвейера по проекту (content_pipeline_settings): сценарий
 * (язык, длина, тон, контекст, запреты), HeyGen (аватар, голос, кадр), лимиты
 * попыток и параллельности, бюджеты, чат согласования. До этого значения
 * задавались только SQL в Supabase Studio. Таблица под RLS проекта — читаем и
 * пишем напрямую, edge-функция берёт их через content_pipeline_settings_json.
 */
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { supabase } from "@/integrations/supabase/client";

export interface PipelineSettingsRow {
  enabled: boolean;
  language: string;
  script_words_min: number;
  script_words_max: number;
  tone_of_voice: string | null;
  business_context: string | null;
  forbidden_phrases: string[];
  openai_model: string;
  heygen_avatar_id: string | null;
  heygen_voice_id: string | null;
  video_width: number;
  video_height: number;
  video_timeout_minutes: number;
  max_attempts: number;
  max_parallel_videos: number;
  daily_budget_usd: number;
  monthly_budget_usd: number;
  telegram_chat_id: string | null;
}

/** Умолчания — те же, что в content_pipeline_settings_json без строки. */
export const PIPELINE_DEFAULTS: PipelineSettingsRow = {
  enabled: true, language: "ru", script_words_min: 90, script_words_max: 130,
  tone_of_voice: null, business_context: null, forbidden_phrases: [],
  openai_model: "gpt-4o-mini", heygen_avatar_id: null, heygen_voice_id: null,
  video_width: 720, video_height: 1280, video_timeout_minutes: 20,
  max_attempts: 3, max_parallel_videos: 1, daily_budget_usd: 10, monthly_budget_usd: 100,
  telegram_chat_id: null,
};

const LANGUAGES = [
  { value: "ru", label: "Русский" },
  { value: "kk", label: "Казахский" },
  { value: "en", label: "English" },
];
const FRAMES = [
  { value: "720x1280", label: "720 × 1280 (вертикаль, экономно)" },
  { value: "1080x1920", label: "1080 × 1920 (вертикаль, Full HD)" },
  { value: "1280x720", label: "1280 × 720 (горизонталь)" },
];

interface Form {
  enabled: boolean;
  language: string;
  wordsMin: string;
  wordsMax: string;
  tone: string;
  context: string;
  forbidden: string;
  model: string;
  avatar: string;
  voice: string;
  frame: string;
  timeout: string;
  attempts: string;
  parallel: string;
  daily: string;
  monthly: string;
  chat: string;
}

function toForm(r: PipelineSettingsRow): Form {
  return {
    enabled: r.enabled,
    language: r.language,
    wordsMin: String(r.script_words_min),
    wordsMax: String(r.script_words_max),
    tone: r.tone_of_voice ?? "",
    context: r.business_context ?? "",
    forbidden: (r.forbidden_phrases ?? []).join(", "),
    model: r.openai_model,
    avatar: r.heygen_avatar_id ?? "",
    voice: r.heygen_voice_id ?? "",
    frame: `${r.video_width}x${r.video_height}`,
    timeout: String(r.video_timeout_minutes),
    attempts: String(r.max_attempts),
    parallel: String(r.max_parallel_videos),
    daily: String(r.daily_budget_usd),
    monthly: String(r.monthly_budget_usd),
    chat: r.telegram_chat_id ?? "",
  };
}

const int = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** Форма → строка таблицы; текст ошибки, если значения не пройдут CHECK в базе. */
export function fromForm(f: Form): { row: PipelineSettingsRow } | { error: string } {
  const wordsMin = int(f.wordsMin), wordsMax = int(f.wordsMax);
  if (!Number.isInteger(wordsMin) || wordsMin < 1) return { error: "Минимум слов — целое число от 1" };
  if (!Number.isInteger(wordsMax) || wordsMax < wordsMin) return { error: "Максимум слов — целое число не меньше минимума" };
  const attempts = int(f.attempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) return { error: "Попыток — от 1 до 10" };
  const parallel = int(f.parallel);
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 20) return { error: "Параллельных видео — от 1 до 20" };
  const timeout = int(f.timeout);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 180) return { error: "Таймаут видео — от 1 до 180 минут" };
  const daily = Number(f.daily), monthly = Number(f.monthly);
  if (!(daily >= 0) || !(monthly >= 0)) return { error: "Бюджеты — число не меньше 0" };
  const [w, h] = f.frame.split("x").map(Number);
  if (!w || !h) return { error: "Выберите размер кадра" };
  if (!f.model.trim()) return { error: "Укажите модель OpenAI" };
  return {
    row: {
      enabled: f.enabled,
      language: f.language,
      script_words_min: wordsMin,
      script_words_max: wordsMax,
      tone_of_voice: f.tone.trim() || null,
      business_context: f.context.trim() || null,
      forbidden_phrases: Array.from(new Set(f.forbidden.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))),
      openai_model: f.model.trim(),
      heygen_avatar_id: f.avatar.trim() || null,
      heygen_voice_id: f.voice.trim() || null,
      video_width: w,
      video_height: h,
      video_timeout_minutes: timeout,
      max_attempts: attempts,
      max_parallel_videos: parallel,
      daily_budget_usd: daily,
      monthly_budget_usd: monthly,
      telegram_chat_id: f.chat.trim() || null,
    },
  };
}

// Таблица не описана в сгенерированных типах Supabase — обращаемся по имени, как useContentPlan.
const table = () => supabase.from("content_pipeline_settings" as never);

export function ContentPipelineSettings() {
  const { activeId: projectId } = useProjectsStore();
  const [form, setForm] = useState<Form>(toForm(PIPELINE_DEFAULTS));
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: qErr } = await table().select("*").eq("project_id", projectId).maybeSingle();
      if (!alive) return;
      if (qErr) setError(qErr.message);
      const row = (data as PipelineSettingsRow | null) ?? null;
      setExists(Boolean(row));
      setForm(toForm(row ? { ...PIPELINE_DEFAULTS, ...row } : PIPELINE_DEFAULTS));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [projectId]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!projectId) return;
    const parsed = fromForm(form);
    if ("error" in parsed) { setError(parsed.error); toast.error(parsed.error); return; }
    setSaving(true);
    setError(null);
    try {
      const { error: uErr } = await table().upsert({ project_id: projectId, ...parsed.row } as never, { onConflict: "project_id" });
      if (uErr) throw new Error(uErr.message);
      setExists(true);
      toast.success("Настройки конвейера сохранены");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Не удалось сохранить";
      setError(m);
      toast.error(m);
    } finally {
      setSaving(false);
    }
  };

  if (!projectId) return <p className="text-sm text-muted-foreground">Выберите проект.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Контент-конвейер</h2>
          <p className="text-sm text-muted-foreground">
            Тема из контент-плана → сценарий OpenAI → видео HeyGen → согласование. Настройки этого проекта.
            {!exists && !loading && " Пока действуют умолчания — сохраните, чтобы закрепить."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="cp-enabled" className="text-sm">Конвейер включён</Label>
          <Switch id="cp-enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={loading} />
        </div>
      </div>

      <section className="grid gap-4 rounded-2xl border p-4 sm:grid-cols-2">
        <h3 className="text-sm font-semibold sm:col-span-2">Сценарий</h3>
        <div className="space-y-1.5">
          <Label>Язык</Label>
          <Select value={form.language} onValueChange={(v) => set("language", v)}>
            <SelectTrigger aria-label="Язык сценария"><SelectValue /></SelectTrigger>
            <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cp-words-min">Слов, минимум</Label>
            <Input id="cp-words-min" type="number" min={1} value={form.wordsMin} onChange={(e) => set("wordsMin", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-words-max">Слов, максимум</Label>
            <Input id="cp-words-max" type="number" min={1} value={form.wordsMax} onChange={(e) => set("wordsMax", e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cp-tone">Тон голоса</Label>
          <Textarea id="cp-tone" rows={2} value={form.tone} placeholder="Уверенно, по делу, без канцелярита…" onChange={(e) => set("tone", e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cp-context">Контекст бизнеса</Label>
          <Textarea id="cp-context" rows={3} value={form.context} placeholder="Кто мы, для кого, что продаём, чем отличаемся…" onChange={(e) => set("context", e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cp-forbidden">Запрещённые фразы (через запятую)</Label>
          <Input id="cp-forbidden" value={form.forbidden} placeholder="гарантируем, лучший в мире" onChange={(e) => set("forbidden", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-model">Модель OpenAI</Label>
          <Input id="cp-model" value={form.model} onChange={(e) => set("model", e.target.value)} />
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border p-4 sm:grid-cols-2">
        <h3 className="text-sm font-semibold sm:col-span-2">Видео HeyGen</h3>
        <div className="space-y-1.5">
          <Label htmlFor="cp-avatar">ID аватара</Label>
          <Input id="cp-avatar" value={form.avatar} placeholder="avatar_id из HeyGen" onChange={(e) => set("avatar", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-voice">ID голоса</Label>
          <Input id="cp-voice" value={form.voice} placeholder="voice_id из HeyGen" onChange={(e) => set("voice", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Кадр</Label>
          <Select value={form.frame} onValueChange={(v) => set("frame", v)}>
            <SelectTrigger aria-label="Размер кадра"><SelectValue /></SelectTrigger>
            <SelectContent>{FRAMES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-timeout">Ждать рендер, минут</Label>
          <Input id="cp-timeout" type="number" min={1} max={180} value={form.timeout} onChange={(e) => set("timeout", e.target.value)} />
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border p-4 sm:grid-cols-2">
        <h3 className="text-sm font-semibold sm:col-span-2">Лимиты и бюджет</h3>
        <div className="space-y-1.5">
          <Label htmlFor="cp-attempts">Попыток на тему</Label>
          <Input id="cp-attempts" type="number" min={1} max={10} value={form.attempts} onChange={(e) => set("attempts", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-parallel">Параллельных видео</Label>
          <Input id="cp-parallel" type="number" min={1} max={20} value={form.parallel} onChange={(e) => set("parallel", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-daily">Бюджет в день, $</Label>
          <Input id="cp-daily" type="number" min={0} step="0.5" value={form.daily} onChange={(e) => set("daily", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-monthly">Бюджет в месяц, $</Label>
          <Input id="cp-monthly" type="number" min={0} step="1" value={form.monthly} onChange={(e) => set("monthly", e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cp-chat">Чат согласования в Telegram (chat_id)</Label>
          <Input id="cp-chat" value={form.chat} placeholder="Пусто — чат проекта" onChange={(e) => set("chat", e.target.value)} />
        </div>
      </section>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving || loading}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Сохранить
        </Button>
      </div>
    </div>
  );
}
