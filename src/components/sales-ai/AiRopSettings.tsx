import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Plus,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ROP_SETTINGS,
  getRopSettings,
  saveRopSettings,
  subscribeAiRop,
  type RopSettings,
} from "@/lib/aiRopStorage";
import { useToast } from "@/hooks/use-toast";

const TONE_OPTIONS: { id: RopSettings["tone"]; label: string; hint: string }[] = [
  { id: "strict", label: "Строгий", hint: "Жёсткие оценки, акцент на ошибках" },
  { id: "neutral", label: "Нейтральный", hint: "Сухие факты, без эмоций" },
  { id: "supportive", label: "Поддерживающий", hint: "С похвалой, мягкие рекомендации" },
];

export function AiRopSettings() {
  const { toast } = useToast();
  const [s, setS] = useState<RopSettings>(getRopSettings);
  const [dirty, setDirty] = useState(false);
  const [newWatchItem, setNewWatchItem] = useState("");
  // Используем ref на dirty, чтобы подписка ниже видела актуальное значение
  // без переподписки на каждое нажатие клавиши.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    setS(getRopSettings());
    return subscribeAiRop("settings", () => {
      // Если пользователь редактирует и не сохранил — не затираем его правки
      // при внешних обновлениях (гидратация, смена проекта, фоновый sync).
      if (dirtyRef.current) return;
      setS(getRopSettings());
    });
  }, []);

  const patch = <K extends keyof RopSettings>(key: K, value: RopSettings[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const patchNested = <K extends "sla" | "kpi" | "autoActions">(
    key: K,
    sub: keyof RopSettings[K],
    value: RopSettings[K][keyof RopSettings[K]],
  ) => {
    setS((prev) => ({ ...prev, [key]: { ...prev[key], [sub]: value } }));
    setDirty(true);
  };

  const onSave = () => {
    saveRopSettings(s);
    setDirty(false);
    toast({ title: "Настройки РОПа сохранены", description: "ИИ будет работать по новым правилам." });
  };

  const onReset = () => {
    setS(DEFAULT_ROP_SETTINGS);
    setDirty(true);
  };

  const addWatchItem = () => {
    const v = newWatchItem.trim();
    if (!v) return;
    patch("watchList", [...s.watchList, v]);
    setNewWatchItem("");
  };

  const removeWatchItem = (idx: number) => {
    patch("watchList", s.watchList.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <Section title="Системный промпт" hint="Главные инструкции — кто такой РОП и за чем следит" icon={Bot}>
        <textarea
          value={s.systemPrompt}
          onChange={(e) => patch("systemPrompt", e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-border/60 bg-background/40 p-3 text-xs leading-relaxed outline-none focus:border-primary/50"
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Этот текст подмешивается в каждый запрос к ИИ-РОПу. Чем точнее опишете задачу — тем
          предсказуемее будут оценки и рекомендации.
        </p>
      </Section>

      <Section title="Что контролировать" hint="Чек-лист пунктов, по которым ИИ оценивает работу" icon={Check}>
        <div className="space-y-1.5">
          {s.watchList.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2 py-1.5 text-xs"
            >
              <Check className="h-3.5 w-3.5 text-success" />
              <span className="flex-1">{item}</span>
              <button
                onClick={() => removeWatchItem(idx)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newWatchItem}
            onChange={(e) => setNewWatchItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addWatchItem()}
            placeholder="Например: уточнять источник заявки в начале разговора"
            className="flex-1 rounded-lg border border-border/60 bg-background/40 px-3 py-1.5 text-xs outline-none focus:border-primary/50"
          />
          <button
            onClick={addWatchItem}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить
          </button>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="SLA-пороги" hint="При каких задержках поднимать тревогу" icon={SettingsIcon}>
          <div className="space-y-3">
            <NumberField
              label="Норма первого ответа, мин"
              value={s.sla.firstResponseMin}
              onChange={(v) => patchNested("sla", "firstResponseMin", v)}
            />
            <NumberField
              label="Перезвон по «без ответа», часов"
              value={s.sla.callbackHours}
              onChange={(v) => patchNested("sla", "callbackHours", v)}
            />
            <NumberField
              label="Молчание в чате, часов"
              value={s.sla.chatIdleHours}
              onChange={(v) => patchNested("sla", "chatIdleHours", v)}
            />
          </div>
        </Section>

        <Section title="KPI-цели" hint="Что считать нормой для менеджера" icon={SettingsIcon}>
          <div className="space-y-3">
            <NumberField
              label="Мин. конверсия в продажу, %"
              value={s.kpi.minConversionPct}
              onChange={(v) => patchNested("kpi", "minConversionPct", v)}
            />
            <NumberField
              label="Мин. дозвон, %"
              value={s.kpi.minDialPct}
              onChange={(v) => patchNested("kpi", "minDialPct", v)}
            />
            <NumberField
              label="Макс. потери, %"
              value={s.kpi.maxRejectPct}
              onChange={(v) => patchNested("kpi", "maxRejectPct", v)}
            />
          </div>
        </Section>
      </div>

      <Section title="Тон обратной связи" hint="Как ИИ говорит с менеджерами" icon={Bot}>
        <div className="grid grid-cols-3 gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => patch("tone", opt.id)}
              className={cn(
                "rounded-xl border p-3 text-left text-xs transition-colors",
                s.tone === opt.id
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/60 bg-background/40 hover:bg-secondary/40",
              )}
            >
              <div className="font-semibold">{opt.label}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{opt.hint}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Автодействия" hint="Что РОП делает без вашего участия" icon={Bot}>
        <div className="space-y-2">
          <Toggle
            label="Предлагать новые скрипты на основе разговоров"
            value={s.autoActions.suggestScripts}
            onChange={(v) => patchNested("autoActions", "suggestScripts", v)}
          />
          <Toggle
            label="Помечать просроченные SLA в реальном времени"
            value={s.autoActions.flagMissedSLA}
            onChange={(v) => patchNested("autoActions", "flagMissedSLA", v)}
          />
          <Toggle
            label="Генерировать идеи контента из вопросов клиентов"
            value={s.autoActions.generateContentIdeas}
            onChange={(v) => patchNested("autoActions", "generateContentIdeas", v)}
          />
          <Toggle
            label="Оценивать каждый звонок"
            value={s.autoActions.scoreCalls}
            onChange={(v) => patchNested("autoActions", "scoreCalls", v)}
          />
          <Toggle
            label="Оценивать каждую переписку"
            value={s.autoActions.scoreChats}
            onChange={(v) => patchNested("autoActions", "scoreChats", v)}
          />
        </div>
      </Section>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 rounded-2xl border border-border/60 bg-background/90 p-3 backdrop-blur">
        {dirty && (
          <span className="mr-auto text-[11px] text-warning">Есть несохранённые изменения</span>
        )}
        <button
          onClick={onReset}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Сбросить
        </button>
        <button
          onClick={onSave}
          disabled={!dirty}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold",
            dirty
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-secondary/60 text-muted-foreground",
          )}
        >
          <Save className="h-3.5 w-3.5" />
          Сохранить
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  icon: Icon,
  children,
}: {
  title: string;
  hint: string;
  icon: typeof SettingsIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-bold tracking-tight">{title}</h3>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        min={0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-20 rounded-lg border border-border/60 bg-background/40 px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-primary/50"
      />
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
      <span>{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          value ? "bg-primary" : "bg-secondary/80",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform",
            value ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}
