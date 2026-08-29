import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { invalidateTelephonyCache } from "@/lib/telephony";
import { supabaseUrl } from "@/lib/supabaseConfig";
import { toast } from "sonner";
import { PhoneForwarded, ShieldCheck, KeyRound, Lock, AlertTriangle, Copy, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusBadge } from "./SaveStatusBadge";

type Row = {
  telephony_provider: string;
  binotel_enabled: boolean;
  binotel_operator: string | null;
  binotel_pbx_number: string | null;
  binotel_crm_base_url: string | null;
  binotel_credentials_present: boolean;
  binotel_auto_create_leads: boolean;
  binotel_project_id: string | null;
};

type Employee = { name: string; email: string; internalNumber: string; status: string };

const SELECT_COLS =
  "telephony_provider, binotel_enabled, binotel_operator, binotel_pbx_number, binotel_crm_base_url, " +
  "binotel_credentials_present, binotel_auto_create_leads, binotel_project_id";

export function BinotelSettings() {
  const { isAdmin } = useAuth();
  const { projects } = useProjectsStore();
  const [row, setRow] = useState<Row | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [employees, setEmployees] = useState<Employee[] | null>(null);

  const load = async () => {
    const { data, error } = await (supabase.from("automation_settings" as any) as any)
      .select(SELECT_COLS).eq("id", true).single();
    if (error) {
      // Фронт мог выкатиться раньше миграции — не сыпем тостами, а честно
      // говорим, чего не хватает.
      if (/column|does not exist|schema cache/i.test(error.message)) {
        setNeedsMigration(true);
        return;
      }
      toast.error(error.message);
      return;
    }
    setNeedsMigration(false);
    const r = data as Row;
    setRow(r);
    markSaved(r);
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
          binotel_enabled: v.binotel_enabled,
          binotel_operator: v.binotel_operator,
          binotel_pbx_number: v.binotel_pbx_number,
          binotel_crm_base_url: v.binotel_crm_base_url,
          binotel_auto_create_leads: v.binotel_auto_create_leads,
          binotel_project_id: v.binotel_project_id,
        })
        .eq("id", true);
      if (error) throw error;
      invalidateTelephonyCache();
    },
  });

  useEffect(() => { if (saveError) toast.error(saveError); }, [saveError]);

  const saveCreds = async () => {
    if (!isAdmin || !keyInput.trim() || !secretInput.trim()) return;
    setSavingCreds(true);
    const { error } = await supabase.rpc("save_binotel_credentials" as never, {
      p_key: keyInput.trim(), p_secret: secretInput.trim(),
    } as never);
    setSavingCreds(false);
    if (error) { toast.error("Не сохранено: " + error.message); return; }
    toast.success("Ключи Binotel сохранены");
    setKeyInput("");
    setSecretInput("");
    invalidateTelephonyCache();
    void load();
  };

  const testConnection = async () => {
    setTesting(true);
    setEmployees(null);
    const { data, error } = await supabase.functions.invoke("binotel-call", { body: { mode: "test" } });
    setTesting(false);
    if (error) { toast.error("Ошибка: " + error.message); return; }
    if (!data?.ok) { toast.error("Binotel: " + (data?.error ?? "не настроен")); return; }
    setEmployees((data.employees ?? []) as Employee[]);
    toast.success(
      data.operatorKnown
        ? `Binotel на связи · внутренний номер ${data.operator} найден в АТС`
        : `Binotel на связи, но номера ${data.operator} нет среди сотрудников АТС`,
    );
  };

  const importCalls = async () => {
    setImporting(true);
    const { data, error } = await supabase.functions.invoke("binotel-import-calls", {
      body: { days: 7 },
    });
    setImporting(false);
    if (error) { toast.error("Ошибка импорта: " + error.message); return; }
    if (!data?.ok) { toast.error("Binotel: " + (data?.error ?? "импорт не выполнен")); return; }
    toast.success(
      `Импорт за ${data.days} дн.: добавлено ${data.imported} из ${data.fetched}` +
      (data.skipped_no_lead ? ` · без лида ${data.skipped_no_lead}` : "") +
      (data.skipped_duplicate ? ` · уже были ${data.skipped_duplicate}` : ""),
    );
  };

  const webhookUrl = `${supabaseUrl}/functions/v1/binotel-webhook?secret=<BINOTEL_WEBHOOK_SECRET>`;

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("URL скопирован — вставьте секрет вместо <BINOTEL_WEBHOOK_SECRET>");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  if (needsMigration) {
    return (
      <Card className="flex items-start gap-3 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Binotel: миграция ещё не применена</p>
          <p className="mt-0.5">
            Выполните <code>supabase/migrations/20260829120000_binotel_telephony.sql</code> и{" "}
            <code>20260829130000_binotel_recordings_and_leads.sql</code> — после этого карточка появится.
          </p>
        </div>
      </Card>
    );
  }

  if (!row) return null;

  if (!isAdmin) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Настройки Binotel доступны только администратору.</p>
      </Card>
    );
  }

  const active = row.telephony_provider === "binotel";

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <PhoneForwarded className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Binotel — телефония (Украина)</h2>
            <p className="text-xs text-muted-foreground">
              Click-to-call, карточка клиента при входящем и запись разговора в карточке лида.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveStatusBadge status={status} error={saveError} />
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-1.5">
            <span className="text-xs font-medium">Интеграция</span>
            <Switch checked={row.binotel_enabled} onCheckedChange={(v) => update({ binotel_enabled: v })} />
            <Badge variant="outline" className={cn(
              row.binotel_enabled
                ? "border-success/40 bg-success/10 text-success"
                : "border-border bg-muted text-muted-foreground",
            )}>
              {row.binotel_enabled ? "Включено" : "Выключено"}
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
          <li>• Key и Secret не выгружаются в браузер — только запись через RPC администратором.</li>
          <li>• Все запросы к api.binotel.com уходят из Edge Function (нет CORS, нет `VITE_*`).</li>
          <li>• Webhook принимает только запросы с секретом в URL либо с IP серверов Binotel.</li>
          <li>• Запись разговора складывается в наш storage — ссылка Binotel живёт 15 минут.</li>
        </ul>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={(
          <span className="flex items-center gap-1.5">
            <KeyRound className="h-3 w-3" /> API Key
            {row.binotel_credentials_present
              ? <Badge variant="outline" className="border-success/40 bg-success/10 text-success">заданы</Badge>
              : <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">не заданы</Badge>}
          </span>
        )}>
          <Input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={row.binotel_credentials_present ? "•••••• (оставьте пустым, чтобы не менять)" : "например, ab12cd-3ef4gh5"}
            autoComplete="off"
          />
        </Field>
        <Field label="API Secret">
          <Input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder={row.binotel_credentials_present ? "••••••" : "вставьте secret"}
            autoComplete="new-password"
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Внутренний номер по умолчанию">
          <Input
            value={row.binotel_operator ?? ""}
            onChange={(e) => update({ binotel_operator: e.target.value })}
            placeholder="например, 901"
          />
        </Field>
        <Field label="Номер АТС для исходящих (pbxNumber)">
          <Input
            value={row.binotel_pbx_number ?? ""}
            onChange={(e) => update({ binotel_pbx_number: e.target.value })}
            placeholder="например, 0443334023"
          />
        </Field>
        <Field label="Адрес CRM для ссылки в звонке">
          <Input
            value={row.binotel_crm_base_url ?? ""}
            onChange={(e) => update({ binotel_crm_base_url: e.target.value })}
            placeholder="https://app.example.com"
          />
        </Field>
      </div>

      <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
        <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
          URL для webhook-ов Binotel (API CALL SETTINGS и API CALL COMPLETED)
        </Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-background/60 px-2 py-1.5 text-[11px]">
            {webhookUrl}
          </code>
          <Button size="icon" variant="ghost" onClick={copyWebhook} aria-label="Скопировать URL">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Один и тот же адрес указывается в обоих webhook-ах кабинета Binotel. Секрет задаётся
          в секретах Supabase как <code>BINOTEL_WEBHOOK_SECRET</code>.
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <UserPlus className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs font-medium">Заводить лида при звонке с неизвестного номера</div>
              <p className="text-[11px] text-muted-foreground">
                Только входящие. Карточка создаётся в первой стадии дефолтной воронки проекта.
              </p>
            </div>
          </div>
          <Switch
            checked={row.binotel_auto_create_leads}
            onCheckedChange={(v) => update({ binotel_auto_create_leads: v })}
          />
        </div>

        {row.binotel_auto_create_leads && (
          <div className="mt-3">
            <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
              Проект для новых лидов
            </Label>
            <Select
              value={row.binotel_project_id ?? ""}
              onValueChange={(v) => update({ binotel_project_id: v || null })}
            >
              <SelectTrigger className="max-w-[320px]">
                <SelectValue placeholder="Выберите проект" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!row.binotel_project_id && (
              <p className="mt-1 text-[11px] text-warning">
                Проект не выбран — лиды создаваться не будут.
              </p>
            )}
          </div>
        )}
      </div>

      {row.binotel_enabled && !row.binotel_credentials_present && !keyInput && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Интеграция включена, но key/secret не заданы — звонки будут падать в системный набор.
        </div>
      )}

      {employees && (
        <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Сотрудники в АТС ({employees.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {employees.map((e) => (
              <Badge key={`${e.email}-${e.internalNumber}`} variant="outline" className="gap-1 text-[11px]">
                <span className="font-medium">{e.internalNumber || "—"}</span>
                <span className="text-muted-foreground">{e.name || e.email}</span>
              </Badge>
            ))}
            {employees.length === 0 && (
              <span className="text-[11px] text-muted-foreground">АТС вернула пустой список.</span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
        {!active && row.binotel_enabled && row.binotel_credentials_present && (
          <Button variant="secondary" onClick={() => update({ telephony_provider: "binotel" })}>
            Сделать провайдером по умолчанию
          </Button>
        )}
        {keyInput.trim() && secretInput.trim() && (
          <Button onClick={saveCreds} disabled={savingCreds} variant="secondary">
            {savingCreds ? "Сохраняю ключи…" : "Сохранить ключи"}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={importCalls}
          disabled={importing || !row.binotel_enabled || !row.binotel_credentials_present}
          title="Подтянуть звонки за последнюю неделю в ленты существующих лидов"
        >
          {importing ? "Импортирую…" : "Импорт истории за 7 дней"}
        </Button>
        <Button
          variant="outline"
          onClick={testConnection}
          disabled={testing || !row.binotel_enabled || !row.binotel_credentials_present}
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
