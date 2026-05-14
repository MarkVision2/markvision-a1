import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, QrCode, Phone, CheckCircle2, XCircle, LogOut, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useProjectsStore } from "@/hooks/useProjectsStore";

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

const SettingsConnection = () => {
  const navigate = useNavigate();
  const { active } = useProjectsStore();
  const projectId = active?.id ?? null;
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

  const refreshState = useCallback(async () => {
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
  }, [projectId]);

  useEffect(() => {
    refreshState();
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

        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Подключение WhatsApp</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Авторизуйте инстанс Green API через QR-код или по номеру телефона
        </p>

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

        {/* Webhook URL */}
        <WebhookCard projectId={projectId} />

        {/* Bind WhatsApp instance to a project */}
        <WhatsappProjectBindCard />

        {/* Auth Methods */}
        <Card className="mt-6 border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Способ авторизации</CardTitle>
            <CardDescription>
              Выберите удобный способ привязки. QR-код — как в WhatsApp Web; по номеру — стабильнее.
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

function WebhookCard() {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/greenapi-webhook`;
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const checkSettings = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("greenapi-proxy", {
        body: { action: "settings" },
      });
      const s = (data as { data?: { webhookUrl?: string } } | null)?.data;
      setCurrent(s?.webhookUrl ?? "");
    } catch {
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkSettings();
  }, [checkSettings]);

  const setupWebhook = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("greenapi-proxy", {
        body: { action: "setWebhook", webhookUrl: url },
      });
      const ok = !error && (data as { ok?: boolean } | null)?.ok !== false;
      if (ok) {
        toast.success("Webhook настроен в Green API");
        await checkSettings();
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

  const matched = current && current.replace(/\/+$/, "") === url.replace(/\/+$/, "");

  return (
    <Card className="mt-6 border-border bg-card">
      <CardHeader>
        <CardTitle className="text-lg">Webhook для входящих сообщений</CardTitle>
        <CardDescription>
          Без этого CRM не будет получать новые сообщения WhatsApp. Нажмите «Настроить автоматически» — мы пропишем URL и включим все нужные уведомления в Green API.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">{url}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(url);
              toast.success("URL скопирован");
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
                ? "Проверка настроек…"
                : matched
                  ? "Webhook настроен и совпадает"
                  : current
                    ? `В Green API сейчас другой URL: ${current || "(пусто)"}`
                    : "Webhook не настроен"}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={checkSettings} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Проверить
            </Button>
            <Button size="sm" onClick={setupWebhook} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Настроить автоматически
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type WaBindRow = {
  id: string;
  project_id: string | null;
  id_instance: string | null;
  phone: string | null;
  connected: boolean | null;
};

export function WhatsappProjectBindCard() {
  const { active, projects } = useProjectsStore();
  const [rows, setRows] = useState<WaBindRow[]>([]);
  const [instance, setInstance] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("whatsapp_config")
      .select("id, project_id, id_instance, phone, connected");
    setRows((data ?? []) as WaBindRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const currentRow = rows.find((r) => r.project_id === active?.id) ?? null;
  useEffect(() => {
    setInstance(currentRow?.id_instance ?? "");
  }, [currentRow?.id_instance]);

  const onBind = async () => {
    if (!active?.id) {
      toast.error("Сначала выберите активный проект");
      return;
    }
    const idInstance = instance.trim();
    if (!/^\d{6,}$/.test(idInstance)) {
      toast.error("idInstance — это число из Green API console");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("bind_whatsapp_to_project", {
        p_project_id: active.id,
        p_id_instance: idInstance,
      });
      if (error) throw error;
      toast.success(`WhatsApp ${idInstance} привязан к «${active.name}»`);
      await refresh();
    } catch (e) {
      toast.error("Не удалось привязать", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  // Найти конфликт: один и тот же idInstance уже привязан к другому проекту
  const conflict = instance.trim() && rows.find(
    (r) => r.id_instance === instance.trim() && r.project_id !== active?.id,
  );
  const conflictProject = conflict
    ? projects.find((p) => p.id === conflict.project_id)?.name
    : null;

  return (
    <Card className="mt-6 border-border bg-card">
      <CardHeader>
        <CardTitle className="text-lg">WhatsApp → проект</CardTitle>
        <CardDescription>
          Каждый Green API инстанс привязывается к одному проекту. Входящее сообщение на этот номер попадёт в CRM именно этого проекта, в этап «Новая». Активный проект: <strong>{active?.name ?? "—"}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка…
          </div>
        ) : (
          <>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                idInstance из Green API (число, видно в Green API console)
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  placeholder="например 7107605912"
                  className="flex-1"
                />
                <Button onClick={onBind} disabled={saving || !active?.id}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {currentRow?.id_instance ? "Перепривязать" : "Привязать"}
                </Button>
              </div>
              {conflictProject ? (
                <p className="mt-1.5 text-[11px] text-destructive">
                  Этот idInstance уже привязан к проекту «{conflictProject}». Перепривязка перенесёт его на «{active?.name}».
                </p>
              ) : currentRow ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Текущая привязка: <code>{currentRow.id_instance ?? "—"}</code>
                  {currentRow.phone ? `, номер ${currentRow.phone}` : ""}
                  {currentRow.connected ? " · подключён" : ""}
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  У этого проекта пока нет привязанного WhatsApp.
                </p>
              )}
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

