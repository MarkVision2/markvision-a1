import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarCheck } from "lucide-react";

const SLOT_MIN = 30;
const DAY_START_HR = 9;
const DAY_END_HR = 20;

interface BusySlot {
  iso: string;
  leadName?: string;
}

interface Props {
  current?: string;
  /** ISO timestamps of other booked visits (any minute), used to mark slots as busy. */
  busy?: BusySlot[];
  onConfirm: (iso: string) => void;
  trigger: React.ReactNode;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function bucketKey(d: Date) {
  // 30-minute bucket key
  const x = new Date(d);
  x.setSeconds(0, 0);
  x.setMinutes(x.getMinutes() < 30 ? 0 : 30);
  return x.toISOString();
}

export function VisitSlotPopover({ current, busy = [], onConfirm, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const initial = current ? new Date(current) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [date, setDate] = useState<Date>(startOfDay(initial));
  const [picked, setPicked] = useState<string | null>(current ?? null);

  const busyMap = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const b of busy) {
      try {
        m.set(bucketKey(new Date(b.iso)), b.leadName);
      } catch {
        // ignore malformed
      }
    }
    return m;
  }, [busy]);

  const slots = useMemo(() => {
    const arr: { iso: string; label: string; busyBy?: string; past: boolean }[] = [];
    const base = new Date(date);
    const now = new Date();
    for (let h = DAY_START_HR; h < DAY_END_HR; h++) {
      for (let m = 0; m < 60; m += SLOT_MIN) {
        const slot = new Date(base);
        slot.setHours(h, m, 0, 0);
        const iso = slot.toISOString();
        const past = slot.getTime() < now.getTime();
        const busyBy = busyMap.get(bucketKey(slot));
        arr.push({
          iso,
          label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
          busyBy,
          past,
        });
      }
    }
    return arr;
  }, [date, busyMap]);

  const submit = () => {
    if (!picked) return;
    onConfirm(picked);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[520px] p-0">
        <div className="flex">
          <div className="border-r border-border/60">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(d) => {
                if (d) {
                  setDate(startOfDay(d));
                  setPicked(null);
                }
              }}
              disabled={(d) => d < startOfDay(new Date())}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col p-3">
            <div className="mb-2 text-sm font-semibold">
              Свободные слоты ·{" "}
              <span className="text-muted-foreground">
                {date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" })}
              </span>
            </div>
            <div className="grid max-h-[260px] grid-cols-3 gap-1.5 overflow-y-auto pr-1">
              {slots.map((s) => {
                const isBusy = !!s.busyBy || s.past;
                const active = picked === s.iso;
                return (
                  <button
                    key={s.iso}
                    type="button"
                    disabled={isBusy}
                    onClick={() => setPicked(s.iso)}
                    title={s.past ? "Прошедшее время" : s.busyBy ? `Занято: ${s.busyBy}` : "Свободно"}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                      isBusy
                        ? "cursor-not-allowed border-border/40 bg-secondary/30 text-muted-foreground line-through"
                        : active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5",
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded border border-border/60 bg-background" /> свободно
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded border border-border/40 bg-secondary/30" /> занято
                </span>
              </div>
              <Button
                onClick={submit}
                disabled={!picked}
                size="sm"
                className="ml-auto bg-gradient-primary text-primary-foreground"
              >
                <CalendarCheck className="h-4 w-4" /> Назначить
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}