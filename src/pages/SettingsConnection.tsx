import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, QrCode, Phone, CheckCircle2, XCircle, LogOut, RefreshCw, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { getCrmWebhookUrl, isValidBotWebhookUrl, WHATSAPP_SETUP_STEPS } from "@/lib/whatsappSetup";

type GreenResp<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | { message?: string } | string;
};

type StateData = { stateInstance?: string };
type QrData = { type?: "qrCode" | "alreadyLogged" | "error"; message?: string };
type CodeData = { status?: boolean; code?: string };

const STATE_LABELS: Record<string, { label: string; tone: "success" | "warning" | "muted" | "danger" }> = {
  authorized: { label: "Авторизован", tone: "success" },
  notAuthorized: { label: "Не авторизован", tone: "warning" },
  blocked: { label: "Заблокирован", tone: "danger" },
  sleepMode: { label: "Спящий режим", tone: "muted" },
  starting: { label: "Запускается", tone: "muted" },
  yellowCard: { label: "Жёлтая карточка", tone: "warning" },
};

const callProxy = async <T = unknown,>(
  action: "status" | "qr" | "getCode" | "logout" | "settings" | "setWebhook",
  body?: Record<string, unknown>,
  projectId?: string | null,
): Promise<GreenResp<T>> => {
  const { data, error } = await supabase.functions.invoke("greenapi-proxy", {
    body: { action, ...(projectId ? { project_id: projectId } : {}), ...(body ?? {}) },
  });
  if (error) throw new Error(error.message);
  return data as GreenResp<T>;
};

type WaBindRow = {
  id: string;
  project_id: string | null;
  id_instance: string | null;
  api_token_present: boolean | null;
  api_url: string | null;
  phone: string | null;
  connected: boolean | null;
  ads_only: boolean | null;
  bot_webhook_url?: string | null;
  webhook_url?: string | null;
};

const SettingsConnection = () => {
  const navigate = useNavigate();
  const { active } = useProjectsStore();
  const projectId = active?.id ?? null;
  const [waRow, setWaRow] = useState<WaBindRow | null>(null);
  const [waLoading, setWaLoading] = useState(true);
  const [webhookOk, setWebhookOk] = useState(false);
  const [state, setState] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrMsg, setQrMsg] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const pollRef = useRef<number | null>(null);

  const refreshWaRow = useCallback(async () => {
    if (!projectId) {
      setWaRow(null);
      setWaLoading(false);
      return;
    }
    setWaLoading(true);
    const { data } = await supabase
      .from("whatsapp_config_safe")
      .select("id, project_id, id_instance, api_token_present, api_url, phone, connected, ads_only, bot_webhook_url, webhook_url")
      .eq("project_id", projectId)
      .maybeSingle();
    setWaRow((data as WaBindRow | null) ?? null);
    setWaLoading(false);
  }, [projectId]);

  const refreshState = useCallback(async () => {
    if (!projectId || !waRow?.id_instance || !waRow?.api_token_present) {
      setState(null);
      return;
    }
    setLoadingState(true);
    try {
      const r = await callProxy<StateData>("status", undefined, projectId);
      const s = (r.data as StateData)?.stateInstance ?? null;
      setState(s);
    } catch (e) {
      toast.error("Не удалось получить статус", { description: (e as Error).message });
    } finally {
      setLoadingState(false);
    }
  }, [projectId, waRow?.api_token_present, waRow?.id_instance]);

  useEffect(() => {
    void refreshWaRow();
  }, [refreshWaRow]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const fetchQr = useCallback(async () => {
    setQrLoading(true);
    setQrMsg(null);
    try {
      const r = await callProxy<QrData>("qr", undefined, projectId);
      const d = r.data as QrData;
      if (d?.type === "qrCode" && d.message) {
        setQrImage(`data:image/png;base64,${d.message}`);
      } else if (d?.type === "alreadyLogged") {
        setQrImage(null);
        setQrMsg("Устройство уже подключено");
        setQrOpen(false);
        toast.success("WhatsApp подключён");
        refreshState();
      } else {
        setQrMsg(d?.message ?? "Не удалось получить QR-код");
      }
    } catch (e) {
      setQrMsg((e as Error).message);
    } finally {
      setQrLoading(false);
    }
  }, [refreshState, projectId]);

  // Polling every 20s when modal is open
  useEffect(() => {
    if (!qrOpen) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    fetchQr();
    pollRef.current = window.setInterval(fetchQr, 20000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [qrOpen, fetchQr]);

  const handleGetCode = async () => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      toast.error("Введите номер в международном формате (только цифры)");
      return;
    }
    setCodeLoading(true);
    setCode(null);
    try {
      const r = await callProxy<CodeData>("getCode", { phoneNumber: digits }, projectId);
      const d = r.data as CodeData;
      if (d?.status && d.code) {
        setCode(d.code);
        toast.success("Код получен. Введите его в WhatsApp.");
      } else {
        toast.error("Не удалось получить код. Возможно, инстанс уже авторизован.");
      }
    } catch (e) {
      toast.error("Ошибка запроса", { description: (e as Error).message });
    } finally {
      setCodeLoading(false);
    }
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await callProxy("logout", undefined, projectId);
      toast.success("Вы вышли из WhatsApp");
      setCode(null);
      await refreshState();
    } catch (e) {
      toast.error("Ошибка выхода", { description: (e as Error).message });
    } finally {
      setLogoutLoading(false);
    }
  };

  const stateMeta = state ? STATE_LABELS[state] : null;
  const isAuthed = state === "authorized";
  const isBound = !!(waRow?.id_instance && waRow?.api_token_present);
  const crmUrl = getCrmWebhookUrl();
  const setupSteps = {
    bind: isBound,
    auth: isAuthed,
    webhook: webhookOk,
    bot: !!(waRow?.bot_webhook_url?.trim()),
  };

  return (
    <main className="min-h-screen">
      <section className="container max-w-3xl pt-10 pb-16 sm:pt-14 animate-fade-in-up">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/settings")}
          className="-ml-2 mb-4 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          К настройкам
        </Button>

        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Подключение WhatsApp</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Green API → CRM MarkVision. Проект: <strong>{active?.name ?? "не выбран"}</strong>.
          В Green API Console webhook всегда указывает на CRM URL ниже; n8n-бот подключается отдельным полем.
        </p>

        <WhatsAppSetupChecklist steps={setupSteps} loading={waLoading} />

        <WhatsappProjectBindCard
          projectId={projectId}
          projectName={active?.name ?? null}
          row={waRow}
          loading={waLoading}
          onRefresh={refreshWaRow}
          onBound={async () => {
            await refreshWaRow();
            await refreshState();
          }}
        />

        <WebhookCard
          projectId={projectId}
          crmUrl={crmUrl}
          row={waRow}
          onWebhookStatus={setWebhookOk}
          onRefresh={refreshWaRow}
        />

        {/* Status Card */}
        <Card className="mt-8 border-border bg-card">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Текущий статус</CardTitle>
              <CardDescription>Состояние инстанса Green API</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshState}
              disabled={loadingState}
              className="gap-2"
            >
              {loadingState ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {isAuthed ? (
                <CheckCircle2 className="h-6 w-6 text-success" />
              ) : (
                <XCircle className="h-6 w-6 text-muted-foreground" />
              )}
              <div>
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium",
                    stateMeta?.tone === "success" && "border-success/40 bg-success/10 text-success",
                    stateMeta?.tone === "warning" && "border-warning/40 bg-warning/10 text-warning",
                    stateMeta?.tone === "danger" && "border-destructive/40 bg-destructive/10 text-destructive",
                    (!stateMeta || stateMeta.tone === "muted") && "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {stateMeta?.label ?? state ?? "Неизвестно"}
                </Badge>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isAuthed
                    ? "WhatsApp подключён и готов к работе"
                    : "Авторизуйтесь одним из способов ниже"}
                </p>
              </div>
              {isAuthed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive hover:text-destructive"
                  onClick={handleLogout}
                  disabled={logoutLoading}
                >
                  {logoutLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4" />
                  )}
                  Отвязать
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Auth Methods */}
        <Card className="mt-6 border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Шаг 2 — Авторизовать WhatsApp</CardTitle>
            <CardDescription>
              После шага 1 отсканируйте QR или получите код по номеру. Без авторизации сообщения не пойдут.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="qr" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="qr" className="gap-2">
                  <QrCode className="h-4 w-4" />
                  QR-код
                </TabsTrigger>
                <TabsTrigger value="phone" className="gap-2">
                  <Phone className="h-4 w-4" />
                  По номеру
                </TabsTrigger>
              </TabsList>

              <TabsContent value="qr" className="mt-6 space-y-4">
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  <li>Откройте WhatsApp на телефоне</li>
                  <li>Меню → «Связанные устройства» → «Привязка устройства»</li>
                  <li>Нажмите «Получить QR-код» и отсканируйте его</li>
                </ol>
                <Button
                  size="lg"
                  onClick={() => setQrOpen(true)}
                  disabled={isAuthed}
                  className="gap-2"
                >
                  <QrCode className="h-4 w-4" />
                  Получить QR-код
                </Button>
                {isAuthed && (
                  <p className="text-xs text-muted-foreground">
                    Сначала отвяжите текущий аккаунт, чтобы получить новый QR.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="phone" className="mt-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Номер телефона</label>
                  <Input
                    placeholder="77001234567"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    maxLength={15}
                  />
                  <p className="text-xs text-muted-foreground">
                    Международный формат без «+» и «00» (только цифры).
                  </p>
                </div>
                <Button onClick={handleGetCode} disabled={codeLoading || isAuthed} className="gap-2">
                  {codeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                  Получить код
                </Button>

                {code && (
                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Код авторизации
                    </p>
                    <p className="mt-2 font-mono text-4xl font-bold tracking-[0.4em] text-primary">
                      {code}
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Введите код в WhatsApp: «Связанные устройства» → «Привязка устройства» → «Привязка по номеру телефона». Код действителен ~2,5 минуты.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>

      {/* QR Dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Сканируйте QR-код</DialogTitle>
            <DialogDescription>
              Откройте WhatsApp → Связанные устройства → Привязка устройства. Код обновляется каждые 20 секунд.
            </DialogDescription>
          </DialogHeader>
          <div className="grid place-items-center py-4">
            <div className="relative grid h-[280px] w-[280px] place-items-center overflow-hidden rounded-2xl border border-border bg-white">
              {qrLoading && !qrImage && (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              )}
              {qrImage && (
                <img src={qrImage} alt="WhatsApp QR" className="h-full w-full object-contain" />
              )}
              {!qrLoading && !qrImage && qrMsg && (
                <p className="px-4 text-center text-sm text-muted-foreground">{qrMsg}</p>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={fetchQr} disabled={qrLoading} className="gap-2">
            {qrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить QR
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
};

function WhatsAppSetupChecklist({
  steps,
  loading,
}: {
  steps: { bind: boolean; auth: boolean; webhook: boolean; bot: boolean };
  loading: boolean;
}) {
  const values = [steps.bind, steps.auth, steps.webhook, steps.bot];
  return (
    <Card className="mt-6 border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Чек-лист подключения</CardTitle>
        <CardDescription>Шаги 1–3 обязательны для CRM. Шаг 4 — если нужен n8n-бот.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {WHATSAPP_SETUP_STEPS.map((step, i) => {
          const done = values[i];
          const optional = step.id === "bot";
          return (
            <div key={step.id} className="flex items-start gap-2 text-sm">
              {loading ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div>
                <span className="font-medium">
                  {i + 1}. {step.title}
                  {optional ? " (опционально)" : ""}
                </span>
                <p className="text-xs text-muted-foreground">{step.hint}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function WebhookCard({
  projectId,
  crmUrl,
  row,
  onWebhookStatus,
  onRefresh,
}: {
  projectId: string | null;
  crmUrl: string;
  row: WaBindRow | null;
  onWebhookStatus: (ok: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [botUrl, setBotUrl] = useState("");
  const [botSaving, setBotSaving] = useState(false);

  useEffect(() => {
    setBotUrl(row?.bot_webhook_url ?? "");
  }, [row?.bot_webhook_url]);

  const checkSettings = useCallback(async () => {
    if (!projectId || !row?.id_instance) {
      setCurrent(null);
      onWebhookStatus(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("greenapi-proxy", {
        body: { action: "settings", project_id: projectId },
      });
      const s = (data as { data?: { webhookUrl?: string } } | null)?.data;
      const live = s?.webhookUrl ?? "";
      setCurrent(live);
      const matched = !!live && live.replace(/\/+$/, "") === crmUrl.replace(/\/+$/, "");
      onWebhookStatus(matched);
    } catch {
      setCurrent(null);
      onWebhookStatus(!!row?.webhook_url && row.webhook_url.replace(/\/+$/, "") === crmUrl.replace(/\/+$/, ""));
    } finally {
      setLoading(false);
    }
  }, [projectId, row?.id_instance, row?.webhook_url, crmUrl, onWebhookStatus]);

  useEffect(() => {
    void checkSettings();
  }, [checkSettings]);

  const setupWebhook = async () => {
    if (!projectId) {
      toast.error("Выберите активный проект");
      return;
    }
    if (!row?.id_instance || !row?.api_token_present) {
      toast.error("Сначала привяжите idInstance и apiToken к проекту");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("greenapi-proxy", {
        body: { action: "setWebhook", webhookUrl: crmUrl, project_id: projectId },
      });
      const ok = !error && (data as { ok?: boolean } | null)?.ok !== false;
      if (ok) {
        toast.success("Webhook CRM прописан в Green API");
        await checkSettings();
        await onRefresh();
      } else {
        toast.error("Не удалось настроить webhook", {
          description: JSON.stringify((data as { data?: unknown })?.data ?? error),
        });
      }
    } catch (e) {
      toast.error("Ошибка", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const saveBotUrl = async () => {
    if (!projectId) return;
    const trimmed = botUrl.trim();
    if (trimmed && !isValidBotWebhookUrl(trimmed)) {
      toast.error("URL бота должен начинаться с https://");
      return;
    }
    setBotSaving(true);
    try {
      const { error } = await supabase.rpc("save_whatsapp_bot_webhook", {
        p_project_id: projectId,
        p_bot_webhook_url: trimmed || null,
      });
      if (error) throw error;
      toast.success(trimmed ? "URL n8n-бота сохранён" : "Пересылка в n8n отключена");
      await onRefresh();
    } catch (e) {
      toast.error("Не удалось сохранить", { description: (e as Error).message });
    } finally {
      setBotSaving(false);
    }
  };

  const matched = current && current.replace(/\/+$/, "") === crmUrl.replace(/\/+$/, "");

  return (
    <Card className="mt-6 border-border bg-card">
      <CardHeader>
        <CardTitle className="text-lg">Шаг 3 — Webhook CRM (обязательно)</CardTitle>
        <CardDescription>
          Green API принимает только один webhook URL. Он должен указывать на CRM — тогда все сообщения попадают в лиды и чаты.
          Не вставляйте сюда n8n: для бота есть отдельное поле ниже.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">{crmUrl}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(crmUrl);
              toast.success("CRM URL скопирован");
            }}
          >
            Копировать
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : matched ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
            <span className="text-muted-foreground">
              {loading
                ? "Проверка…"
                : matched
                  ? "Green API → CRM настроено"
                  : current
                    ? `В Green API другой URL: ${current || "(пусто)"}`
                    : "Webhook не настроен — сообщения не попадут в CRM"}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={checkSettings} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Проверить
            </Button>
            <Button size="sm" onClick={setupWebhook} disabled={saving || !row?.api_token_present}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Настроить в Green API
            </Button>
          </div>
        </div>

        <div className="space-y-2 border-t border-border/60 pt-4">
          <p className="text-xs font-medium text-muted-foreground">
            Шаг 4 — URL n8n-бота (опционально)
          </p>
          <Input
            value={botUrl}
            onChange={(e) => setBotUrl(e.target.value)}
            placeholder="https://n8n.zapoinov.com/webhook/whatsapp-bot"
          />
          <p className="text-[11px] text-muted-foreground">
            Копия каждого события Green API уходит на этот URL после записи в CRM. В Green API Console webhook остаётся CRM URL выше.
          </p>
          <Button size="sm" variant="outline" onClick={saveBotUrl} disabled={botSaving || !projectId}>
            {botSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Сохранить URL бота
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function WhatsappProjectBindCard({
  projectId,
  projectName,
  row,
  loading,
  onRefresh,
  onBound,
}: {
  projectId: string | null;
  projectName: string | null;
  row: WaBindRow | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onBound?: () => Promise<void>;
}) {
  const { projects } = useProjectsStore();
  const [rows, setRows] = useState<WaBindRow[]>([]);
  const [instance, setInstance] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const refreshAll = useCallback(async () => {
    const { data } = await supabase
      .from("whatsapp_config_safe")
      .select("id, project_id, id_instance, api_token_present, api_url, phone, connected, ads_only, bot_webhook_url, webhook_url");
    setRows((data ?? []) as WaBindRow[]);
    await onRefresh();
  }, [onRefresh]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  const currentRow = row;
  useEffect(() => {
    setInstance(currentRow?.id_instance ?? "");
    setApiToken("");
    setApiUrl(currentRow?.api_url ?? "");
  }, [currentRow?.id_instance, currentRow?.api_token_present, currentRow?.api_url]);

  const onBind = async () => {
    if (!projectId) {
      toast.error("Сначала выберите активный проект");
      return;
    }
    const idInstance = instance.trim();
    const token = apiToken.trim();
    if (!/^\d{6,}$/.test(idInstance)) {
      toast.error("idInstance — это число из Green API console");
      return;
    }
    const hasStoredToken = !!currentRow?.api_token_present;
    if (!hasStoredToken && (!token || token.length < 20)) {
      toast.error("apiTokenInstance обязателен — скопируйте его из Green API console");
      return;
    }
    const trimmedApiUrl = apiUrl.trim();
    if (trimmedApiUrl) {
      try {
        const u = new URL(trimmedApiUrl);
        const host = u.hostname.toLowerCase();
        const allowed =
          host === "api.green-api.com"
          || host === "api.greenapi.com"
          || /^[a-z0-9-]+\.api\.greenapi\.com$/i.test(host);
        if (u.protocol !== "https:" || !allowed || (u.pathname !== "/" && u.pathname !== "")) {
          toast.error("apiUrl должен быть https://api.green-api.com или региональный *.api.greenapi.com");
          return;
        }
      } catch {
        toast.error("Некорректный apiUrl");
        return;
      }
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("bind_whatsapp_to_project", {
        p_project_id: projectId,
        p_id_instance: idInstance,
        p_api_token: token.length >= 20 ? token : undefined,
        p_api_url: trimmedApiUrl || null,
      });
      if (error) throw error;
      toast.success(`WhatsApp ${idInstance} привязан к «${projectName ?? "проект"}»`, {
        description: "Дальше: авторизуйте WA и настройте webhook CRM.",
      });
      await refreshAll();
      await onBound?.();
      // Авто-прописка CRM webhook сразу после привязки
      try {
        const { data } = await supabase.functions.invoke("greenapi-proxy", {
          body: { action: "setWebhook", webhookUrl: getCrmWebhookUrl(), project_id: projectId },
        });
        if ((data as { ok?: boolean } | null)?.ok) {
          toast.success("Webhook CRM автоматически прописан в Green API");
        }
      } catch {
        /* пользователь настроит вручную на шаге 3 */
      }
    } catch (e) {
      toast.error("Не удалось привязать", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const conflict = instance.trim() && rows.find(
    (r) => r.id_instance === instance.trim() && r.project_id !== projectId,
  );
  const conflictProject = conflict
    ? projects.find((p) => p.id === conflict.project_id)?.name
    : null;

  return (
    <Card className="mt-6 border-border bg-card">
      <CardHeader>
        <CardTitle className="text-lg">Шаг 1 — Привязать Green API к проекту</CardTitle>
        <CardDescription>
          Скопируйте из <a href="https://console.green-api.com" target="_blank" rel="noreferrer" className="underline">Green API Console</a> idInstance и apiTokenInstance.
          Сообщения на этот номер попадут в CRM проекта <strong>{projectName ?? "—"}</strong>, этап «Новая».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка…
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  idInstance (число из Green API console)
                </p>
                <Input
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  placeholder="например 7107605912"
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  apiTokenInstance (длинный токен, видно рядом с idInstance)
                </p>
                <Input
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={
                    currentRow?.api_token_present
                      ? "•••••• (оставьте пустым, чтобы не менять)"
                      : "b3e0…"
                  }
                  type="password"
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  apiUrl (опционально — если у вашего инстанса другой регион)
                </p>
                <Input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://api.green-api.com"
                />
              </div>
              {currentRow?.id ? (
                <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
                  <div className="text-xs">
                    <p className="font-medium text-foreground">Только заявки с рекламы Meta (CTWA)</p>
                    <p className="mt-1 text-muted-foreground">
                      Выключено по умолчанию — все входящие попадают в CRM. Включите, если нужны только лиды из Click-to-WhatsApp рекламы. Существующим лидам сообщения сохраняются всегда; n8n-бот получает копии в любом случае.
                    </p>
                  </div>
                  <Switch
                    checked={!!currentRow.ads_only}
                    onCheckedChange={async (v) => {
                      const { error } = await supabase
                        .from("whatsapp_config")
                        .update({ ads_only: v })
                        .eq("id", currentRow.id);
                      if (error) {
                        toast.error("Не удалось сохранить", { description: error.message });
                      } else {
                        toast.success(v ? "Фильтр включён: только реклама" : "Фильтр выключен: все входящие");
                        await refresh();
                      }
                    }}
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-muted-foreground">
                  {conflictProject ? (
                    <span className="text-destructive">
                      Этот idInstance уже привязан к «{conflictProject}». Перепривязка перенесёт его на «{projectName}».
                    </span>
                  ) : currentRow ? (
                    <>
                      Текущая привязка: <code>{currentRow.id_instance ?? "—"}</code>
                      {currentRow.phone ? `, номер ${currentRow.phone}` : ""}
                      {currentRow.connected ? " · подключён" : ""}
                    </>
                  ) : (
                    "У этого проекта пока нет привязанного WhatsApp."
                  )}
                </div>
                <Button onClick={onBind} disabled={saving || !projectId}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {currentRow?.id_instance ? "Перепривязать" : "Привязать"}
                </Button>
              </div>
            </div>

            {rows.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Все привязки в системе
                </p>
                <div className="overflow-hidden rounded-md border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Проект</th>
                        <th className="px-3 py-2 font-medium">idInstance</th>
                        <th className="px-3 py-2 font-medium">Номер</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const proj = projects.find((p) => p.id === r.project_id);
                        return (
                          <tr key={r.id} className="border-t border-border/40">
                            <td className="px-3 py-2">{proj?.name ?? "—"}</td>
                            <td className="px-3 py-2"><code>{r.id_instance ?? "—"}</code></td>
                            <td className="px-3 py-2">{r.phone ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SiteIntakeCard() {
  const { active, rotateIntakeToken } = useProjectsStore();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lead-intake`;
  const token = active?.intakeToken ?? "";
  const projectName = active?.name ?? "—";
  const [testing, setTesting] = useState(false);
  const [rotating, setRotating] = useState(false);

  const sendTestLead = async () => {
    if (!token) {
      toast.error("Сначала выберите проект");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: "Тестовая заявка",
          phone: `+7700${Math.floor(1000000 + Math.random() * 8999999)}`,
          email: "test@example.com",
          message: "Это проверка вебхука с сайта",
          source: "site",
          utm_source: "test",
          utm_campaign: "webhook_check",
          landing_url: window.location.href,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && (data as { ok?: boolean } | null)?.ok) {
        toast.success(`Тест прошёл — заявка в CRM проекта «${projectName}»`, {
          description: "Откройте CRM, чтобы её увидеть в этапе «Новая».",
        });
      } else {
        toast.error("Тест не прошёл", {
          description: `HTTP ${res.status}: ${(data as { error?: string } | null)?.error ?? "неизвестная ошибка"}`,
        });
      }
    } catch (e) {
      toast.error("Сеть недоступна", {
        description: (e as Error).message,
      });
    } finally {
      setTesting(false);
    }
  };

  const onRotate = async () => {
    if (!active?.id) return;
    if (!confirm("Перевыпустить webhook? Старый URL перестанет работать на всех сайтах этого проекта.")) {
      return;
    }
    setRotating(true);
    try {
      await rotateIntakeToken(active.id);
      toast.success("Webhook перевыпущен", {
        description: "Скопируйте новый URL и обновите его на всех сайтах проекта.",
      });
    } catch (e) {
      toast.error("Не удалось перевыпустить", { description: (e as Error).message });
    } finally {
      setRotating(false);
    }
  };

  const htmlSnippet = `<!-- Форма заявки → CRM проекта «${projectName}», этап «Новая» -->
<form id="lead-form">
  <input name="name" placeholder="Имя" required />
  <input name="phone" placeholder="+7..." required />
  <input name="email" placeholder="Email" type="email" />
  <textarea name="message" placeholder="Комментарий"></textarea>
  <!-- honeypot: скрытое поле против ботов, оставьте пустым -->
  <input name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" />
  <button type="submit">Отправить</button>
</form>

<script>
(function () {
  // Токен проекта — НЕ удалять, привязывает заявки к нужному CRM-проекту.
  var PROJECT_TOKEN = '${token}';
  var WEBHOOK_URL = '${url}';
  var form = document.getElementById('lead-form');
  if (!form) return;
  // Подхватываем UTM из URL и сохраняем между страницами
  var qs = new URLSearchParams(location.search);
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function (k) {
    var v = qs.get(k); if (v) try { sessionStorage.setItem(k, v); } catch(e) {}
  });
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var fd = new FormData(form);
    var payload = Object.fromEntries(fd.entries());
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function (k) {
      try { var v = sessionStorage.getItem(k); if (v && !payload[k]) payload[k] = v; } catch(e) {}
    });
    payload.token = PROJECT_TOKEN;
    payload.referrer = document.referrer || '';
    payload.landing_url = location.href;
    payload.source = payload.source || 'site';
    try {
      var r = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) { form.reset(); alert('Спасибо! Мы свяжемся с вами.'); }
      else { alert('Ошибка отправки. Попробуйте ещё раз.'); }
    } catch (err) { alert('Ошибка сети. Попробуйте ещё раз.'); }
  });
})();
</script>`;

  const tildaHint = `Tilda → Настройки сайта → Формы → WebHook
URL: ${url}
Метод: POST (JSON)
Проект: ${projectName}

ВАЖНО: добавь в форму скрытое поле:
  Имя поля: token
  Значение: ${token}

Без этого поля заявка не привяжется к проекту. Также сохранятся имя, телефон, email, комментарий и UTM-метки.`;

  return (
    <Card className="mt-6 border-border bg-card">
      <CardHeader>
        <CardTitle className="text-lg">Webhook для заявок с сайта</CardTitle>
        <CardDescription>
          Активный проект: <strong>{projectName}</strong>. На сайте используйте <strong>URL вебхука</strong> + добавьте <strong>скрытое поле <code>token</code></strong> со значением токена ниже — это привяжет заявку к нужному проекту. Заявка попадёт в этап «Новая».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!token && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            Создайте или выберите проект — тогда здесь появится уникальный webhook.
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">URL вебхука</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">{url}</code>
            <Button
              variant="outline"
              size="sm"
              disabled={!token}
              onClick={() => {
                navigator.clipboard.writeText(url);
                toast.success("URL скопирован");
              }}
            >
              Копировать
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!token || rotating}
              onClick={onRotate}
              title="Перевыпустить токен (старый URL перестанет работать)"
            >
              {rotating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              onClick={sendTestLead}
              disabled={!token || testing}
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Отправить тест
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            «Отправить тест» создаст одну тестовую заявку в CRM текущего проекта.
            «Перевыпустить» меняет токен — после этого старый токен <strong>перестаёт работать</strong> на всех сайтах.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Токен проекта (добавьте в форму как скрытое поле <code>token</code>)
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">
              {token || "—"}
            </code>
            <Button
              variant="outline"
              size="sm"
              disabled={!token}
              onClick={() => {
                navigator.clipboard.writeText(token);
                toast.success("Токен скопирован");
              }}
            >
              Копировать
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Без этого токена заявка попадёт в общий пул без привязки к проекту.
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Подключение к Tilda</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(tildaHint);
                toast.success("Инструкция скопирована");
              }}
            >
              Копировать
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
{tildaHint}
          </pre>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Готовый сниппет для любой HTML-формы (UTM подхватываются автоматически)</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(htmlSnippet);
                toast.success("Сниппет скопирован");
              }}
            >
              Копировать сниппет
            </Button>
          </div>
          <pre className="max-h-72 overflow-auto rounded-md bg-muted px-3 py-2 text-[11px] leading-relaxed">
{htmlSnippet}
          </pre>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          Поддерживаются <code>application/json</code> и <code>application/x-www-form-urlencoded</code>. CORS открыт. Поля: <code>name</code>, <code>phone</code> (обязательно), <code>email</code>, <code>message</code>, <code>service</code>, <code>city</code>, <code>utm_source/medium/campaign/content/term</code>, <code>referrer</code>, <code>landing_url</code>, <code>source</code> (необязательно — переопределит источник).
        </div>
      </CardContent>
    </Card>
  );
}

export default SettingsConnection;

