import { useState } from "react";
import { Loader2, Check, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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

export function ProjectOnboardingDialog({ open, onOpenChange }: Props) {
  const { addProject, setActive } = useProjectsStore();
  const { user } = useAuth();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Step 1
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [city, setCity] = useState("");

  // Step 2 — brief
  const [niche, setNiche] = useState("");
  const [audience, setAudience] = useState("");
  const [product, setProduct] = useState("");
  const [usp, setUsp] = useState("");
  const [geo, setGeo] = useState("");
  const [tone, setTone] = useState("дружелюбный, экспертный");
  const [monthlyBudget, setMonthlyBudget] = useState("");

  // Step 3 — cabinet (optional)
  const [skipCabinet, setSkipCabinet] = useState(false);
  const [cabName, setCabName] = useState("");
  const [cabType, setCabType] = useState("Личный");
  const [adAccountId, setAdAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [pixelEvent, setPixelEvent] = useState("Lead");

  // Step 4 — AI result
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [briefMd, setBriefMd] = useState<string>("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [aiError, setAiError] = useState<string | null>(null);

  const reset = () => {
    setStep(1); setBusy(false);
    setName(""); setDomain(""); setCity("");
    setNiche(""); setAudience(""); setProduct(""); setUsp(""); setGeo(""); setTone("дружелюбный, экспертный"); setMonthlyBudget("");
    setSkipCabinet(false); setCabName(""); setCabType("Личный");
    setAdAccountId(""); setPageId(""); setPixelId(""); setInstagramId(""); setAccessToken(""); setWhatsappNumber(""); setPixelEvent("Lead");
    setCreatedProjectId(null); setBriefMd(""); setVariants([]); setSelectedVariant(0); setAiError(null);
  };

  const close = () => { onOpenChange(false); setTimeout(reset, 200); };

  // ======== actions ========
  const goStep2 = async () => {
    if (!name.trim()) { toast.error("Введите название проекта"); return; }
    setStep(2);
  };

  const goStep3 = () => setStep(3);

  const finalize = async (skipCab: boolean) => {
    setBusy(true);
    try {
      // 1) Create project
      const project = await addProject(name, domain || undefined);
      setCreatedProjectId(project.id);

      // 2) Insert brief row (admin policy required — handled by RLS)
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
      };
      const { error: briefErr } = await supabase.from("project_briefs").insert(briefPayload as any);
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
        const { error: cabErr } = await supabase.from("ad_cabinets").insert(cabRow as any);
        if (cabErr) toast.error("Кабинет не сохранён: " + cabErr.message);
      }

      // 4) Switch active project
      await setActive(project.id);

      // 5) Generate AI brief — go to step 4 with loader
      setStep(4);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
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
          },
        });
        clearTimeout(timer);
        if (error) throw error;
        if (data?.brief_md) setBriefMd(data.brief_md);
        if (Array.isArray(data?.variants)) setVariants(data.variants);
      } catch (e: any) {
        clearTimeout(timer);
        console.error(e);
        setAiError(e?.message || "Не удалось сгенерировать бриф");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Не удалось создать проект");
    } finally {
      setBusy(false);
    }
  };

  const saveSelectedVariant = async () => {
    if (!createdProjectId || !variants[selectedVariant]) { close(); return; }
    const v = variants[selectedVariant];
    await supabase.from("project_briefs").update({
      ai_primary_text: v.primary_text,
      ai_headline: v.headline,
      ai_cta: v.cta,
    }).eq("project_id", createdProjectId);
    toast.success("Проект готов");
    close();
  };

  // ======== UI ========
  const totalSteps = 4;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) (v ? onOpenChange(true) : close()); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-success" />
            {step === 1 && "Новый проект"}
            {step === 2 && "Бриф проекта"}
            {step === 3 && "Рекламный кабинет"}
            {step === 4 && "Готово"}
          </DialogTitle>
        </DialogHeader>

        {/* Progress */}
        <div className="flex items-center gap-2 pb-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i + 1 <= step ? "bg-success" : "bg-secondary",
              )}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Название проекта *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Стоматология AURA" />
            </div>
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
              <Label>Продукт / услуга</Label>
              <Textarea rows={2} value={product} onChange={(e) => setProduct(e.target.value)}
                placeholder="Имплантация, виниры, отбеливание под ключ" />
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Тон коммуникации</Label>
                <Input value={tone} onChange={(e) => setTone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Бюджет / мес</Label>
                <Input type="number" value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} placeholder="500000" />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
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

        {step === 4 && (
          <div className="space-y-4">
            {busy || (!briefMd && !aiError) ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-success" />
                <div className="text-sm text-muted-foreground">AI пишет бриф проекта и варианты рекламы…</div>
              </div>
            ) : aiError ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                  Не удалось сгенерировать бриф: {aiError}
                </div>
                <p className="text-sm text-muted-foreground">
                  Проект создан. Бриф можно сгенерировать позже в настройках.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Бриф</div>
                  <div className="max-h-40 overflow-auto rounded-lg border border-border/60 bg-card/40 p-3 text-sm whitespace-pre-wrap">
                    {briefMd}
                  </div>
                </div>
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
                              active ? "border-success bg-success/10" : "border-border/60 hover:bg-secondary/60"
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
          {step > 1 && step < 4 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Назад
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            {(step === 2 || step === 3) && (
              <Button
                variant="ghost"
                onClick={() => step === 2 ? setStep(3) : finalize(true)}
                disabled={busy}
              >
                Пропустить
              </Button>
            )}
            {step === 1 && <Button onClick={goStep2}>Далее <ChevronRight className="ml-1 h-4 w-4" /></Button>}
            {step === 2 && <Button onClick={goStep3}>Далее <ChevronRight className="ml-1 h-4 w-4" /></Button>}
            {step === 3 && (
              <Button onClick={() => finalize(false)} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Создать проект
              </Button>
            )}
            {step === 4 && (
              <Button onClick={saveSelectedVariant} disabled={busy}>
                Перейти в проект
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}