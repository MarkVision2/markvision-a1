import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bell, MessageSquare, RotateCcw, Play, ShieldAlert } from "lucide-react";
import { TelephonySettings } from "./TelephonySettings";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusBadge } from "@/components/settings/SaveStatusBadge";

type Settings = {
  followup_2h_enabled: boolean;
  followup_2h_minutes: number;
  auto_msg_24h_enabled: boolean;
  auto_msg_24h_hours: number;
  auto_msg_24h_template_key: string;
  revival_7d_enabled: boolean;
  revival_7d_days: number;
  revival_7d_template_key: string;
  cron_secret?: string | null;
};

type Run = {
  id: string;
  lead_id: string;
  rule: string;
  fired_at: string;
  payload: Record<string, unknown> | null;
};

const RULE_LABEL: Record<string, string> = {
  followup_2h: "Дожим 2ч",
  auto_msg_24h: "Авто-сообщение 24ч",
  revival_7d: "Возврат 7 дней",
};

export function AutomationsSettings() {
  const { isAdmin } = useAuth();
  const [s, setS] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const { data } = await (supabase.from("automation_settings" as any) as any)
      .select(
        "followup_2h_enabled, followup_2h_minutes, auto_msg_24h_enabled, auto_msg_24h_hours, auto_msg_24h_template_key, revival_7d_enabled, revival_7d_days, revival_7d_template_key",
      )
      .eq("id", true)
      .single();
    if (data) {
      const next = data as unknown as Settings;
      setS(next);
      markSaved(next);
    }
    const { data: r } = await (supabase.from("automation_runs" as any) as any).select("*").order("fired_at", { ascending: false }).limit(50);
    if (r) setRuns(r as unknown as Run[]);
  };

  useEffect(() => { load(); }, []);
  useRealtimeTable("automation_settings", () => void load());
  useRealtimeTable("automation_runs", () => void load());

  const update = (patch: Partial<Settings>) => setS((prev) => prev ? { ...prev, ...patch } : prev);

  const { status, error, markSaved } = useAutoSave<Settings | null>({
    value: s,
    enabled: !!s && isAdmin,
    delay: 800,
    onSave: async (v) => {
      if (!v) return;
      const { error: err } = await (supabase.from("automation_settings" as any) as any).update({
        followup_2h_enabled: v.followup_2h_enabled,
        followup_2h_minutes: v.followup_2h_minutes,
        auto_msg_24h_enabled: v.auto_msg_24h_enabled,
        auto_msg_24h_hours: v.auto_msg_24h_hours,
        auto_msg_24h_template_key: v.auto_msg_24h_template_key,
        revival_7d_enabled: v.revival_7d_enabled,
        revival_7d_days: v.revival_7d_days,
        revival_7d_template_key: v.revival_7d_template_key,
      }).eq("id", true);
      if (err) throw err;
    },
  });

  useEffect(() => { if (error) toast.error(error); }, [error]);

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("crm-automations", { body: {} });
      if (error) throw error;
      const j = data as { followup_2h?: number; auto_msg_24h?: number; revival_7d?: number };
      toast.success(`Запущено: 2ч=${j.followup_2h ?? 0}, 24ч=${j.auto_msg_24h ?? 0}, 7д=${j.revival_7d ?? 0}`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <TelephonySettings />
        <Card className="p-8 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Полный доступ к автоматизациям только у администратора. Свой внутренний номер можно настроить выше.</p>
        </Card>
      </div>
    );
  }

  if (!s) return <Card className="p-8 text-center text-sm text-muted-foreground">Загрузка…</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Автоматизации дожима</h2>
          <p className="text-xs text-muted-foreground">Фоновые правила, запускаются каждые 10 минут</p>
        </div>
        <div className="flex items-center gap-2">
          <SaveStatusBadge status={status} error={error} />
          <Button variant="outline" onClick={runNow} disabled={running}>
            <Play className="h-4 w-4" /> Запустить сейчас
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <RuleCard
          icon={<Bell className="h-4 w-4 text-warning" />}
          title="Дожим через 2 часа"
          description="Создаёт задачу «Дожать клиента», если после исходящего нет ответа."
          enabled={s.followup_2h_enabled}
          onToggle={(v) => update({ followup_2h_enabled: v })}
        >
          <Field label="Окно (минуты)">
            <Input type="number" min={15} max={1440} value={s.followup_2h_minutes}
              onChange={(e) => update({ followup_2h_minutes: Number(e.target.value) || 120 })} />
          </Field>
        </RuleCard>

        <RuleCard
          icon={<MessageSquare className="h-4 w-4 text-primary" />}
          title="Авто-сообщение 24 часа"
          description="Отправляет шаблон в WhatsApp, если клиент не ответил сутки."
          enabled={s.auto_msg_24h_enabled}
          onToggle={(v) => update({ auto_msg_24h_enabled: v })}
        >
          <Field label="Окно (часы)">
            <Input type="number" min={1} max={168} value={s.auto_msg_24h_hours}
              onChange={(e) => update({ auto_msg_24h_hours: Number(e.target.value) || 24 })} />
          </Field>
          <Field label="Ключ шаблона">
            <Input value={s.auto_msg_24h_template_key}
              onChange={(e) => update({ auto_msg_24h_template_key: e.target.value })} />
          </Field>
        </RuleCard>

        <RuleCard
          icon={<RotateCcw className="h-4 w-4 text-success" />}
          title="Возврат через 7 дней"
          description="Возвращает потерянных лидов задачей и автосообщением."
          enabled={s.revival_7d_enabled}
          onToggle={(v) => update({ revival_7d_enabled: v })}
        >
          <Field label="Окно (дни)">
            <Input type="number" min={1} max={90} value={s.revival_7d_days}
              onChange={(e) => update({ revival_7d_days: Number(e.target.value) || 7 })} />
          </Field>
          <Field label="Ключ шаблона">
            <Input value={s.revival_7d_template_key}
              onChange={(e) => update({ revival_7d_template_key: e.target.value })} />
          </Field>
        </RuleCard>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Последние срабатывания</h3>
          <span className="text-xs text-muted-foreground">{runs.length}</span>
        </div>
        {runs.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Пока пусто. Правила сработают при появлении подходящих лидов.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{RULE_LABEL[r.rule] ?? r.rule}</Badge>
                  <span className="text-muted-foreground">lead {r.lead_id.slice(0, 8)}…</span>
                </div>
                <span className="text-muted-foreground">{new Date(r.fired_at).toLocaleString("ru-RU")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TelephonySettings />
    </div>
  );
}

function RuleCard({ icon, title, description, enabled, onToggle, children }: {
  icon: React.ReactNode; title: string; description: string;
  enabled: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="rounded-lg bg-secondary/60 p-2">{icon}</div>
          <div>
            <h4 className="text-sm font-semibold">{title}</h4>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
      <div className={enabled ? "space-y-2" : "space-y-2 opacity-50 pointer-events-none"}>{children}</div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}