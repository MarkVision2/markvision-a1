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
import {
  Server, ShieldCheck, KeyRound, Lock, AlertTriangle, Phone, Headphones,
  ChevronDown, ChevronUp, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusBadge } from "./SaveStatusBadge";

type Provider = "tel" | "sip" | "sipuni" | "binotel";

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

/** Тело не-2xx ответа supabase-js прячет в error.context — достаём причину оттуда. */
async function edgeErrorText(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      const text = (body?.detail as string) || (body?.error as string);
      if (text) return text;
    } catch { /* тело не JSON */ }
  }
  const msg = (error as { message?: string } | null)?.message ?? "";
  if (/failed to send a request/i.test(msg)) {
    return "Функция не ответила. Проверьте, что sipuni-call задеплоена, и посмотрите её логи в Supabase.";
  }
  return msg || fallback;
}

export function SipuniSettings() {
  const { isAdmin } = useAuth();
  const [row, setRow] = useState<Row | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [testing, setTesting] = useState(false);

  const connected = Boolean(row?.sipuni_enabled && row?.sipuni_token_present);
  const isActive = row?.telephony_provider === "sipuni";

  const load = async () => {
    const { data, error } = await (supabase.from("automation_settings" as any) as any)
      .select("telephony_provider, sipuni_enabled, sipuni_user, sipuni_operator, sipuni_token_present")
      .eq("id", true).single();
    if (error) { toast.error(error.message); return; }
    const r = data as Row;
    setRow(r);
    markSaved(r);
    // Настроенное подключение показываем свёрнутым — форма не должна висеть,
    // когда её уже заполнили.
    setExpanded(!(r.sipuni_enabled && r.sipuni_token_present));
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
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
    const { error } = await supabase.rpc("save_sipuni_token" as never, { p_token: tokenInput.trim() } as never);
    setSavingToken(false);
    if (error) { toast.error("Не сохранено: " + error.message); return; }
    toast.success("Токен Sipuni сохранён");
    setTokenInput("");
    invalidateTelephonyCache();
    void load();
  };

  const testConnection = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("sipuni-call", {
      body: { mode: "test", phone: "00000000" },
    });
    setTesting(false);
    if (error) { toast.error(await edgeErrorText(error, "не удалось вызвать функцию")); return; }
    if (!data?.ok) { toast.error("Sipuni: " + (data?.detail ?? data?.error ?? "не настроен")); return; }
    // Честная формулировка: проверка смотрит конфигурацию, а не связь с АТС —
    // у Sipuni нет дешёвого read-only метода, как list-of-employees у Binotel.
    toast.success(`Настройки на месте · user=${data.user} · оператор=${data.operator}`);
  };

  if (!row) return null;

  if (!isAdmin) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Настройки Sipuni доступны только администратору.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
            connected ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}>
            <Server className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Sipuni — телефония</h2>
              {connected ? (
                <Badge variant="outline" className="gap-1 border-success/40 bg-success/10 text-success">
                  <CheckCircle2 className="h-3 w-3" /> Подключено
                </Badge>
              ) : (
                <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                  Не подключено
                </Badge>
              )}
              {connected && isActive && (
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                  активный провайдер
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {connected ? (
                <>
                  Кабинет {row.sipuni_user || "не указан"}
                  {row.sipuni_operator ? ` · оператор ${row.sipuni_operator}` : " · оператор не задан"}
                  {" · общий для всех проектов"}
                </>
              ) : (
                <>Click-to-call через бэкенд. Настройка общая для всех проектов.</>
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <SaveStatusBadge status={status} error={saveError} />
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
            {expanded ? "Свернуть" : "Настроить"}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-5 border-t border-border/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              В отличие от Binotel, подключение Sipuni одно на всю систему.
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-1.5">
              <span className="text-xs font-medium">Интеграция</span>
              <Switch
                checked={row.sipuni_enabled}
                onCheckedChange={(v) => update({ sipuni_enabled: v })}
              />
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
              <li>• Запись разговора складывается в наш storage и играет в карточке лида.</li>
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
            <p className="mt-2 text-[11px] text-muted-foreground">
              Проекты с подключённым Binotel звонят через него — этот выбор на них не влияет.
            </p>
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
              title="Проверяет, что кабинет, токен и оператор заполнены"
            >
              {testing ? "Проверяю…" : "Проверить настройки"}
            </Button>
            <span className="text-[11px] text-muted-foreground">Остальные поля сохраняются автоматически</span>
          </div>
        </div>
      )}
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
