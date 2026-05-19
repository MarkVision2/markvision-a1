import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Check, Loader2, Copy, ExternalLink,
  Building2, Megaphone, Facebook, MessageCircle, Globe, Workflow,
  TrendingUp, FlaskConical, AlertCircle, CheckCircle2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { cn } from "@/lib/utils";
import { HealthCheckPanel } from "@/components/onboarding/HealthCheckPanel";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/greenapi-webhook`;

const STEPS = [
  { id: 1, title: "Идентификация", icon: Building2 },
  { id: 2, title: "Meta Ads API", icon: Megaphone },
  { id: 3, title: "Facebook + Instagram", icon: Facebook },
  { id: 4, title: "GreenAPI / WhatsApp", icon: MessageCircle },
  { id: 5, title: "Лендинг и трекинг", icon: Globe },
  { id: 6, title: "CRM → CAPI mapping", icon: Workflow },
  { id: 7, title: "Финансовый план", icon: TrendingUp },
  { id: 8, title: "Тест-прогон", icon: FlaskConical },
];

const CURRENCIES = ["KZT", "USD", "RUB", "EUR"] as const;
const TIMEZONES = ["Asia/Almaty", "Europe/Moscow", "Europe/Kiev", "Asia/Tashkent", "Asia/Bishkek"] as const;
const PIXEL_EVENTS = ["Lead", "CompleteRegistration", "Contact", "SubmitApplication"] as const;
const CAPI_EVENTS = ["", "Schedule", "Diagnostic", "Purchase"] as const;

function normalizeAct(id: string) {
  const t = id.trim();
  if (!t) return "";
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

function mask(s: string | undefined) {
  if (!s) return "";
  if (s.length <= 6) return "•".repeat(s.length);
  return "•".repeat(Math.max(8, s.length - 4)) + s.slice(-4);
}

type CheckState = { status: "idle" | "loading" | "ok" | "fail"; message?: string };

export default function ProjectIntegrationWizard() {
  const { user } = useAuth();
  const { addProject } = useProjectsStore();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [cabinetId, setCabinetId] = useState<string | null>(null);
  const [intakeToken, setIntakeToken] = useState<string | null>(null);

  // Step 1
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [city, setCity] = useState("");
  const [currency, setCurrency] = useState<typeof CURRENCIES[number]>("KZT");
  const [timezone, setTimezone] = useState<typeof TIMEZONES[number]>("Asia/Almaty");

  // Step 2
  const [adAccountId, setAdAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [pixelEvent, setPixelEvent] = useState<typeof PIXEL_EVENTS[number]>("Lead");
  const [capiTestCode, setCapiTestCode] = useState("");
  const [metaCheck, setMetaCheck] = useState<CheckState>({ status: "idle" });

  // Step 3
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [instagramId, setInstagramId] = useState("");

  // Step 4
  const [waInstance, setWaInstance] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [waCheck, setWaCheck] = useState<CheckState>({ status: "idle" });
  const [waWebhook, setWaWebhook] = useState<CheckState>({ status: "idle" });

  // Step 5
  const [landingUrl, setLandingUrl] = useState("");
  const [telegramGroupId, setTelegramGroupId] = useState("");

  // Step 6
  type StageRow = { id: string; key: string; title: string; capi_event: string };
  const [stages, setStages] = useState<StageRow[]>([]);

  // Step 7
  const [monthSpend, setMonthSpend] = useState("");
  const [monthLeads, setMonthLeads] = useState("");
  const [monthCpl, setMonthCpl] = useState("");
  const [monthSales, setMonthSales] = useState("");
  const [monthRevenue, setMonthRevenue] = useState("");

  // Step 8
  const [testResults, setTestResults] = useState<Record<string, CheckState>>({});

  const utmTemplate = useMemo(
    () =>
      "?utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}",
    [],
  );
  const intakeUrl = useMemo(
    () => (intakeToken ? `${SUPABASE_URL}/functions/v1/lead-intake/t/${intakeToken}` : ""),
    [intakeToken],
  );

  const copy = (txt: string, label = "Скопировано") => {
    navigator.clipboard.writeText(txt);
    toast.success(label);
  };

  // === Save handlers per step ===
  async function saveStep1Next() {
    if (!name.trim()) return toast.error("Укажите имя проекта");
    setBusy(true);
    try {
      const project = await addProject(name, domain || undefined);
      setProjectId(project.id);
      setIntakeToken(project.intakeToken || null);
      // create empty cabinet
      const { data: cab, error: cabErr } = await supabase
        .from("ad_cabinets")
        .insert({
          name,
          project_id: project.id,
          external_id: "",
          type: "Личный",
          city: city || null,
          currency,
          timezone,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (cabErr || !cab) throw cabErr;
      setCabinetId(cab.id);
      setStep(2);
    } catch (e: any) {
      toast.error("Не удалось создать проект: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function saveStep2Next() {
    if (!cabinetId) return;
    const normAct = normalizeAct(adAccountId);
    setBusy(true);
    try {
      const { error } = await supabase
        .from("ad_cabinets")
        .update({
          external_id: normAct,
          ad_account_id: normAct,
          access_token: accessToken || null,
          pixel_id: pixelId || null,
          pixel_event: pixelEvent,
        })
        .eq("id", cabinetId);
      if (error) throw error;
      setStep(3);
    } catch (e: any) {
      toast.error("Не удалось сохранить: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function checkMeta() {
    if (!cabinetId) return;
    setMetaCheck({ status: "loading" });
    try {
      // save first so the function can read from DB
      const normAct = normalizeAct(adAccountId);
      await supabase
        .from("ad_cabinets")
        .update({
          external_id: normAct,
          ad_account_id: normAct,
          access_token: accessToken || null,
          pixel_id: pixelId || null,
        })
        .eq("id", cabinetId);

      const { data, error } = await supabase.functions.invoke("meta-validate-cabinet", {
        body: { cabinetId },
      });
      if (error) throw error;
      const checks: any[] = (data as any)?.checks ?? [];
      const allOk = checks.length > 0 && checks.every((c) => c.ok);
      const detail = checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail ?? ""}`).join(" • ");
      setMetaCheck({ status: allOk ? "ok" : "fail", message: detail });
    } catch (e: any) {
      setMetaCheck({ status: "fail", message: e?.message ?? String(e) });
    }
  }

  async function saveStep3Next() {
    if (!cabinetId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("ad_cabinets")
        .update({
          page_id: pageId || null,
          page_name: pageName || null,
          instagram_id: instagramId || null,
        })
        .eq("id", cabinetId);
      if (error) throw error;
      setStep(4);
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function saveStep4Next() {
    if (!projectId) return;
    setBusy(true);
    try {
      if (waInstance && waToken) {
        await supabase.rpc("bind_whatsapp_to_project", {
          p_project_id: projectId,
          p_id_instance: waInstance,
          p_api_token: waToken,
          p_api_url: null,
        });
      }
      if (waNumber && cabinetId) {
        await supabase.from("ad_cabinets").update({ whatsapp_number: waNumber }).eq("id", cabinetId);
      }
      setStep(5);
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function checkWhatsApp() {
    if (!projectId) return toast.error("Сначала сохраните проект");
    setWaCheck({ status: "loading" });
    try {
      // save creds first via RPC so proxy can resolve them
      await supabase.rpc("bind_whatsapp_to_project", {
        p_project_id: projectId,
        p_id_instance: waInstance,
        p_api_token: waToken,
        p_api_url: null,
      });
      const { data, error } = await supabase.functions.invoke("greenapi-proxy", {
        body: { action: "status", projectId },
      });
      if (error) throw error;
      const state = (data as any)?.stateInstance || (data as any)?.state || JSON.stringify(data);
      const ok = String(state).toLowerCase().includes("authorized");
      setWaCheck({ status: ok ? "ok" : "fail", message: `Состояние: ${state}` });
    } catch (e: any) {
      setWaCheck({ status: "fail", message: e?.message ?? String(e) });
    }
  }

  async function setupWebhook() {
    if (!waInstance || !waToken) return toast.error("Заполните Instance ID и API Token");
    setWaWebhook({ status: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke("greenapi-setup", {
        body: {
          idInstance: waInstance,
          apiToken: waToken,
          webhookUrl: WEBHOOK_URL,
        },
      });
      if (error) throw error;
      const ok = (data as any)?.ok;
      if (ok && projectId) {
        // Persist webhook URL so health-check sees it
        await supabase
          .from("whatsapp_config" as any)
          .update({ webhook_url: WEBHOOK_URL })
          .eq("project_id", projectId);
      }
      setWaWebhook({
        status: ok ? "ok" : "fail",
        message: ok ? `Webhook прописан: ${WEBHOOK_URL}` : JSON.stringify((data as any)?.response ?? data),
      });
    } catch (e: any) {
      setWaWebhook({ status: "fail", message: e?.message ?? String(e) });
    }
  }

  async function saveStep5Next() {
    if (!cabinetId) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("ad_cabinets")
        .update({
          landing_url: landingUrl || null,
          website_url: landingUrl || null,
          telegram_group_id: telegramGroupId || null,
          utm_template: utmTemplate,
        })
        .eq("id", cabinetId);
      if (error) throw error;
      setStep(6);
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  // Load pipeline stages when entering step 6
  useEffect(() => {
    if (step !== 6 || !projectId) return;
    (async () => {
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("id")
        .eq("project_id", projectId)
        .eq("is_default", true)
        .maybeSingle();
      if (!pipeline) {
        // Ensure pipeline exists
        const { data: ensured } = await supabase.rpc("ensure_project_pipeline", {
          p_project_id: projectId,
        });
        if (!ensured) return;
      }
      const pipelineId =
        pipeline?.id ||
        (await supabase
          .from("pipelines")
          .select("id")
          .eq("project_id", projectId)
          .eq("is_default", true)
          .maybeSingle()).data?.id;

      const { data: rows } = await supabase
        .from("pipeline_stages")
        .select("id, key, title, order_index")
        .eq("pipeline_id", pipelineId)
        .order("order_index");

      // Default mapping based on stage key
      const defaultMap = (k: string): string => {
        const low = k.toLowerCase();
        if (low.includes("paid") || low.includes("оплач")) return "Purchase";
        if (low.includes("visit") || low.includes("диагност") || low.includes("визит")) return "Diagnostic";
        if (low.includes("schedule") || low.includes("invoice") || low.includes("запис") || low.includes("счёт") || low.includes("счет")) return "Schedule";
        return "";
      };
      setStages(
        (rows ?? []).map((r: any) => ({
          id: r.id,
          key: r.key,
          title: r.title,
          capi_event: defaultMap(r.key),
        })),
      );
    })();
  }, [step, projectId]);

  async function saveStep6Next() {
    setBusy(true);
    try {
      // Try writing to crm_stage_map; if table missing, skip gracefully
      for (const s of stages) {
        if (!s.capi_event) continue;
        const isPaid = s.capi_event === "Purchase";
        const { error } = await supabase
          .from("crm_stage_map" as any)
          .upsert(
            {
              status_key: s.key,
              capi_event: s.capi_event,
              is_paid: isPaid,
              project_id: projectId,
            },
            { onConflict: "status_key" },
          );
        if (error && !/relation .* does not exist/i.test(error.message)) {
          throw error;
        }
      }
      setStep(7);
    } catch (e: any) {
      // Soft-fail: still allow next
      toast.warning("Маппинг CRM не сохранён (таблица недоступна), но это не блокирует онбординг");
      setStep(7);
    } finally {
      setBusy(false);
    }
  }

  async function saveStep7Next() {
    if (!projectId) return;
    setBusy(true);
    try {
      const today = new Date();
      const monthKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
      const payload = {
        project_id: projectId,
        month_key: monthKey,
        spend: Number(monthSpend) || 0,
        leads: Number(monthLeads) || 0,
        cpl: Number(monthCpl) || 0,
        sales: Number(monthSales) || 0,
        revenue: Number(monthRevenue) || 0,
        created_by: user?.id ?? null,
      };
      const { error } = await supabase.from("finance_plans").upsert(payload as any, {
        onConflict: "project_id,month_key",
      });
      if (error && !/duplicate|conflict|on conflict/i.test(error.message)) {
        // try plain insert
        await supabase.from("finance_plans").insert(payload as any);
      }
      setStep(8);
    } catch (e: any) {
      toast.warning("Финплан не сохранён, но это не блокирует онбординг");
      setStep(8);
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    if (!projectId || !cabinetId) return;
    setTestResults({ create: { status: "loading" } });

    // Create run record in ad_sync_runs (best-effort)
    let runId: string | null = null;
    try {
      const { data: run } = await supabase
        .from("ad_sync_runs" as any)
        .insert({
          cabinet_id: cabinetId,
          project_id: projectId,
          kind: "wizard_test",
          status: "running",
          triggered_by: "wizard",
          created_by: user?.id ?? null,
          payload: { source: "onboarding-wizard" },
        })
        .select("id")
        .single();
      runId = (run as any)?.id ?? null;
    } catch { /* ad_sync_runs may not exist on older envs */ }

    const finalizeRun = async (status: "success" | "error", patch: Record<string, unknown>) => {
      if (!runId) return;
      try {
        await supabase
          .from("ad_sync_runs" as any)
          .update({
            status,
            finished_at: new Date().toISOString(),
            payload: patch,
            ...(status === "error" ? { error: String(patch.error ?? "test failed") } : {}),
          })
          .eq("id", runId);
      } catch { /* ignore */ }
    };

    try {
      // 1. Get default stage
      const { data: pipeline } = await supabase
        .from("pipelines").select("id").eq("project_id", projectId).eq("is_default", true).maybeSingle();
      if (!pipeline) throw new Error("Нет пайплайна");
      const { data: firstStage } = await supabase
        .from("pipeline_stages").select("id").eq("pipeline_id", pipeline.id).order("order_index").limit(1).maybeSingle();
      if (!firstStage) throw new Error("Нет стадий");

      const { data: lead, error: leadErr } = await supabase.from("leads").insert({
        name: "TEST onboarding",
        phone: "+700000000" + Math.floor(Math.random() * 1000),
        project_id: projectId,
        pipeline_id: pipeline.id,
        stage_id: firstStage.id,
        cabinet_id: cabinetId,
        is_personal: true,
        source: "onboarding-test",
        created_by: user?.id ?? null,
      }).select("id").single();
      if (leadErr || !lead) throw leadErr ?? new Error("Lead insert failed");

      setTestResults((r) => ({ ...r, create: { status: "ok", message: "Лид создан" }, stages: { status: "loading" } }));

      // 2. Walk through stages
      const { data: allStages } = await supabase
        .from("pipeline_stages").select("id, key, order_index").eq("pipeline_id", pipeline.id).order("order_index");
      for (const s of (allStages ?? []).slice(1)) {
        await supabase.from("leads").update({ stage_id: s.id }).eq("id", lead.id);
        await new Promise((r) => setTimeout(r, 150));
      }
      setTestResults((r) => ({ ...r, stages: { status: "ok", message: "Стадии пройдены" }, capi: { status: "loading" } }));

      // 3. Check capi_outbox (graceful if table missing)
      let capiCount = 0;
      let capiOk = false;
      try {
        const { data: outbox } = await supabase
          .from("capi_outbox" as any).select("status").eq("lead_id", lead.id);
        capiCount = outbox?.length ?? 0;
        capiOk = capiCount > 0;
        setTestResults((r) => ({
          ...r,
          capi: capiOk
            ? { status: "ok", message: `${capiCount} событий в очереди CAPI` }
            : { status: "fail", message: "Нет событий в capi_outbox (миграция CAPI не применена?)" },
        }));
      } catch {
        setTestResults((r) => ({ ...r, capi: { status: "fail", message: "Таблица capi_outbox недоступна" } }));
      }

      // 4. Cleanup
      setTestResults((r) => ({ ...r, cleanup: { status: "loading" } }));
      await supabase.from("leads").delete().eq("id", lead.id);
      setTestResults((r) => ({ ...r, cleanup: { status: "ok", message: "Тестовый лид удалён" } }));

      await finalizeRun("success", {
        lead_id: lead.id,
        stages_walked: (allStages ?? []).length,
        capi_events: capiCount,
        capi_ok: capiOk,
      });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setTestResults((r) => ({ ...r, error: { status: "fail", message: msg } }));
      await finalizeRun("error", { error: msg });
    }
  }

  function finish() {
    toast.success("Проект готов!");
    navigate("/dashboard");
  }

  const canPrev = step > 1 && !busy;

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Новый проект</h1>
        <p className="text-muted-foreground mt-1">
          Пошаговая настройка кабинета. После завершения pipeline атрибуции запустится автоматически.
        </p>
      </div>

      <StepIndicator currentStep={step} />

      <Card className="mt-6 border-border bg-card">
        <CardHeader>
          <div className="flex items-center gap-3">
            {(() => {
              const Icon = STEPS[step - 1].icon;
              return <Icon className="h-5 w-5 text-primary" />;
            })()}
            <div>
              <CardTitle>Шаг {step}: {STEPS[step - 1].title}</CardTitle>
              <CardDescription>
                {step === 1 && "Базовая информация о проекте"}
                {step === 2 && "Подключение Meta Ads API"}
                {step === 3 && "Facebook Page и Instagram аккаунт"}
                {step === 4 && "WhatsApp через GreenAPI (instance + token + автоматический webhook)"}
                {step === 5 && "Лендинг + UTM-шаблон + URL для приёма лидов"}
                {step === 6 && "Какие стадии CRM отправляют какие события в Meta CAPI"}
                {step === 7 && "Целевые показатели на текущий месяц (опционально)"}
                {step === 8 && "Создание тестового лида и проверка pipeline"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {step === 1 && (
            <>
              <Field label="Имя проекта *">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Стоматология Almaty" />
              </Field>
              <Field label="Домен (опц.)">
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.kz" />
              </Field>
              <Field label="Город">
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Алматы" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Валюта">
                  <Select value={currency} onValueChange={(v) => setCurrency(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Часовой пояс">
                  <Select value={timezone} onValueChange={(v) => setTimezone(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="Ad Account ID *" hint="Можно без префикса act_ — добавим автоматически">
                <Input value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} placeholder="act_123456789 или 123456789" />
              </Field>
              <Field label="Meta Access Token *">
                <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAA..." />
                {accessToken && <p className="mt-1 text-xs text-muted-foreground">Будет сохранён зашифровано: {mask(accessToken)}</p>}
              </Field>
              <Field label="Pixel ID">
                <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="1234567890" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Pixel Event">
                  <Select value={pixelEvent} onValueChange={(v) => setPixelEvent(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PIXEL_EVENTS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="CAPI Test Event Code (опц.)">
                  <Input value={capiTestCode} onChange={(e) => setCapiTestCode(e.target.value)} placeholder="TEST12345" />
                </Field>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={checkMeta} disabled={!adAccountId || !accessToken || metaCheck.status === "loading"}>
                  {metaCheck.status === "loading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Проверить токен
                </Button>
                <CheckBadge state={metaCheck} />
              </div>
              {metaCheck.message && (
                <Alert variant={metaCheck.status === "ok" ? "default" : "destructive"}>
                  <AlertDescription className="text-xs">{metaCheck.message}</AlertDescription>
                </Alert>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <Field label="Facebook Page ID">
                <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="1234567890" />
              </Field>
              <Field label="Имя страницы">
                <Input value={pageName} onChange={(e) => setPageName(e.target.value)} placeholder="My Page" />
              </Field>
              <Field label="Instagram User ID">
                <Input value={instagramId} onChange={(e) => setInstagramId(e.target.value)} placeholder="17841400000000000" />
              </Field>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Эти поля можно оставить пустыми и заполнить позже в настройках кабинета.
                </AlertDescription>
              </Alert>
            </>
          )}

          {step === 4 && (
            <>
              <Field label="GreenAPI Instance ID *">
                <Input value={waInstance} onChange={(e) => setWaInstance(e.target.value)} placeholder="1101000000" />
              </Field>
              <Field label="GreenAPI API Token *">
                <Input type="password" value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder="..." />
                {waToken && <p className="mt-1 text-xs text-muted-foreground">{mask(waToken)}</p>}
              </Field>
              <Field label="WhatsApp номер (для CTA на сайте)">
                <Input value={waNumber} onChange={(e) => setWaNumber(e.target.value)} placeholder="+77001234567" />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={checkWhatsApp} disabled={!waInstance || !waToken || waCheck.status === "loading"}>
                  {waCheck.status === "loading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Проверить подключение
                </Button>
                <CheckBadge state={waCheck} />
              </div>
              {waCheck.message && (
                <p className="text-xs text-muted-foreground">{waCheck.message}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button variant="outline" onClick={setupWebhook} disabled={!waInstance || !waToken || waWebhook.status === "loading"}>
                  {waWebhook.status === "loading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Настроить webhook автоматически
                </Button>
                <CheckBadge state={waWebhook} />
              </div>
              {waWebhook.message && (
                <Alert variant={waWebhook.status === "ok" ? "default" : "destructive"}>
                  <AlertDescription className="text-xs">{waWebhook.message}</AlertDescription>
                </Alert>
              )}
              <p className="text-xs text-muted-foreground">
                Webhook URL который пропишется в GreenAPI: <code className="rounded bg-muted px-1">{WEBHOOK_URL}</code>
              </p>
            </>
          )}

          {step === 5 && (
            <>
              <Field label="Landing URL">
                <Input value={landingUrl} onChange={(e) => setLandingUrl(e.target.value)} placeholder="https://example.kz" />
              </Field>
              <Field label="Telegram Group ID (для уведомлений)">
                <Input value={telegramGroupId} onChange={(e) => setTelegramGroupId(e.target.value)} placeholder="-1001234567890" />
              </Field>
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <Label className="text-xs font-medium uppercase text-muted-foreground">UTM-шаблон для Meta Ads Manager</Label>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 overflow-auto rounded bg-background px-3 py-2 text-xs">{utmTemplate}</code>
                  <Button size="icon" variant="ghost" onClick={() => copy(utmTemplate)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Вставьте в Meta Ads Manager → Ad Setup → URL Parameters
                </p>
              </div>
              {intakeUrl && (
                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <Label className="text-xs font-medium uppercase text-muted-foreground">URL для приёма лидов (Tilda, custom forms)</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 overflow-auto rounded bg-background px-3 py-2 text-xs">{intakeUrl}</code>
                    <Button size="icon" variant="ghost" onClick={() => copy(intakeUrl)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    POST с полями name, phone, email, message, utm_*
                  </p>
                </div>
              )}
            </>
          )}

          {step === 6 && (
            <>
              <p className="text-sm text-muted-foreground">
                Выберите, какое CAPI-событие отправлять в Meta при переходе лида на каждую стадию.
                По умолчанию мы автоматически определили часть стадий.
              </p>
              <div className="space-y-2">
                {stages.length === 0 && (
                  <p className="text-sm text-muted-foreground">Загружаем стадии…</p>
                )}
                {stages.map((s, idx) => (
                  <div key={s.id} className="grid grid-cols-[1fr_180px] items-center gap-3 rounded-md border border-border bg-background p-3">
                    <div>
                      <div className="text-sm font-medium">{s.title}</div>
                      <div className="text-xs text-muted-foreground">{s.key}</div>
                    </div>
                    <Select
                      value={s.capi_event || "none"}
                      onValueChange={(v) => {
                        const next = [...stages];
                        next[idx] = { ...next[idx], capi_event: v === "none" ? "" : v };
                        setStages(next);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— (не отправлять)</SelectItem>
                        <SelectItem value="Schedule">Schedule</SelectItem>
                        <SelectItem value="Diagnostic">Diagnostic</SelectItem>
                        <SelectItem value="Purchase">Purchase</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 7 && (
            <>
              <p className="text-sm text-muted-foreground">
                План на текущий месяц. Можно пропустить — заполните позже в разделе «Финансы».
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Бюджет (spend)">
                  <Input type="number" value={monthSpend} onChange={(e) => setMonthSpend(e.target.value)} />
                </Field>
                <Field label="Лидов">
                  <Input type="number" value={monthLeads} onChange={(e) => setMonthLeads(e.target.value)} />
                </Field>
                <Field label="CPL">
                  <Input type="number" value={monthCpl} onChange={(e) => setMonthCpl(e.target.value)} />
                </Field>
                <Field label="Продаж">
                  <Input type="number" value={monthSales} onChange={(e) => setMonthSales(e.target.value)} />
                </Field>
                <Field label="Выручка">
                  <Input type="number" value={monthRevenue} onChange={(e) => setMonthRevenue(e.target.value)} />
                </Field>
              </div>
            </>
          )}

          {step === 8 && (
            <>
              <Alert>
                <FlaskConical className="h-4 w-4" />
                <AlertTitle>Тестовый прогон</AlertTitle>
                <AlertDescription>
                  Создаст тестового лида, прокатит его по всем стадиям, проверит CAPI-очередь и удалит. Длится ~10 секунд.
                </AlertDescription>
              </Alert>
              <Button onClick={runTest} disabled={Object.values(testResults).some((v) => v.status === "loading")}>
                Запустить тест
              </Button>
              <div className="space-y-2">
                {[
                  ["create", "Создание лида"],
                  ["stages", "Прогон по стадиям"],
                  ["capi", "Очередь CAPI"],
                  ["cleanup", "Удаление тестовых данных"],
                ].map(([key, label]) => {
                  const r = testResults[key];
                  if (!r) return null;
                  return (
                    <div key={key} className="flex items-center justify-between rounded-md border border-border bg-background p-3">
                      <div>
                        <div className="text-sm font-medium">{label}</div>
                        {r.message && <div className="text-xs text-muted-foreground">{r.message}</div>}
                      </div>
                      <CheckBadge state={r} />
                    </div>
                  );
                })}
                {testResults.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{testResults.error.message}</AlertDescription>
                  </Alert>
                )}
              </div>

              {cabinetId && <HealthCheckPanel cabinetId={cabinetId} className="mt-2" />}
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={!canPrev}>
          <ChevronLeft className="mr-2 h-4 w-4" /> Назад
        </Button>
        <div className="flex items-center gap-2">
          {step < 8 ? (
            <Button
              onClick={() => {
                if (step === 1) saveStep1Next();
                else if (step === 2) saveStep2Next();
                else if (step === 3) saveStep3Next();
                else if (step === 4) saveStep4Next();
                else if (step === 5) saveStep5Next();
                else if (step === 6) saveStep6Next();
                else if (step === 7) saveStep7Next();
              }}
              disabled={busy}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Далее <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={finish}>
              <Check className="mr-2 h-4 w-4" /> Готово
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-sm">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CheckBadge({ state }: { state: CheckState }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <Badge variant="secondary">Проверка…</Badge>;
  if (state.status === "ok")
    return (
      <Badge className="bg-success/15 text-success border-success/30">
        <CheckCircle2 className="mr-1 h-3 w-3" /> OK
      </Badge>
    );
  return (
    <Badge variant="destructive">
      <XCircle className="mr-1 h-3 w-3" /> Ошибка
    </Badge>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {STEPS.map((s, idx) => {
        const Icon = s.icon;
        const done = s.id < currentStep;
        const active = s.id === currentStep;
        return (
          <div key={s.id} className="flex items-center">
            <div
              className={cn(
                "flex flex-col items-center gap-1 rounded-md px-2 py-1 text-xs min-w-[88px]",
                active && "bg-primary/10 text-primary",
                done && "text-success",
                !active && !done && "text-muted-foreground",
              )}
            >
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-success bg-success/10",
                !active && !done && "border-border",
              )}>
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </div>
              <span className="text-[10px] leading-tight text-center">{s.title}</span>
            </div>
            {idx < STEPS.length - 1 && <div className="h-px w-3 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
