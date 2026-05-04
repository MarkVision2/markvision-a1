import { useState } from "react";
import { Bot, Plus, Send, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useReportSubscriptions, type ReportSchedule, type ReportPeriod,
} from "@/hooks/useReportSubscriptions";

const SCHEDULE_LABELS: Record<ReportSchedule, string> = {
  daily: "Каждый день",
  weekdays: "По будням",
  weekly_mon: "Каждый понедельник",
  monthly: "1-го числа",
};
const PERIOD_LABELS: Record<ReportPeriod, string> = {
  yesterday: "За вчера",
  last_7d: "За 7 дней",
  last_30d: "За 30 дней",
};

export function AutoSendDialog() {
  const { items, create, update, remove } = useReportSubscriptions();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("Ежедневный отчёт");
  const [chatId, setChatId] = useState("");
  const [schedule, setSchedule] = useState<ReportSchedule>("daily");
  const [hour, setHour] = useState(9);
  const [period, setPeriod] = useState<ReportPeriod>("last_7d");
  const [testing, setTesting] = useState<string | null>(null);

  async function onCreate() {
    if (!chatId.trim()) {
      toast.error("Введите Chat ID");
      return;
    }
    try {
      await create({
        name, chat_id: chatId.trim(), schedule,
        send_hour: hour, cabinet_ids: [], period, enabled: true,
      });
      toast.success("Подписка создана");
      setAdding(false);
      setName("Ежедневный отчёт");
      setChatId("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function onTest(id: string) {
    setTesting(id);
    try {
      const { data, error } = await supabase.functions.invoke("report-send", {
        body: { subscription_id: id, test: true },
      });
      if (error) throw error;
      const ok = (data as { ok?: boolean })?.ok;
      if (ok) toast.success("Тестовое сообщение отправлено");
      else toast.error((data as { error?: string })?.error ?? "Не удалось отправить");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Бот не подключён");
    } finally {
      setTesting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-12 gap-2 rounded-2xl border-border/60 bg-card/40">
          <Send className="h-4 w-4" /> Авто-отправка
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" /> Telegram авто-отправка
          </DialogTitle>
          <DialogDescription>
            Отчёты будут приходить в указанный чат по расписанию. Бот подключается на стороне сервера.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-xl border border-border/40 bg-secondary/10 p-3 text-xs text-muted-foreground">
          <div className="font-semibold text-foreground/80">Как получить Chat ID:</div>
          <div>1. Создайте бота через <span className="font-mono">@BotFather</span> и подключите его в настройках проекта.</div>
          <div>2. Напишите боту <span className="font-mono">/start</span>.</div>
          <div>3. Узнайте ваш Chat ID через <span className="font-mono">@userinfobot</span> и вставьте сюда.</div>
        </div>

        <div className="space-y-2">
          {items.length === 0 && !adding && (
            <div className="rounded-xl border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
              Подписок пока нет
            </div>
          )}
          {items.map((s) => (
            <div key={s.id} className="rounded-xl border border-border/40 bg-card/40 p-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-semibold">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {SCHEDULE_LABELS[s.schedule]} · {String(s.send_hour).padStart(2, "0")}:00 · {PERIOD_LABELS[s.period]}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">chat: {s.chat_id}</div>
                </div>
                <Switch
                  checked={s.enabled}
                  onCheckedChange={(v) => update(s.id, { enabled: v })}
                />
                <Button size="sm" variant="ghost" onClick={() => onTest(s.id)} disabled={testing === s.id}>
                  {testing === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Тест"}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(s.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-4">
            <div>
              <Label className="text-xs">Название</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Telegram Chat ID</Label>
              <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789 или -100..." />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Расписание</Label>
                <Select value={schedule} onValueChange={(v) => setSchedule(v as ReportSchedule)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCHEDULE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Время</Label>
                <Select value={String(hour)} onValueChange={(v) => setHour(parseInt(v, 10))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {Array.from({ length: 24 }).map((_, h) => (
                      <SelectItem key={h} value={String(h)}>
                        {String(h).padStart(2, "0")}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Период</Label>
                <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERIOD_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>Отмена</Button>
              <Button onClick={onCreate}>Создать</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)} className="w-full gap-2">
            <Plus className="h-4 w-4" /> Добавить подписку
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}