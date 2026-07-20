import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  AlertCircle,
  Crosshair,
  Target,
  X,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  useMetaPageAssets,
  type PixelEventItem,
  type PixelItem,
} from "@/hooks/useMetaPageAssets";
import {
  hideAllExcept,
  readHiddenPixelEvents,
  writeHiddenPixelEvents,
} from "@/lib/pixelEventPrefs";
import { cn } from "@/lib/utils";
import type { AdCabinet } from "@/types/ads";

type Goal = "whatsapp" | "site-leads" | "meta-form";

interface Props {
  goal: Goal;
  cabinet: AdCabinet | undefined;
  whatsappId: string;
  setWhatsappId: (v: string) => void;
  pixelId: string;
  setPixelId: (v: string) => void;
  pixelEvent: string;
  setPixelEvent: (v: string) => void;
  leadFormId: string;
  setLeadFormId: (v: string) => void;
}

const fieldLabelCls =
  "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

const FieldShell = ({
  label,
  isLoading,
  error,
  onRefresh,
  children,
  icon: Icon,
}: {
  label: string;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  children: React.ReactNode;
  icon?: typeof Crosshair;
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <Label className={cn(fieldLabelCls, "flex items-center gap-1.5")}>
        {Icon && <Icon className="h-3 w-3 opacity-70" />}
        {label}
      </Label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        className="h-7 gap-1 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
        Обновить
      </Button>
    </div>
    {error ? (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>{error}</span>
      </div>
    ) : (
      children
    )}
  </div>
);

const PixelCard = ({
  pixel,
  selected,
  onSelect,
}: {
  pixel: PixelItem;
  selected: boolean;
  onSelect: () => void;
}) => {
  const active = Boolean(pixel.last_fired_time);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-success/60 bg-success/10 ring-1 ring-success/30"
          : "border-border/50 bg-background/40 hover:border-border hover:bg-background/60",
      )}
    >
      <span
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          active ? "bg-success shadow-[0_0_6px_hsl(var(--success)/0.6)]" : "bg-muted-foreground/40",
        )}
        title={active ? "Пиксель активен" : "Нет недавних событий"}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{pixel.name}</span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
          {pixel.id}
        </span>
      </span>
    </button>
  );
};

const PixelEventsPicker = ({
  pixelId,
  events,
  isLoading,
  pixelEvent,
  setPixelEvent,
  onRefresh,
}: {
  pixelId: string;
  events: PixelEventItem[];
  isLoading: boolean;
  pixelEvent: string;
  setPixelEvent: (v: string) => void;
  onRefresh: () => void;
}) => {
  const [hiddenNames, setHiddenNames] = useState<string[]>(() =>
    readHiddenPixelEvents(pixelId),
  );
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);

  useEffect(() => {
    setHiddenNames(readHiddenPixelEvents(pixelId));
    setShowHiddenPanel(false);
  }, [pixelId]);

  const hiddenSet = useMemo(() => new Set(hiddenNames), [hiddenNames]);

  const visibleEvents = useMemo(
    () => events.filter((e) => !hiddenSet.has(e.name)),
    [events, hiddenSet],
  );

  const hiddenEvents = useMemo(
    () => events.filter((e) => hiddenSet.has(e.name)),
    [events, hiddenSet],
  );

  // Если выбранное событие скрыли — переключаем на первое видимое или Lead.
  useEffect(() => {
    if (visibleEvents.length === 0) return;
    const ok = visibleEvents.some((e) => e.name === pixelEvent);
    if (!ok) {
      const lead = visibleEvents.find((e) => e.name.toLowerCase() === "lead");
      setPixelEvent(lead?.name ?? visibleEvents[0].name);
    }
  }, [visibleEvents, pixelEvent, setPixelEvent]);

  const persistHidden = (next: string[]) => {
    setHiddenNames(next);
    writeHiddenPixelEvents(pixelId, next);
  };

  const hideEvent = (name: string) => {
    if (visibleEvents.length <= 1) return;
    persistHidden([...hiddenNames, name]);
  };

  const restoreEvent = (name: string) => {
    persistHidden(hiddenNames.filter((n) => n !== name));
  };

  const restoreAll = () => {
    persistHidden([]);
    setShowHiddenPanel(false);
  };

  const keepOnlyLead = () => {
    const allNames = events.map((e) => e.name);
    const leadEvent = events.find((e) => e.name.toLowerCase() === "lead");
    const keep = leadEvent
      ? [leadEvent.name]
      : [pixelEvent || allNames[0]].filter(Boolean) as string[];
    const next = hideAllExcept(pixelId, allNames, keep);
    setHiddenNames(next);
    if (keep[0]) setPixelEvent(keep[0]);
  };

  return (
    <FieldShell
      label="Событие конверсии"
      isLoading={isLoading}
      error={null}
      onRefresh={onRefresh}
      icon={Target}
    >
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-lg px-2.5 text-[11px]"
            onClick={keepOnlyLead}
            disabled={isLoading || events.length === 0}
          >
            Только Lead
          </Button>
          {hiddenEvents.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 rounded-lg px-2 text-[11px] text-muted-foreground"
              onClick={() => setShowHiddenPanel((v) => !v)}
            >
              Скрытые · {hiddenEvents.length}
              {showHiddenPanel ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>

        {isLoading && visibleEvents.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">
            Загрузка событий…
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">
            Все события скрыты.{" "}
            <button type="button" className="text-primary underline" onClick={restoreAll}>
              Показать все
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visibleEvents.map((e) => {
              const active = pixelEvent === e.name;
              const canHide = visibleEvents.length > 1;
              return (
                <div key={e.name} className="group relative">
                  <button
                    type="button"
                    onClick={() => setPixelEvent(e.name)}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-xl border pl-3 pr-2 text-xs font-medium transition-colors",
                      active
                        ? "border-success/60 bg-success/15 text-success"
                        : "border-border/50 bg-background/50 text-foreground hover:border-border",
                      canHide && "pr-7",
                    )}
                  >
                    <span>{e.name}</span>
                    {e.count > 0 && (
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] tabular-nums",
                          active ? "bg-success/20" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {e.count.toLocaleString("ru-RU")}
                      </span>
                    )}
                  </button>
                  {canHide && (
                    <button
                      type="button"
                      aria-label={`Скрыть ${e.name}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        hideEvent(e.name);
                      }}
                      className={cn(
                        "absolute right-1 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background/80 hover:text-foreground group-hover:opacity-100",
                        active && "opacity-70",
                      )}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {showHiddenPanel && hiddenEvents.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-background/30 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Скрытые события
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={restoreAll}
              >
                <RotateCcw className="h-3 w-3" />
                Вернуть все
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {hiddenEvents.map((e) => (
                <button
                  key={e.name}
                  type="button"
                  onClick={() => restoreEvent(e.name)}
                  className="inline-flex h-7 items-center rounded-lg border border-dashed border-border/60 bg-background/40 px-2 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  + {e.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Нажмите ✕ на событии, чтобы убрать из списка. Настройка сохраняется для этого пикселя.
        </p>
      </div>
    </FieldShell>
  );
};

const GoalAssetsPicker = ({
  goal,
  cabinet,
  whatsappId,
  setWhatsappId,
  pixelId,
  setPixelId,
  pixelEvent,
  setPixelEvent,
  leadFormId,
  setLeadFormId,
}: Props) => {
  const actId = cabinet?.adAccountId || cabinet?.externalId;
  const pageId = cabinet?.pageId;

  const wa = useMetaPageAssets({
    kind: "whatsapp",
    pageId,
    actId,
    enabled: goal === "whatsapp" && (!!pageId || !!actId),
  });

  const pixels = useMetaPageAssets({
    kind: "pixels",
    actId,
    enabled: goal === "site-leads" && !!actId,
  });
  const events = useMetaPageAssets({
    kind: "pixel_events",
    actId,
    pixelId,
    enabled: goal === "site-leads" && !!pixelId && !!actId,
  });

  const forms = useMetaPageAssets({
    kind: "lead_forms",
    actId,
    pageId,
    enabled: goal === "meta-form" && !!pageId && !!actId,
  });

  if (!cabinet) return null;

  if (goal === "whatsapp") {
    if (!pageId) {
      return (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
          Заполните Page ID в настройках кабинета — без него нельзя получить
          WhatsApp-номера.
        </div>
      );
    }
    return (
      <FieldShell
        label="WhatsApp номер"
        isLoading={wa.isLoading}
        error={wa.error}
        onRefresh={wa.refetch}
      >
        <Select value={whatsappId} onValueChange={setWhatsappId}>
          <SelectTrigger className="h-12 rounded-xl bg-background/60">
            <SelectValue
              placeholder={
                wa.isLoading
                  ? "Загрузка..."
                  : wa.data.length === 0
                    ? "Нет привязанных номеров"
                    : "Выберите номер"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {wa.data.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.display_phone_number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>
    );
  }

  if (goal === "site-leads") {
    if (!actId) {
      return (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
          Заполните Ad Account ID в настройках кабинета.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <FieldShell
          label="Meta Pixel"
          isLoading={pixels.isLoading}
          error={pixels.error}
          onRefresh={pixels.refetch}
          icon={Crosshair}
        >
          {pixels.isLoading && pixels.data.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">
              Загрузка пикселей…
            </div>
          ) : pixels.data.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">
              У кабинета нет пикселей в Meta
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {pixels.data.map((p) => (
                <PixelCard
                  key={p.id}
                  pixel={p}
                  selected={pixelId === p.id}
                  onSelect={() => setPixelId(p.id)}
                />
              ))}
            </div>
          )}
        </FieldShell>

        {pixelId && (
          <PixelEventsPicker
            pixelId={pixelId}
            events={events.data}
            isLoading={events.isLoading}
            pixelEvent={pixelEvent}
            setPixelEvent={setPixelEvent}
            onRefresh={events.refetch}
          />
        )}
      </div>
    );
  }

  if (!pageId) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
        Выберите Facebook-страницу выше — без неё нельзя загрузить лид-формы.
      </div>
    );
  }
  if (!actId) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
        Заполните Ad Account ID в настройках кабинета.
      </div>
    );
  }
  return (
    <FieldShell
      label="Лид-форма"
      isLoading={forms.isLoading}
      error={forms.error}
      onRefresh={forms.refetch}
    >
      <Select value={leadFormId} onValueChange={setLeadFormId}>
        <SelectTrigger className="h-12 rounded-xl bg-background/60">
          <SelectValue
            placeholder={
              forms.isLoading
                ? "Загрузка..."
                : forms.data.length === 0
                  ? "У страницы нет лид-форм"
                  : "Выберите форму"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {forms.data.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
              {f.status === "ACTIVE" ? "" : ` (${f.status})`}
              {f.leads_count > 0 ? ` · ${f.leads_count}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
};

export default GoalAssetsPicker;
