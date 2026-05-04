import { RefreshCw, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useMetaPageAssets } from "@/hooks/useMetaPageAssets";
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

const FieldShell = ({
  label,
  isLoading,
  error,
  onRefresh,
  children,
}: {
  label: string;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  children: React.ReactNode;
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
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
  const actId = cabinet?.adAccountId;
  const pageId = cabinet?.pageId;

  // ===== WhatsApp =====
  const wa = useMetaPageAssets({
    kind: "whatsapp",
    pageId,
    actId,
    enabled: goal === "whatsapp" && (!!pageId || !!actId),
  });

  // ===== Pixels =====
  const pixels = useMetaPageAssets({
    kind: "pixels",
    actId,
    enabled: goal === "site-leads" && !!actId,
  });
  const events = useMetaPageAssets({
    kind: "pixel_events",
    pixelId,
    enabled: goal === "site-leads" && !!pixelId,
  });

  // ===== Lead Forms =====
  const forms = useMetaPageAssets({
    kind: "lead_forms",
    pageId,
    enabled: goal === "meta-form" && !!pageId,
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
      <div className="space-y-3">
        <FieldShell
          label="Pixel"
          isLoading={pixels.isLoading}
          error={pixels.error}
          onRefresh={pixels.refetch}
        >
          <Select value={pixelId} onValueChange={setPixelId}>
            <SelectTrigger className="h-12 rounded-xl bg-background/60">
              <SelectValue
                placeholder={
                  pixels.isLoading
                    ? "Загрузка..."
                    : pixels.data.length === 0
                      ? "У кабинета нет пикселей"
                      : "Выберите пиксель"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {pixels.data.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.last_fired_time ? " 🟢" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>

        {pixelId && (
          <FieldShell
            label="Событие пикселя"
            isLoading={events.isLoading}
            error={events.error}
            onRefresh={events.refetch}
          >
            <Select value={pixelEvent} onValueChange={setPixelEvent}>
              <SelectTrigger className="h-12 rounded-xl bg-background/60">
                <SelectValue
                  placeholder={
                    events.isLoading ? "Загрузка..." : "Выберите событие"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {events.data.map((e) => (
                  <SelectItem key={e.name} value={e.name}>
                    {e.name}
                    {e.count > 0 ? ` · ${e.count}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
        )}
      </div>
    );
  }

  // meta-form
  if (!pageId) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
        Заполните Page ID в настройках кабинета.
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
