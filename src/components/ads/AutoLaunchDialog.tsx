/**
 * Настройка авто-запуска рекламы на кабинете.
 *
 * Планировщик (ad-launch-scheduler) раз в 5 минут проверяет кабинеты с
 * включённым авто-запуском и ставит задание в очередь, когда локальный час
 * кабинета совпал с launch_hour, а день недели разрешён. До этого диалога
 * поля лежали в базе, но задать их было негде.
 *
 * Кампания всегда создаётся на паузе — включение остаётся действием человека.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AdCabinet } from "@/types/ads";
import {
  type AutoLaunchForm,
  cabinetPatchFromForm,
  describeGoal,
  describeSchedule,
  formFromCabinet,
  toggleWeekday,
  TIMEZONES,
  validateAutoLaunch,
  WEEKDAYS,
} from "@/lib/autoLaunchSettings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cabinet: AdCabinet | null;
  onSave: (id: string, patch: Partial<AdCabinet>) => Promise<void> | void;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function AutoLaunchDialog({ open, onOpenChange, cabinet, onSave }: Props) {
  const [form, setForm] = useState<AutoLaunchForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Форму пересобираем на каждое открытие: кабинет мог измениться в другом месте.
  useEffect(() => {
    if (open && cabinet) setForm(formFromCabinet(cabinet));
    if (!open) setForm(null);
  }, [open, cabinet]);

  const errors = useMemo(
    () => (form && cabinet ? validateAutoLaunch(form, cabinet) : []),
    [form, cabinet],
  );

  if (!cabinet || !form) return null;

  const set = <K extends keyof AutoLaunchForm>(key: K, value: AutoLaunchForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const handleSave = async () => {
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    setSaving(true);
    try {
      await onSave(cabinet.id, cabinetPatchFromForm(form));
      toast.success(
        form.enabled
          ? `Авто-запуск включён · ${describeSchedule(form)}`
          : "Настройки сохранены, авто-запуск выключен",
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            Авто-запуск · {cabinet.name}
          </DialogTitle>
          <DialogDescription>
            Планировщик сам поставит кампанию в очередь в выбранный час. Цель определяется
            настройками кабинета — сейчас это <strong>{describeGoal(cabinet)}</strong>.
            Кампания создаётся на паузе, включать её нужно вручную.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Включить авто-запуск</div>
              <div className="truncate text-xs text-muted-foreground">{describeSchedule(form)}</div>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => set("enabled", v)}
              aria-label="Включить авто-запуск"
            />
          </div>

          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Расписание
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="al-hour">Час запуска</Label>
                <Select
                  value={String(form.launchHour)}
                  onValueChange={(v) => set("launchHour", Number(v))}
                >
                  <SelectTrigger id="al-hour"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {String(h).padStart(2, "0")}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="al-tz">Таймзона кабинета</Label>
                <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                  <SelectTrigger id="al-tz"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Дни недели</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => {
                  const active = form.daysOfWeek.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => set("daysOfWeek", toggleWeekday(form.daysOfWeek, d.value))}
                      aria-pressed={active}
                      aria-label={d.full}
                      className={cn(
                        "h-9 w-11 rounded-lg border text-xs font-semibold transition",
                        active
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/30",
                      )}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Аудитория
            </h4>
            <div className="space-y-1.5">
              <Label htmlFor="al-geo">Гео</Label>
              <Input
                id="al-geo"
                value={form.geo}
                onChange={(e) => set("geo", e.target.value)}
                placeholder="Алматы, Астана, KZ"
              />
              <p className="text-[11px] text-muted-foreground">
                Города, регионы или коды стран через запятую. Названия сопоставляются со
                справочником Meta при запуске; что не распозналось — будет видно в статусе.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="al-age-min">Возраст от</Label>
                <Input
                  id="al-age-min" inputMode="numeric" value={form.ageMin}
                  onChange={(e) => set("ageMin", e.target.value)} placeholder="18"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="al-age-max">Возраст до</Label>
                <Input
                  id="al-age-max" inputMode="numeric" value={form.ageMax}
                  onChange={(e) => set("ageMax", e.target.value)} placeholder="65"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="al-gender">Пол</Label>
                <Select
                  value={form.gender}
                  onValueChange={(v) => set("gender", v as AutoLaunchForm["gender"])}
                >
                  <SelectTrigger id="al-gender"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    <SelectItem value="male">Мужчины</SelectItem>
                    <SelectItem value="female">Женщины</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="al-interests">Интересы</Label>
                <Input
                  id="al-interests" value={form.interests}
                  onChange={(e) => set("interests", e.target.value)}
                  placeholder="фитнес, здоровое питание"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="al-exclusions">Исключить интересы</Label>
                <Input
                  id="al-exclusions" value={form.exclusions}
                  onChange={(e) => set("exclusions", e.target.value)}
                  placeholder="спортивное питание"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="al-languages">Языки</Label>
              <Input
                id="al-languages" value={form.languages}
                onChange={(e) => set("languages", e.target.value)}
                placeholder="Русский, Казахский"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Креатив по умолчанию
            </h4>
            <div className="space-y-1.5">
              <Label htmlFor="al-media">Ссылки на креативы</Label>
              <Textarea
                id="al-media" rows={3} value={form.mediaUrls}
                onChange={(e) => set("mediaUrls", e.target.value)}
                placeholder={"https://…/banner-1.jpg\nhttps://…/banner-2.jpg"}
              />
              <p className="text-[11px] text-muted-foreground">
                По одной ссылке в строке. Две и больше — соберётся карусель. Если оставить пусто,
                планировщик возьмёт последний креатив из галереи Контент-завода этого проекта.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al-text">Основной текст</Label>
              <Textarea
                id="al-text" rows={3} value={form.primaryText}
                onChange={(e) => set("primaryText", e.target.value)}
                placeholder="Текст, который увидит человек в ленте"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="al-headline">Заголовок</Label>
                <Input
                  id="al-headline" value={form.headline}
                  onChange={(e) => set("headline", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="al-descr">Описание</Label>
                <Input
                  id="al-descr" value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </div>
            </div>
          </section>

          {errors.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <ul className="space-y-1">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || errors.length > 0}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AutoLaunchDialog;
