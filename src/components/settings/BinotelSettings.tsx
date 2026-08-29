import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { invalidateTelephonyCache } from "@/lib/telephony";
import { supabaseUrl } from "@/lib/supabaseConfig";
import { toast } from "sonner";
import {
  PhoneForwarded, ShieldCheck, KeyRound, Lock, AlertTriangle, Copy, UserPlus,
  ChevronDown, ChevronUp, CheckCircle2, Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusBadge } from "./SaveStatusBadge";

/** Подключение проекта — то, что видно клиенту (ключи остаются на сервере). */
type Row = {
  enabled: boolean;
  operator: string | null;
  pbx_number: string | null;
  crm_base_url: string | null;
  auto_create_leads: boolean;
  credentials_present: boolean;
};

type Employee = { name: string; email: string; internalNumber: string; status: string };

const EMPTY: Row = {
  enabled: false,
  operator: null,
  pbx_number: null,
  crm_base_url: null,
  auto_create_leads: false,
  credentials_present: false,
};

const SELECT_COLS =
  "enabled, operator, pbx_number, crm_base_url, auto_create_leads, credentials_present";

/**
 * supabase-js на не-2xx отдаёт лишь «Edge Function returned a non-2xx status code»,
 * а тело ответа прячет в error.context. Достаём оттуда наш detail/error, иначе
 * пользователь видит бессмысленный текст вместо причины.
 */
async function edgeErrorText(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      const text = (body?.detail as string) || (body?.error as string);
      if (text) return text;
    } catch { /* тело не JSON — покажем fallback */ }
  }
  const msg = (error as { message?: string } | null)?.message ?? "";
  if (/failed to send a request/i.test(msg)) {
    return "Функция не ответила. Проверьте, что binotel-call задеплоена, и посмотрите её логи в Supabase.";
  }
  return msg || fallback;
}

export function BinotelSettings() {
  const { isAdmin } = useAuth();
  const { activeId, projects } = useProjectsStore();
  const [row, setRow] = useState<Row | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [employees, setEmployees] = useState<Employee[] | null>(null);

  const projectName = useMemo(
    () => projects.find((p) => p.id === activeId)?.name ?? "",
    [projects, activeId],
  );

  const connected = Boolean(row?.enabled && row?.credentials_present);

  const load = async () => {
    if (!activeId) { setRow(null); return; }
    const { data, error } = await (supabase.from("project_binotel_settings_safe" as any) as any)
      .select(SELECT_COLS).eq("project_id", activeId).maybeSingle();
    if (error) {
      // Фронт мог выкатиться раньше миграции — не сыпем тостами, а честно
      // говорим, чего не хватает.
      if (/column|does not exist|schema cache|relation/i.test(error.message)) {
        setNeedsMigration(true);
        return;
      }
      toast.error(error.message);
      return;
    }
    setNeedsMigration(false);
    const r = (data as Row) ?? EMPTY;
    setRow(r);
    markSaved(r);
    // Настроенное подключение показываем свёрнутым: карточка не должна
    // занимать пол-экрана формой, которую уже заполнили.
    setExpanded(!(r.enabled && r.credentials_present));
  };

  useEffect(() => {
    setEmployees(null);
    void load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeId]);

  const update = (patch: Partial<Row>) => setRow((p) => p ? { ...p, ...patch } : p);

  const { status, error: saveError, markSaved } = useAutoSave<Row | null>({
    value: row,
    enabled: !!row && isAdmin && !!activeId,
    delay: 700,
    onSave: async (v) => {
      if (!v || !activeId) return;
      const { error } = await supabase.rpc("save_binotel_settings" as never, {
        p_project_id: activeId,
        p_enabled: v.enabled,
        p_operator: v.operator ?? "",
        p_pbx_number: v.pbx_number ?? "",
        p_crm_base_url: v.crm_base_url ?? "",
        p_auto_create_leads: v.auto_create_leads,
      } as never);
      if (error) throw error;
      invalidateTelephonyCache();
    },
  });

  useEffect(() => { if (saveError) toast.error(saveError); }, [saveError]);

  const saveCreds = async () => {
    if (!isAdmin || !activeId || !keyInput.trim() || !secretInput.trim()) return;
    setSavingCreds(true);
    const { error } = await supabase.rpc("save_binotel_credentials" as never, {
      p_project_id: activeId, p_key: keyInput.trim(), p_secret: secretInput.trim(),
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
    const { data, error } = await supabase.functions.invoke("binotel-call", {
      body: { mode: "test", projectId: activeId },
    });
    setTesting(false);
    if (error) { toast.error(await edgeErrorText(error, "не удалось вызвать функцию")); return; }
    if (!data?.ok) { toast.error("Binotel: " + (data?.detail ?? data?.error ?? "не настроен")); return; }
    setEmployees((data.employees ?? []) as Employee[]);
    if (!data.operator) {
      toast.success("Binotel на связи. Внутренний номер не задан — возьмите его из списка сотрудников ниже");
    } else if (data.operatorKnown) {
      toast.success(`Binotel на связи · внутренний номер ${data.operator} найден в АТС`);
    } else {
      toast.warning(`Binotel на связи, но номера ${data.operator} нет среди сотрудников АТС`);
    }
  };

  const importCalls = async () => {
    setImporting(true);
    const { data, error } = await supabase.functions.invoke("binotel-import-calls", {
      body: { projectId: activeId, days: 7 },
    });
    setImporting(false);
    if (error) { toast.error(await edgeErrorText(error, "импорт не выполнен")); return; }
    if (!data?.ok) { toast.error("Binotel: " + (data?.detail ?? data?.error ?? "импорт не выполнен")); return; }
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
            Выполните <code>scripts/apply-binotel-telephony.sql</code> — после этого карточка появится.
          </p>
        </div>
      </Card>
    );
  }

  if (!activeId) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <Plug className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Выберите проект — подключение Binotel своё у каждого.</p>
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

  return (
    <Card className="overflow-hidden">
      {/* Шапка — всегда видна: статус подключения этого проекта */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
            connected ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}>
            <PhoneForwarded className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Binotel — телефония</h2>
              {connected ? (
                <Badge variant="outline" className="gap-1 border-success/40 bg-success/10 text-success">
                  <CheckCircle2 className="h-3 w-3" /> Подключено
                </Badge>
              ) : (
                <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                  Не подключено
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {connected ? (
                <>
                  {projectName && <>Проект «{projectName}» · </>}
                  {row.pbx_number ? `АТС ${row.pbx_number}` : "номер АТС не задан"}
                  {row.operator ? ` · внутренний ${row.operator}` : " · внутренний номер не задан"}
                </>
              ) : (
                <>Click-to-call, карточка клиента при входящем и запись разговора в карточке лида</>
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
              Подключение своё у каждого проекта — здесь настраивается
              {projectName ? <> «{projectName}»</> : " активный проект"}.
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-1.5">
              <span className="text-xs font-medium">Интеграция</span>
              <Switch checked={row.enabled} onCheckedChange={(v) => update({ enabled: v })} />
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
                {row.credentials_present
                  ? <Badge variant="outline" className="border-success/40 bg-success/10 text-success">заданы</Badge>
                  : <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">не заданы</Badge>}
              </span>
            )}>
              <Input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={row.credentials_present ? "•••••• (оставьте пустым, чтобы не менять)" : "например, ab12cd-3ef4gh5"}
                autoComplete="off"
              />
            </Field>
            <Field label="API Secret">
              <Input
                type="password"
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder={row.credentials_present ? "••••••" : "вставьте secret"}
                autoComplete="new-password"
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Внутренний номер по умолчанию">
              <Input
                value={row.operator ?? ""}
                onChange={(e) => update({ operator: e.target.value })}
                placeholder="например, 901"
              />
            </Field>
            <Field label="Номер АТС для исходящих (pbxNumber)">
              <Input
                value={row.pbx_number ?? ""}
                onChange={(e) => update({ pbx_number: e.target.value })}
                placeholder="например, 77006068869"
              />
            </Field>
            <Field label="Адрес CRM для ссылки в звонке">
              <Input
                value={row.crm_base_url ?? ""}
                onChange={(e) => update({ crm_base_url: e.target.value })}
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
              В кабинете Binotel webhook-и ставит поддержка — этот адрес отправьте ей.
              Пока их нет, звонки подтягиваются синхронизацией раз в 15 минут.
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <UserPlus className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-xs font-medium">Заводить лида при звонке с неизвестного номера</div>
                  <p className="text-[11px] text-muted-foreground">
                    Только входящие. Карточка создаётся в первой стадии дефолтной воронки
                    {projectName ? <> проекта «{projectName}»</> : " проекта"}.
                  </p>
                </div>
              </div>
              <Switch
                checked={row.auto_create_leads}
                onCheckedChange={(v) => update({ auto_create_leads: v })}
              />
            </div>
          </div>

          {row.enabled && !row.credentials_present && !keyInput && (
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
              <p className="mb-2 text-[11px] text-muted-foreground">
                Число слева — внутренний номер. Впишите нужный в поле «Внутренний номер по умолчанию»
                или в свой профиль.
              </p>
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
            {keyInput.trim() && secretInput.trim() && (
              <Button onClick={saveCreds} disabled={savingCreds} variant="secondary">
                {savingCreds ? "Сохраняю ключи…" : "Сохранить ключи"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={importCalls}
              disabled={importing || !connected}
              title="Подтянуть звонки за последнюю неделю в ленты существующих лидов"
            >
              {importing ? "Импортирую…" : "Импорт истории за 7 дней"}
            </Button>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={testing || !row.enabled || !row.credentials_present}
            >
              {testing ? "Проверяю…" : "Проверить подключение"}
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
