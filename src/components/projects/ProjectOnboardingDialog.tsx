import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Check, ChevronLeft, ChevronRight, Sparkles, ExternalLink, SlidersHorizontal, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Variant = { primary_text: string; headline: string; cta: string };
interface Segment {
  code: string;
  name: string;
  radical_psychotype: string;
  index_score: number;
  class: "A" | "B" | "C" | "D";
  offer: string;
}
interface ProductMatrix {
  lead_magnet: string;
  entry: string;
  main: string;
  vip: string;
}

const PRODUCT_TYPES = [
  "B2C импульс",
  "B2C обдуманная",
  "B2C luxury",
  "B2B",
  "Подписка",
] as const;

const CHANNELS = ["Instagram", "TikTok", "Google", "Яндекс", "2GIS", "VK", "Telegram", "YouTube"] as const;
const PRICE_MODELS = ["разово", "подписка", "за лид", "пакет/тариф"] as const;
const RESEARCH_DEPTHS = ["быстрый", "глубокий"] as const;

const TOTAL_STEPS = 5;

export function ProjectOnboardingDialog({ open, onOpenChange }: Props) {
  const { addProject, setActive } = useProjectsStore();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [fullSetup, setFullSetup] = useState(false);

  // Step 1 — basics
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [city, setCity] = useState("");

  // Step 2 — product brief
  const [niche, setNiche] = useState("");
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [usp, setUsp] = useState("");
  const [geo, setGeo] = useState("");
  const [tone, setTone] = useState("дружелюбный, экспертный");
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const [priceModel, setPriceModel] = useState<typeof PRICE_MODELS[number]>("разово");
  const [productType, setProductType] = useState<typeof PRODUCT_TYPES[number]>("B2C обдуманная");

  // Step 3 — market
  const [currentClients, setCurrentClients] = useState("");
  const [channels, setChannels] = useState<string[]>(["Instagram"]);
  const [directCompetitors, setDirectCompetitors] = useState("");
  const [indirectCompetitors, setIndirectCompetitors] = useState("");
  const [differentiator, setDifferentiator] = useState("");
  const [painsRaw, setPainsRaw] = useState("");
  const [researchDepth, setResearchDepth] = useState<typeof RESEARCH_DEPTHS[number]>("быстрый");

  // Step 4 — cabinet (optional)
  const [cabName, setCabName] = useState("");
  const [cabType, setCabType] = useState("Личный");
  const [adAccountId, setAdAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [pixelEvent, setPixelEvent] = useState("Lead");

  // Step 5 — AI result
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [briefMd, setBriefMd] = useState<string>("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [productMatrix, setProductMatrix] = useState<ProductMatrix | null>(null);
  const [recommendedScenario, setRecommendedScenario] = useState<string>("");
  const [resolvedProductType, setResolvedProductType] = useState<string>("");
  const [aiError, setAiError] = useState<string | null>(null);

  const reset = () => {
    setStep(1); setBusy(false); setFullSetup(false);
    setName(""); setDomain(""); setCity("");
    setNiche(""); setProduct(""); setAudience(""); setUsp(""); setGeo("");
    setTone("дружелюбный, экспертный"); setMonthlyBudget("");
    setPriceModel("разово"); setProductType("B2C обдуманная");
    setCurrentClients(""); setChannels(["Instagram"]);
    setDirectCompetitors(""); setIndirectCompetitors(""); setDifferentiator("");
    setPainsRaw(""); setResearchDepth("быстрый");
    setCabName(""); setCabType("Личный");
    setAdAccountId(""); setPageId(""); setPixelId(""); setInstagramId("");
    setAccessToken(""); setWhatsappNumber(""); setPixelEvent("Lead");
    setCreatedProjectId(null); setBriefMd(""); setVariants([]); setSelectedVariant(0);
    setSegments([]); setProductMatrix(null); setRecommendedScenario(""); setResolvedProductType("");
    setAiError(null);
  };

  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  const toggleChannel = (c: string) => {
    setChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const quickCreate = async () => {
    if (!name.trim()) {
      toast.error("Введите название проекта");
      return;
    }
    setBusy(true);
    try {
      const project = await addProject(name);
      await setActive(project.id);
      toast.success(`Проект «${project.name}» создан`);
      close();
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Не удалось создать проект";
      toast.error("Не удалось создать проект", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const finalize = async (skipCab: boolean) => {
    if (!name.trim()) { toast.error("Введите название проекта"); setStep(1); return; }
    setBusy(true);
    try {
      // 1) Create project
      const project = await addProject(name, domain || undefined);
      setCreatedProjectId(project.id);

      // 2) Insert brief row (admin RLS handled server-side via service role on edge fn update)
      const briefPayload = {
        project_id: project.id,
        niche: niche || null,
        audience: audience || null,
        product: product || null,
        usp: usp || null,
        geo: geo || city || null,
        tone: tone || null,
        monthly_budget: monthlyBudget ? Number(monthlyBudget) : 0,
        created_by: user?.id ?? null,
        product_type: productType,
        research_depth: researchDepth,
        price_model: priceModel,
        current_clients: currentClients || null,
        channels,
        direct_competitors: directCompetitors || null,
        indirect_competitors: indirectCompetitors || null,
        differentiator: differentiator || null,
        pains_raw: painsRaw || null,
      };
      const { error: briefErr } = await supabase.from("project_briefs").insert(briefPayload as never);
      if (briefErr) console.warn("brief insert err", briefErr);

      // 3) Insert cabinet (optional)
      if (!skipCab && (cabName.trim() || adAccountId.trim())) {
        const cabRow: Record<string, unknown> = {
          project_id: project.id,
          created_by: user?.id ?? null,
          name: cabName.trim() || name.trim(),
          type: cabType,
          external_id: adAccountId.trim() || "",
          ad_account_id: adAccountId.trim() || null,
          page_id: pageId.trim() || null,
          pixel_id: pixelId.trim() || null,
          instagram_id: instagramId.trim() || null,
          access_token: accessToken.trim() || null,
          whatsapp_number: whatsappNumber.trim() || null,
          website_url: domain.trim() || null,
          pixel_event: pixelEvent || "Lead",
          city: city.trim() || null,
          online: true,
        };
        const { data: cabData, error: cabErr } = await supabase
          .from("ad_cabinets")
          .insert(cabRow as never)
          .select("*")
          .single();
        if (cabErr) {
          toast.error("Кабинет не сохранён: " + cabErr.message);
        } else if (cabData) {
          // Зеркалим в client config supabase для n8n + content factory.
          const { syncCabinetToClientConfig } = await import(
            "@/lib/cabinetSync"
          );
          const r = cabData as Record<string, unknown>;
          await syncCabinetToClientConfig({
            id: r.id as string,
            name: (r.name as string) ?? "",
            externalId: (r.external_id as string) ?? "",
            online: !!r.online,
            type: r.type as "Личный" | "Агентский",
            spend: 0, leads: 0, leadCost: 0, sales: 0, revenue: 0,
            city: (r.city as string) ?? undefined,
            dailyBudget: (r.daily_budget as number) ?? 0,
            currency: (r.currency as string) ?? "KZT",
            adAccountId: (r.ad_account_id as string) ?? undefined,
            pageId: (r.page_id as string) ?? undefined,
            pageName: (r.page_name as string) ?? undefined,
            instagramId: (r.instagram_id as string) ?? undefined,
            telegramGroupId: (r.telegram_group_id as string) ?? undefined,
            whatsappNumber: (r.whatsapp_number as string) ?? undefined,
            pixelId: (r.pixel_id as string) ?? undefined,
            pixelEvent: (r.pixel_event as string) ?? "Lead",
            websiteUrl: (r.website_url as string) ?? undefined,
            brief: (r.brief as string) ?? undefined,
            accessToken: (r.access_token as string) ?? undefined,
          } as unknown as Parameters<typeof syncCabinetToClientConfig>[0]);
        }
      }

      // 4) Switch active project
      await setActive(project.id);

      // 5) Generate AI strategy — go to step 5 with loader
      setStep(5);
      try {
        const { data, error } = await supabase.functions.invoke("generate-project-brief", {
          body: {
            projectId: project.id,
            niche, audience, product, usp,
            geo: geo || city,
            tone,
            city,
            websiteUrl: domain,
            monthlyBudget: monthlyBudget ? Number(monthlyBudget) : undefined,
            productType,
            researchDepth,
            priceModel,
            currentClients,
            channels,
            directCompetitors,
            indirectCompetitors,
            differentiator,
            painsRaw,
          },
        });
        if (error) throw error;
        if (data?.brief_md) setBriefMd(data.brief_md);
        if (Array.isArray(data?.variants)) setVariants(data.variants);
        if (Array.isArray(data?.segments)) setSegments(data.segments);
        if (data?.product_matrix) setProductMatrix(data.product_matrix);
        if (data?.recommended_scenario) setRecommendedScenario(data.recommended_scenario);
        if (data?.product_type) setResolvedProductType(data.product_type);
      } catch (e: unknown) {
        console.error(e);
        const msg = e instanceof Error ? e.message : "Не удалось сгенерировать стратегию";
        setAiError(msg);
      }
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Не удалось создать проект";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const saveSelectedVariantAndOpen = async (target: "project" | "strategy") => {
    if (!createdProjectId) { close(); return; }
    if (variants[selectedVariant]) {
      const v = variants[selectedVariant];
      await supabase.from("project_briefs").update({
        ai_primary_text: v.primary_text,
        ai_headline: v.headline,
        ai_cta: v.cta,
      } as never).eq("project_id", createdProjectId);
    }
    toast.success("Стратегия проекта готова");
    const nextRoute = target === "strategy"
      ? `/projects/${createdProjectId}/strategy`
      : `/`;
    close();
    navigate(nextRoute);
  };

  const topSegments = segments
    .filter((s) => s.class === "A" || s.class === "B")
    .sort((a, b) => b.index_score - a.index_score)
    .slice(0, 4);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (v) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className={cn("max-w-lg", fullSetup && "max-w-3xl")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-success" />
            {step === 1 && "Новый проект"}
            {step === 2 && "Бриф проекта"}
            {step === 3 && "Рынок и сегменты"}
            {step === 4 && "Рекламный кабинет"}
            {step === 5 && "Стратегия Marketing OS"}
          </DialogTitle>
        </DialogHeader>

        {/* Progress */}
        {fullSetup && (
        <div className="flex items-center gap-2 pb-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i + 1 <= step ? "bg-success" : "bg-secondary",
              )}
            />
          ))}
        </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-success/25 bg-success/10 p-4">
              <div className="mb-3 flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-success/15 text-success">
                  <Plus className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-semibold">Быстрое создание проекта</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Достаточно названия. Рекламный кабинет, сайт, бриф и стратегию можно заполнить позже в настройках проекта.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Название проекта *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !fullSetup) void quickCreate();
                  }}
                  placeholder="Например: Мир без границ"
                  autoFocus
                />
              </div>
            </div>

            {!fullSetup ? (
              <button
                type="button"
                onClick={() => setFullSetup(true)}
                className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-card/50 p-4 text-left transition-colors hover:bg-card"
              >
                <span className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <SlidersHorizontal className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">Полная настройка</span>
                    <span className="block text-sm text-muted-foreground">
                      Бриф, рынок, кабинет и AI-стратегия сразу при создании.
                    </span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Сайт / лендинг</Label>
                  <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="https://aura.kz" />
                </div>
                <div className="space-y-1.5">
                  <Label>Город</Label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Алматы" />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ниша</Label>
                <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Стоматология" />
              </div>
              <div className="space-y-1.5">
                <Label>Гео</Label>
                <Input value={geo} onChange={(e) => setGeo(e.target.value)} placeholder="Алматы, Астана" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Продукт / услуга — одним предложением</Label>
              <Textarea rows={2} value={product} onChange={(e) => setProduct(e.target.value)}
                placeholder="Имплантация под ключ за 1 день, гарантия 5 лет" />
            </div>
            <div className="space-y-1.5">
              <Label>Целевая аудитория</Label>
              <Textarea rows={2} value={audience} onChange={(e) => setAudience(e.target.value)}
                placeholder="Женщины 25-45, доход средний+, важна эстетика" />
            </div>
            <div className="space-y-1.5">
              <Label>УТП / отстройка</Label>
              <Textarea rows={2} value={usp} onChange={(e) => setUsp(e.target.value)}
                placeholder="Гарантия 5 лет, рассрочка 0%, первый приём бесплатно" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Бюджет / мес (₸)</Label>
                <Input type="number" value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} placeholder="500000" />
              </div>
              <div className="space-y-1.5">
                <Label>Модель оплаты</Label>
                <Select value={priceModel} onValueChange={(v) => setPriceModel(v as typeof PRICE_MODELS[number])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRICE_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Тон коммуникации</Label>
                <Input value={tone} onChange={(e) => setTone(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Тип продукта (определяет веса для индекса сегментов)</Label>
              <Select value={productType} onValueChange={(v) => setProductType(v as typeof PRODUCT_TYPES[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Текущие клиенты — опиши 2-3 реальных (опционально)</Label>
              <Textarea rows={3} value={currentClients} onChange={(e) => setCurrentClients(e.target.value)}
                placeholder="Айгерим, 32, мама двух детей, выбрала за рассрочку и удобный график..." />
            </div>
            <div className="space-y-1.5">
              <Label>Каналы размещения</Label>
              <div className="flex flex-wrap gap-2 rounded-lg border border-border/60 bg-card/40 p-2">
                {CHANNELS.map((c) => (
                  <label key={c} className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 hover:bg-secondary/60">
                    <Checkbox
                      checked={channels.includes(c)}
                      onCheckedChange={() => toggleChannel(c)}
                    />
                    <span className="text-sm">{c}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Прямые конкуренты (опционально)</Label>
                <Textarea rows={2} value={directCompetitors} onChange={(e) => setDirectCompetitors(e.target.value)}
                  placeholder="@aura_dental, @denta_lux..." />
              </div>
              <div className="space-y-1.5">
                <Label>Косвенные конкуренты</Label>
                <Textarea rows={2} value={indirectCompetitors} onChange={(e) => setIndirectCompetitors(e.target.value)}
                  placeholder="Клиники общей стоматологии, виниры через ортодонтов..." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Чем отличаешься от рынка</Label>
              <Textarea rows={2} value={differentiator} onChange={(e) => setDifferentiator(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Боли клиентов — конкретные фразы если слышал</Label>
              <Textarea rows={2} value={painsRaw} onChange={(e) => setPainsRaw(e.target.value)}
                placeholder="«Боюсь что криво поставят» «Долго не могу решиться»..." />
            </div>
            <div className="space-y-1.5">
              <Label>Глубина анализа стратегии</Label>
              <Select value={researchDepth} onValueChange={(v) => setResearchDepth(v as typeof RESEARCH_DEPTHS[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESEARCH_DEPTHS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Подключите рекламный кабинет сейчас или пропустите — добавите позже в разделе «Реклама».
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Название кабинета</Label>
                <Input value={cabName} onChange={(e) => setCabName(e.target.value)} placeholder="Основной" />
              </div>
              <div className="space-y-1.5">
                <Label>Тип</Label>
                <Select value={cabType} onValueChange={setCabType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Личный">Личный</SelectItem>
                    <SelectItem value="Бизнес">Бизнес</SelectItem>
                    <SelectItem value="Агентский">Агентский</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ad Account ID</Label>
                <Input value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} placeholder="act_123..." />
              </div>
              <div className="space-y-1.5">
                <Label>Page ID</Label>
                <Input value={pageId} onChange={(e) => setPageId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Pixel ID</Label>
                <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Событие пикселя</Label>
                <Input value={pixelEvent} onChange={(e) => setPixelEvent(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Instagram ID</Label>
                <Input value={instagramId} onChange={(e) => setInstagramId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp</Label>
                <Input value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="+7..." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Access Token</Label>
              <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAA..." />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            {busy || (!briefMd && !aiError) ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-success" />
                <div className="text-sm text-muted-foreground">
                  Marketing OS строит стратегию: сегменты, продуктовая матрица, сценарии запуска и креативы…
                </div>
              </div>
            ) : aiError ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                  Не удалось сгенерировать стратегию: {aiError}
                </div>
                <p className="text-sm text-muted-foreground">
                  Проект создан. Стратегию можно перегенерировать на вкладке «Стратегия» внутри проекта.
                </p>
              </div>
            ) : (
              <>
                {(resolvedProductType || recommendedScenario) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Тип продукта</div>
                      <div className="text-sm font-semibold">{resolvedProductType || "—"}</div>
                    </div>
                    <div className="rounded-lg border border-success/30 bg-success/10 p-3">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Рекомендованный сценарий</div>
                      <div className="text-sm font-semibold">{recommendedScenario || "—"}</div>
                    </div>
                  </div>
                )}

                {topSegments.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                      Топ-сегменты
                    </div>
                    <div className="space-y-1.5">
                      {topSegments.map((s) => (
                        <div key={s.code} className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-2.5">
                          <div className={cn(
                            "rounded-md px-2 py-0.5 text-xs font-bold",
                            s.class === "A" ? "bg-success/20 text-success" : "bg-warning/20 text-warning",
                          )}>
                            {s.class}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold truncate">{s.code} · {s.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{s.radical_psychotype} · {s.offer}</div>
                          </div>
                          <div className="text-sm font-mono tabular-nums">{Math.round(s.index_score)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {productMatrix && (
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Продуктовая матрица</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-md border border-border/60 bg-card/40 p-2">
                        <div className="text-xs text-muted-foreground">Лид-магнит</div>
                        <div>{productMatrix.lead_magnet}</div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-card/40 p-2">
                        <div className="text-xs text-muted-foreground">Входной</div>
                        <div>{productMatrix.entry}</div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-card/40 p-2">
                        <div className="text-xs text-muted-foreground">Основной</div>
                        <div>{productMatrix.main}</div>
                      </div>
                      <div className="rounded-md border border-border/60 bg-card/40 p-2">
                        <div className="text-xs text-muted-foreground">VIP</div>
                        <div>{productMatrix.vip}</div>
                      </div>
                    </div>
                  </div>
                )}

                {variants.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                      Выберите основной вариант рекламы
                    </div>
                    <div className="space-y-2">
                      {variants.map((v, i) => {
                        const active = i === selectedVariant;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setSelectedVariant(i)}
                            className={cn(
                              "w-full rounded-lg border p-3 text-left transition-colors",
                              active ? "border-success bg-success/10" : "border-border/60 hover:bg-secondary/60",
                            )}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold">{v.headline}</div>
                              {active && <Check className="h-4 w-4 text-success" />}
                            </div>
                            <div className="text-sm text-muted-foreground">{v.primary_text}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-wider text-success">CTA: {v.cta}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-2">
          {step > 1 && step < 5 ? (
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={busy}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Назад
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            {(step === 2 || step === 3 || step === 4) && (
              <Button
                variant="ghost"
                onClick={() => step === 4 ? finalize(true) : setStep((s) => s + 1)}
                disabled={busy}
              >
                Пропустить
              </Button>
            )}
            {step === 1 && (
              fullSetup ? (
                <Button onClick={() => { if (!name.trim()) { toast.error("Введите название проекта"); return; } setStep(2); }}>
                  Далее <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => void quickCreate()} disabled={busy}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  Создать проект
                </Button>
              )
            )}
            {step === 2 && <Button onClick={() => setStep(3)}>Далее <ChevronRight className="ml-1 h-4 w-4" /></Button>}
            {step === 3 && <Button onClick={() => setStep(4)}>Далее <ChevronRight className="ml-1 h-4 w-4" /></Button>}
            {step === 4 && (
              <Button onClick={() => finalize(false)} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Создать проект и стратегию
              </Button>
            )}
            {step === 5 && !busy && (briefMd || aiError) && (
              <>
                <Button variant="ghost" onClick={() => saveSelectedVariantAndOpen("project")} disabled={busy}>
                  В проект
                </Button>
                <Button onClick={() => saveSelectedVariantAndOpen("strategy")} disabled={busy}>
                  Открыть стратегию <ExternalLink className="ml-1 h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
