/**
 * «Окно публикаций» аккаунта: часовой пояс и часы, в которые планировщик
 * ставит слоты именно этому аккаунту. Пусто — действуют настройки группы
 * (publish_account_window в SQL: аккаунт → группа → умолчания 09:00–21:00 Алматы).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AccountUpdateInput, PublishAccount, PublishGroup } from "@/lib/publishingClient";

const INHERIT = "__inherit";
const CUSTOM = "__custom";

/** Пояса, где живут аккаунты клиентов; остальное — вручную через «Другой». */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Almaty", label: "Алматы (UTC+5)" },
  { value: "Asia/Aqtobe", label: "Актобе (UTC+5)" },
  { value: "Asia/Tashkent", label: "Ташкент (UTC+5)" },
  { value: "Asia/Bishkek", label: "Бишкек (UTC+6)" },
  { value: "Asia/Dubai", label: "Дубай (UTC+4)" },
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "Europe/Istanbul", label: "Стамбул (UTC+3)" },
  { value: "Europe/Berlin", label: "Берлин (UTC+1/+2)" },
  { value: "Europe/London", label: "Лондон (UTC+0/+1)" },
  { value: "America/New_York", label: "Нью-Йорк (UTC−5/−4)" },
  { value: "America/Los_Angeles", label: "Лос-Анджелес (UTC−8/−7)" },
  { value: "UTC", label: "UTC" },
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Проверка окна: обе границы или ни одной, начало ≠ конец. Возвращает текст ошибки. */
export function validateWindow(start: string, end: string): string | null {
  if (!start && !end) return null;
  if (!start || !end) return "Укажите и начало, и конец окна — или очистите оба поля";
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return "Время в формате ЧЧ:ММ";
  if (start === end) return "Начало и конец окна совпадают — окно пустое";
  return null;
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

export function AccountWindowDialog({
  open, account, group, onClose, onSave,
}: {
  open: boolean;
  account: PublishAccount;
  group: PublishGroup | null;
  onClose: () => void;
  onSave: (patch: AccountUpdateInput) => Promise<unknown>;
}) {
  const known = TIMEZONES.some((t) => t.value === account.timezone);
  const [tzChoice, setTzChoice] = useState<string>(INHERIT);
  const [tzCustom, setTzCustom] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTzChoice(account.timezone ? (known ? account.timezone : CUSTOM) : INHERIT);
    setTzCustom(account.timezone && !known ? account.timezone : "");
    setStart(hhmm(account.window_start));
    setEnd(hhmm(account.window_end));
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account.id]);

  const inheritedTz = group?.timezone ?? "Asia/Almaty";
  const inheritedWindow = `${hhmm(group?.window_start) || "09:00"}–${hhmm(group?.window_end) || "21:00"}`;
  const overnight = Boolean(start && end && start > end);

  const submit = async () => {
    const tz = tzChoice === INHERIT ? null : tzChoice === CUSTOM ? tzCustom.trim() : tzChoice;
    if (tzChoice === CUSTOM && !tz) { setErr("Введите пояс в формате Region/City, например Asia/Almaty"); return; }
    const wErr = validateWindow(start, end);
    if (wErr) { setErr(wErr); return; }
    setErr(null);
    setSaving(true);
    try {
      await onSave({ timezone: tz, window_start: start || null, window_end: end || null });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Окно публикаций · {account.account_name}</DialogTitle>
          <DialogDescription>
            Часы, в которые планировщик ставит слоты этому аккаунту. Пусто — как у группы:
            {" "}{inheritedWindow}, {inheritedTz}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Часовой пояс</Label>
            <Select value={tzChoice} onValueChange={setTzChoice}>
              <SelectTrigger aria-label="Часовой пояс"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>Как у группы ({inheritedTz})</SelectItem>
                {TIMEZONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                <SelectItem value={CUSTOM}>Другой…</SelectItem>
              </SelectContent>
            </Select>
            {tzChoice === CUSTOM && (
              <Input value={tzCustom} placeholder="Region/City, например Asia/Yerevan" aria-label="Свой часовой пояс" onChange={(e) => setTzCustom(e.target.value)} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-window-start">Начало окна</Label>
              <Input id="acc-window-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-window-end">Конец окна</Label>
              <Input id="acc-window-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          {overnight && <p className="text-xs text-muted-foreground">Окно через полночь: с {start} до {end} следующего дня.</p>}
          {(start || end) && (
            <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => { setStart(""); setEnd(""); }}>
              Сбросить окно — публиковать как группа
            </Button>
          )}
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={saving}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
