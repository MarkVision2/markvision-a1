import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Radio, Loader2, CheckCircle2, XCircle, Workflow, Activity, ShieldCheck,
} from "lucide-react";

// Meta CAPI события, доступные для маппинга (значение = event_name в Meta,
// совпадает с CHECK в crm_stage_map). В UI показываем по-русски; английское
// имя — техническое, его требует Meta, поэтому даём мелким шрифтом.
const CAPI_EVENTS = ["Lead", "Schedule", "Diagnostic", "Purchase"] as const;
type CapiEvent = (typeof CAPI_EVENTS)[number];

const EVENT_LABEL: Record<CapiEvent, { ru: string; hint: string }> = {
  Lead:       { ru: "Заявка",      hint: "оставил контакт (новый лид)" },
  Schedule:   { ru: "Запись",      hint: "назначен визит / бронь" },
  Diagnostic: { ru: "Диагностика", hint: "пришёл на диагностику / визит" },
  Purchase:   { ru: "Оплата",      hint: "сделка оплачена — уходит сумма" },
};

// Автоопределение события по ключу стадии — тот же принцип, что в онбординг-визарде.
function guessEvent(key: string): CapiEvent | "" {
  const low = key.toLowerCase();
  if (low.includes("paid") || low.includes("оплач") || low.includes("продаж") || low.includes("sale") || low.includes("won")) return "Purchase";
  if (low.includes("visit") || low.includes("диагност") || low.includes("визит")) return "Diagnostic";
  if (low.includes("schedule") || low.includes("invoice") || low.includes("запис") || low.includes("счёт") || low.includes("счет") || low.includes("book")) return "Schedule";
  if (low.includes("new") || low.includes("нов") || low.includes("lead") || low.includes("заяв")) return "Lead";
  return "";
}

function mask(s: string | null | undefined) {
  if (!s) return "";
  if (s.length <= 6) return "•".repeat(s.length);
  return "•".repeat(Math.max(6, s.length - 4)) + s.slice(-4);
}

type Cabinet = {
  id: string;
  name: string;
  pixel_id: string | null;
  access_token: string | null;
  capi_test_event_code: string | null;
};

type StageRow = { id: string; key: string; title: string; event: CapiEvent | "" };

type OutboxRow = {
  id: string;
  event_name: string;
  status: string;
  value: number | null;
  currency: string | null;
  created_at: string;
  last_error: string | null;
};

type CheckState = { status: "idle" | "loading" | "ok" | "fail"; message?: string };

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  sent: { label: "Отправлено", cls: "bg-success/15 text-success border-success/30" },
  pending: { label: "В очереди", cls: "bg-warning/15 text-warning border-warning/30" },
  failed: { label: "Ошибка", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  skipped: { label: "Пропущено", cls: "bg-muted text-muted-foreground border-border" },
};

export function CapiSettings() {
  const { activeId: projectId } = useProjectsStore();

  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [cabinetId, setCabinetId] = useState<string>("");
  const [pixelId, setPixelId] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [savingConn, setSavingConn] = useState(false);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });

  const [stages, setStages] = useState<StageRow[]>([]);
  const [savingMap, setSavingMap] = useState(false);

  const [outbox, setOutbox] = useState<OutboxRow[]>([]);

  const cabinet = useMemo(() => cabinets.find((c) => c.id === cabinetId), [cabinets, cabinetId]);

  // ── Загрузка кабинетов проекта ──
  const loadCabinets = useCallback(async () => {
    if (!projectId) { setCabinets([]); return; }
    const { data } = await (supabase.from("ad_cabinets" as any) as any)
      .select("id, name, pixel_id, access_token, capi_test_event_code")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    const list = (data ?? []) as Cabinet[];
    setCabinets(list);
    setCabinetId((prev) => (prev && list.some((c) => c.id === prev) ? prev : (list[0]?.id ?? "")));
  }, [projectId]);

  useEffect(() => { void loadCabinets(); }, [loadCabinets]);

  // Заполняем поля подключения при смене кабинета.
  useEffect(() => {
    if (!cabinet) { setPixelId(""); setTokenInput(""); setTokenSet(false); setTestCode(""); return; }
    setPixelId(cabinet.pixel_id ?? "");
    setTokenInput("");
    setTokenSet(!!cabinet.access_token);
    setTestCode(cabinet.capi_test_event_code ?? "");
    setCheck({ status: "idle" });
  }, [cabinet]);

  // ── Загрузка стадий воронки проекта + текущего маппинга ──
  const loadStages = useCallback(async () => {
    if (!projectId) { setStages([]); return; }
    const { data: pipeline } = await (supabase.from("pipelines" as any) as any)
      .select("id").eq("project_id", projectId).eq("is_default", true).maybeSingle();
    if (!pipeline?.id) { setStages([]); return; }

    const { data: rows } = await (supabase.from("pipeline_stages" as any) as any)
      .select("id, key, title, order_index").eq("pipeline_id", pipeline.id).order("order_index");

    // Маппинг: проектные строки в приоритете над глобальными.
    const { data: maps } = await (supabase.from("crm_stage_map" as any) as any)
      .select("status_key, capi_event, project_id")
      .or(`project_id.eq.${projectId},project_id.is.null`);

    const byKey = new Map<string, CapiEvent>();
    for (const m of (maps ?? []) as any[]) {
      const k = String(m.status_key).trim().toLowerCase();
      // Проектная строка перезаписывает глобальную.
      if (m.project_id === projectId || !byKey.has(k)) byKey.set(k, m.capi_event);
    }

    setStages((rows ?? []).map((r: any) => {
      const k = String(r.key).trim().toLowerCase();
      const mapped = byKey.get(k);
      return { id: r.id, key: r.key, title: r.title, event: mapped ?? "" };
    }));
  }, [projectId]);

  useEffect(() => { void loadStages(); }, [loadStages]);
  useRealtimeTable("crm_stage_map", () => void loadStages());

  // ── Загрузка ленты событий CAPI ──
  const loadOutbox = useCallback(async () => {
    if (!projectId) { setOutbox([]); return; }
    const { data } = await (supabase.from("capi_outbox" as any) as any)
      .select("id, event_name, status, value, currency, created_at, last_error")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(30);
    setOutbox((data ?? []) as OutboxRow[]);
  }, [projectId]);

  useEffect(() => { void loadOutbox(); }, [loadOutbox]);
  useRealtimeTable("capi_outbox", () => void loadOutbox());

  const outboxStats = useMemo(() => {
    const s = { sent: 0, pending: 0, failed: 0 };
    for (const r of outbox) {
      if (r.status === "sent") s.sent++;
      else if (r.status === "pending") s.pending++;
      else if (r.status === "failed") s.failed++;
    }
    return s;
  }, [outbox]);

  // Готовность: пиксель обязателен. Токен — свой у кабинета ИЛИ общий подключённый Meta
  // (его наличие проверяется на сервере кнопкой «Проверить связь»), поэтому не требуем его тут.
  const pixelReady = !!(pixelId.trim() || cabinet?.pixel_id);
  const ownToken = tokenSet || !!tokenInput.trim();
  const mappedCount = useMemo(() => stages.filter((s) => s.event).length, [stages]);
  const connectionReady = pixelReady;

  // ── Сохранение подключения ──
  const saveConnection = async () => {
    if (!cabinetId) return;
    setSavingConn(true);
    try {
      const patch: Record<string, unknown> = {
        pixel_id: pixelId.trim() || null,
        capi_test_event_code: testCode.trim() || null,
      };
      // Токен обновляем только если ввели новый — чтобы не затереть существующий.
      if (tokenInput.trim()) patch.access_token = tokenInput.trim();

      const { error } = await (supabase.from("ad_cabinets" as any) as any).update(patch).eq("id", cabinetId);
      if (error) throw error;
      toast.success("Подключение сохранено");
      setTokenInput("");
      await loadCabinets();
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось сохранить");
    } finally {
      setSavingConn(false);
    }
  };

  // ── Проверка связи (реальное тест-событие в Meta) ──
  const testConnection = async () => {
    if (!cabinetId) return;
    setCheck({ status: "loading" });
    try {
      // Сохраняем свежие креды, чтобы функция прочитала их из БД.
      await saveConnectionSilently();
      const { data, error } = await supabase.functions.invoke("capi-test-event", {
        body: { cabinet_id: cabinetId },
      });
      if (error) throw error;
      const res = data as any;
      const received = res?.fb_response?.events_received;
      if (res?.sent && (received ?? 0) > 0) {
        const src = res?.token_source === "shared" ? " Токен взят из подключённого Meta." : "";
        setCheck({
          status: "ok",
          message: `Meta приняла событие (${received}).${src} ${res.test_event_code ? `Смотрите в Test Events, код ${res.test_event_code}.` : "Совет: задайте Test Event Code, чтобы видеть событие в Meta Test Events."}`,
        });
      } else {
        const msg = res?.fb_response?.error?.message
          ?? (typeof res?.fb_response === "string" ? res.fb_response : JSON.stringify(res?.fb_response ?? res));
        setCheck({ status: "fail", message: msg });
      }
    } catch (e: any) {
      setCheck({ status: "fail", message: e?.message ?? String(e) });
    }
  };

  const saveConnectionSilently = async () => {
    if (!cabinetId) return;
    const patch: Record<string, unknown> = {
      pixel_id: pixelId.trim() || null,
      capi_test_event_code: testCode.trim() || null,
    };
    if (tokenInput.trim()) patch.access_token = tokenInput.trim();
    await (supabase.from("ad_cabinets" as any) as any).update(patch).eq("id", cabinetId);
    if (tokenInput.trim()) { setTokenSet(true); setTokenInput(""); }
  };

  // ── Сохранение карты этапов ──
  const setStageEvent = (idx: number, value: string) => {
    setStages((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], event: value === "none" ? "" : (value as CapiEvent) };
      return next;
    });
  };

  const saveMapping = async () => {
    if (!projectId) return;
    setSavingMap(true);
    try {
      for (const s of stages) {
        const key = s.key.trim().toLowerCase();
        if (!s.event) {
          // «Не отправлять» → убираем проектный override (останется глобальный fallback, если есть).
          await (supabase.from("crm_stage_map" as any) as any)
            .delete().eq("status_key", key).eq("project_id", projectId);
          continue;
        }
        const { error } = await (supabase.from("crm_stage_map" as any) as any).upsert(
          {
            status_key: key,
            capi_event: s.event,
            is_paid: s.event === "Purchase",
            project_id: projectId,
          },
          { onConflict: "status_key,project_id" },
        );
        if (error) throw error;
      }
      toast.success("Карта этапов сохранена");
      await loadStages();
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось сохранить карту");
    } finally {
      setSavingMap(false);
    }
  };

  const autofill = () => {
    setStages((prev) => prev.map((s) => (s.event ? s : { ...s, event: guessEvent(s.key) })));
  };

  if (!projectId) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Выберите проект, чтобы настроить CAPI.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-primary/10 p-2"><Radio className="h-4 w-4 text-primary" /></div>
        <div>
          <h2 className="text-xl font-semibold">Meta CAPI</h2>
          <p className="text-xs text-muted-foreground">
            Автоотправка конверсий в Meta при смене этапа лида. Настраивается на проект — подключил и работает.
          </p>
        </div>
      </div>

      {/* ── Сводка статуса: что подключено прямо сейчас ── */}
      {cabinets.length > 0 && (
        <Card className={`p-4 ${connectionReady ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {connectionReady
                ? <CheckCircle2 className="h-5 w-5 text-success" />
                : <XCircle className="h-5 w-5 text-warning" />}
              <div>
                <div className="text-sm font-semibold">
                  {connectionReady ? "Готово — нажмите «Проверить связь»" : "Укажите Pixel ID"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Кабинет: <b>{cabinet?.name ?? "—"}</b>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <StatusChip ok={pixelReady} label={pixelReady ? `Pixel ${cabinet?.pixel_id ?? pixelId}` : "Pixel не задан"} />
              <StatusChip ok label={ownToken ? "Токен: свой" : "Токен: из подключённого Meta"} soft={!ownToken} />
              <StatusChip ok={!!(testCode || cabinet?.capi_test_event_code)} label={(testCode || cabinet?.capi_test_event_code) ? "Test code" : "Без test code"} soft />
              <StatusChip ok={mappedCount > 0} label={`Этапов: ${mappedCount}`} />
            </div>
          </div>
        </Card>
      )}

      {/* ── 1. Подключение ── */}
      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">1. Подключение</h3>
        </div>

        <p className="text-xs text-muted-foreground">
          Для CAPI нужно всего одно: <b>Pixel ID</b>. Доступ к Meta берётся из уже подключённого
          рекламного аккаунта — <b>токен вводить не нужно</b>. Отдельный токен — только если хотите
          использовать не тот, что стоит в проекте. Test Event Code — по желанию, для безопасной проверки.
        </p>

        {cabinets.length === 0 ? (
          <Alert>
            <AlertDescription className="text-xs">
              У проекта нет рекламного кабинета. Сначала добавьте кабинет — данные пикселя и токена хранятся в нём.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {cabinets.length > 1 && (
              <Field label="Кабинет">
                <Select value={cabinetId} onValueChange={setCabinetId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cabinets.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Pixel ID">
                <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="1234567890" />
              </Field>
              <Field label="Test Event Code (опц.)" hint="Из Meta Events Manager → Test Events. Для проверки без порчи статистики.">
                <Input value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="TEST12345" />
              </Field>
            </div>

            <Field label="Access Token (необязательно)" hint={tokenSet ? `Свой токен сохранён (${mask(cabinet?.access_token)}). Введите новый, чтобы заменить.` : "Оставьте пустым — будет использован токен уже подключённого Meta-аккаунта. Заполняйте, только если нужен отдельный токен."}>
              <Input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={tokenSet ? "•••••••• (оставьте пустым, чтобы не менять)" : "оставьте пустым — возьмём из подключённого Meta"}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={saveConnection} disabled={savingConn}>
                {savingConn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
              <Button variant="outline" onClick={testConnection} disabled={check.status === "loading" || (!pixelId && !cabinet?.pixel_id)}>
                {check.status === "loading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Проверить связь
              </Button>
              {check.status === "ok" && <Badge className="bg-success/15 text-success border-success/30"><CheckCircle2 className="mr-1 h-3 w-3" /> Работает</Badge>}
              {check.status === "fail" && <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Ошибка</Badge>}
            </div>
            {check.message && (
              <Alert variant={check.status === "ok" ? "default" : "destructive"}>
                <AlertDescription className="text-xs break-words">{check.message}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </Card>

      {/* ── 2. Карта этапов ── */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">2. Какой этап → какое событие</h3>
            {mappedCount > 0 && <Badge variant="outline" className="text-[10px]">{mappedCount} активно</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={autofill}>Автозаполнить</Button>
            <Button size="sm" onClick={saveMapping} disabled={savingMap}>
              {savingMap && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить карту
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Когда лид переходит на этап — в Meta летит выбранное событие. У <b>Оплаты</b> дополнительно уходит сумма сделки как ценность конверсии.
        </p>

        {/* Легенда: что означает каждое событие */}
        <div className="grid gap-1.5 rounded-md border border-border/60 bg-muted/30 p-2.5 sm:grid-cols-2">
          {CAPI_EVENTS.map((e) => (
            <div key={e} className="flex items-baseline gap-1.5 text-[11px]">
              <span className="font-medium">{EVENT_LABEL[e].ru}</span>
              <span className="text-muted-foreground">({e})</span>
              <span className="text-muted-foreground">— {EVENT_LABEL[e].hint}</span>
            </div>
          ))}
        </div>

        {stages.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">У проекта нет воронки со стадиями.</p>
        ) : (
          <div className="space-y-2">
            {stages.map((s, idx) => (
              <div key={s.id} className="grid grid-cols-[1fr_170px] items-center gap-3 rounded-md border border-border bg-background p-2.5">
                <div>
                  <div className="text-sm font-medium">{s.title}</div>
                  <div className="text-[11px] text-muted-foreground">{s.key}</div>
                </div>
                <Select value={s.event || "none"} onValueChange={(v) => setStageEvent(idx, v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— не отправлять</SelectItem>
                    {CAPI_EVENTS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {EVENT_LABEL[e].ru}
                        {e === "Purchase" ? " (с суммой)" : ""}
                        <span className="ml-1 text-[10px] text-muted-foreground">· {e}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── 3. Монитор ── */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">3. Что уходит в Meta</h3>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Badge className="bg-success/15 text-success border-success/30">{outboxStats.sent} ушло</Badge>
            <Badge className="bg-warning/15 text-warning border-warning/30">{outboxStats.pending} в очереди</Badge>
            {outboxStats.failed > 0 && <Badge variant="destructive">{outboxStats.failed} ошибок</Badge>}
          </div>
        </div>

        {outbox.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Пока пусто. События появятся, как только лиды начнут менять этапы.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {outbox.map((r) => {
              const b = STATUS_BADGE[r.status] ?? { label: r.status, cls: "bg-muted text-muted-foreground border-border" };
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className="shrink-0">{r.event_name}</Badge>
                    {r.value != null && r.value > 0 && (
                      <span className="shrink-0 font-medium">{Number(r.value).toLocaleString("ru-RU")} {r.currency ?? ""}</span>
                    )}
                    {r.last_error && <span className="truncate text-destructive" title={r.last_error}>{r.last_error}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className={b.cls}>{b.label}</Badge>
                    <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString("ru-RU")}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatusChip({ ok, label, soft }: { ok: boolean; label: string; soft?: boolean }) {
  const cls = ok
    ? "bg-success/15 text-success border-success/30"
    : soft
      ? "bg-muted text-muted-foreground border-border"
      : "bg-warning/15 text-warning border-warning/30";
  return <Badge className={`${cls} font-normal`}>{label}</Badge>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
