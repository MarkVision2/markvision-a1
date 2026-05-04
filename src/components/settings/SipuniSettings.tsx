import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { invalidateTelephonyCache } from "@/lib/telephony";
import { toast } from "sonner";
import { Server, ShieldCheck, KeyRound, Lock, AlertTriangle, Phone, Headphones } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusBadge } from "./SaveStatusBadge";

type Provider = "tel" | "sip" | "sipuni";

type Row = {
  telephony_provider: Provider;
  sipuni_enabled: boolean;
  sipuni_user: string | null;
  sipuni_operator: string | null;
  sipuni_token_present: boolean;
};

const PROVIDERS: { id: Provider; title: string; desc: string; icon: typeof Phone }[] = [
  { id: "tel", title: "Системный", desc: "tel: — мобильный/системный dialer", icon: Phone },
  { id: "sip", title: "SIP-софтфон", desc: "sip: — Zoiper, MicroSIP", icon: Headphones },
  { id: "sipuni", title: "Sipuni АТС", desc: "Click-to-call через бэкенд", icon: Server },
];

export function SipuniSettings() {
  const { isAdmin } = useAuth();
  const [row, setRow] = useState<Row | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    const { data, error } = await (supabase.from("automation_settings" as any) as any)
      .select("telephony_provider, sipuni_enabled, sipuni_user, sipuni_operator, sipuni_token_present")
      .eq("id", true).single();
    if (error) { toast.error(error.message); return; }
    const r = data as Row;
    setRow(r);
    markSaved(r);
  };

  useEffect(() => { load(); }, []);
  useRealtimeTable("automation_settings", () => void load());

  const update = (patch: Partial<Row>) => setRow((p) => p ? { ...p, ...patch } : p);

  const { status, error: saveError, markSaved } = useAutoSave<Row | null>({
    value: row,
    enabled: !!row && isAdmin,
    delay: 700,
    onSave: async (v) => {
      if (!v) return;
      const { error } = await (supabase.from("automation_settings" as any) as any)
        .update({
          telephony_provider: v.telephony_provider,
          sipuni_enabled: v.sipuni_enabled,
          sipuni_user: v.sipuni_user,
          sipuni_operator: v.sipuni_operator,
        })
        .eq("id", true);
      if (error) throw error;
      invalidateTelephonyCache();
    },
  });

  useEffect(() => { if (saveError) toast.error(saveError); }, [saveError]);

  const saveToken = async () => {
    if (!isAdmin || !tokenInput.trim()) return;
    setSavingToken(true);
    const { error } = await (supabase.from("automation_settings" as any) as any)
      .update({ sipuni_token: tokenInput.trim() }).eq("id", true);
    setSavingToken(false);
    if (error) toast.error("Не сохранено: " + error.message);
    else {
      toast.success("Токен Sipuni сохранён");
      setTokenInput("");
      invalidateTelephonyCache();
      void load();
    }
  };

  const testConnection = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("sipuni-call", {
      body: { mode: "test", phone: "00000000" },
    });
    if (error) toast.error("Ошибка: " + error.message);
    else if (!data?.ok) toast.error("Sipuni: " + (data?.error ?? "не настроен"));
    else toast.success(`Sipuni готов · user=${data.user} · оператор=${data.operator}`);
    setTesting(false);
  };

  if (!row) return null;

  if (!isAdmin) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Настройки Sipuni доступны только администратору.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <Server className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Sipuni — телефония</h2>
            <p className="text-xs text-muted-foreground">
              Click-to-call через бэкенд. Ключ хранится в защищённой колонке и читается только сервером.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveStatusBadge status={status} error={saveError} />
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-1.5">
          <span className="text-xs font-medium">Интеграция</span>
          <Switch
            checked={row.sipuni_enabled}
            onCheckedChange={(v) => update({ sipuni_enabled: v })}
          />
          <Badge variant="outline" className={cn(
            row.sipuni_enabled ? "border-success/40 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground",
          )}>
            {row.sipuni_enabled ? "Включено" : "Выключено"}
          </Badge>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          Безопасность
        </div>
        <ul className="space-y-1 text-[11px] text-muted-foreground">
          <li>• Токен Sipuni не выгружается в браузер — только запись.</li>
          <li>• Все вызовы к sipuni.com идут из Edge Function (нет CORS, нет `VITE_*`).</li>
          <li>• Подпись SHA-1 считается на сервере с привязкой к JWT менеджера.</li>
        </ul>
      </div>

      <div>
        <Label className="mb-2 block text-[11px] uppercase tracking-wide text-muted-foreground">
          Активный провайдер для кнопки «Позвонить»
        </Label>
        <div className="grid gap-2 md:grid-cols-3">
          {PROVIDERS.map((p) => {
            const active = row.telephony_provider === p.id;
            const Icon = p.icon;
            const disabled = p.id === "sipuni" && !row.sipuni_enabled;
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                onClick={() => update({ telephony_provider: p.id })}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                  active ? "border-primary/60 bg-primary/10" : "border-border/60 bg-card/40 hover:bg-secondary/40",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-sm font-semibold">{p.title}</span>
                </div>
                <span className="text-[11px] leading-snug text-muted-foreground">{p.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Sipuni User (ID кабинета)">
          <Input
            value={row.sipuni_user ?? ""}
            onChange={(e) => update({ sipuni_user: e.target.value })}
            placeholder="например, 002344"
          />
        </Field>
        <Field label={(
          <span className="flex items-center gap-1.5">
            <KeyRound className="h-3 w-3" /> API Token
            {row.sipuni_token_present
              ? <Badge variant="outline" className="border-success/40 bg-success/10 text-success">установлен</Badge>
              : <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">не задан</Badge>}
          </span>
        )}>
          <Input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={row.sipuni_token_present ? "•••••• (оставьте пустым, чтобы не менять)" : "вставьте токен"}
          />
        </Field>
        <Field label="Дефолтный оператор (внутр. номер)">
          <Input
            value={row.sipuni_operator ?? ""}
            onChange={(e) => update({ sipuni_operator: e.target.value })}
            placeholder="например, 100"
          />
        </Field>
      </div>

      {row.sipuni_enabled && !row.sipuni_token_present && !tokenInput && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Включена интеграция, но API-токен не задан. Сохраните токен, иначе звонки будут падать.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
        {tokenInput.trim() && (
          <Button onClick={saveToken} disabled={savingToken} variant="secondary">
            {savingToken ? "Сохраняю токен…" : "Сохранить токен"}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={testConnection}
          disabled={testing || !row.sipuni_enabled || !row.sipuni_user || (!row.sipuni_token_present && !tokenInput)}
        >
          {testing ? "Проверяю…" : "Проверить подключение"}
        </Button>
        <span className="text-[11px] text-muted-foreground">Остальные поля сохраняются автоматически</span>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}