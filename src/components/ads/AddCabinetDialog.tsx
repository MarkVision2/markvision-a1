import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Crosshair,
  Facebook,
  Globe,
  Info,
  Link2,
  Loader2,
  MessageSquare,
  Send,
  Shield,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DEFAULT_META_UTM_TEMPLATE } from "@/lib/utmDefaults";
import type { AdCabinet } from "@/types/ads";
import type { AvailableMetaAdAccount } from "@/hooks/useMetaAdAccounts";
import { useMetaPageAssets } from "@/hooks/useMetaPageAssets";
import { AddCabinetPickStep } from "@/components/ads/AddCabinetPickStep";

interface AddCabinetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (cabinet: AdCabinet) => void;
  existingActIds?: string[];
  /** pick = список Meta; configure = ручной ввод */
  initialStep?: Step;
}

type CheckItem = { ok: boolean; label: string; detail?: string };
type Step = "pick" | "configure";

const FieldLabel = ({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) => (
  <Label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
    {Icon && <Icon className="h-3.5 w-3.5" />}
    {children}
  </Label>
);

const SectionTitle = ({
  accent,
  children,
}: {
  accent: string;
  children: React.ReactNode;
}) => (
  <div className="mb-3 flex items-center gap-2">
    <span className={cn("h-2 w-2 rounded-full", accent)} />
    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  </div>
);

const AddCabinetDialog = ({
  open,
  onOpenChange,
  onCreate,
  existingActIds = [],
  initialStep = "pick",
}: AddCabinetDialogProps) => {
  const [step, setStep] = useState<Step>(initialStep);
  const [selectedMeta, setSelectedMeta] = useState<AvailableMetaAdAccount | null>(null);
  const [currency, setCurrency] = useState("KZT");

  const [name, setName] = useState("");
  const [type, setType] = useState<"Личный" | "Агентский">("Личный");
  const [dailyBudget, setDailyBudget] = useState("50000");
  const [city, setCity] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [telegramGroupId, setTelegramGroupId] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [pixelEvent, setPixelEvent] = useState("Lead");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [utmTemplate, setUtmTemplate] = useState(DEFAULT_META_UTM_TEMPLATE);
  const [brief, setBrief] = useState("");
  const [validating, setValidating] = useState(false);
  const [checks, setChecks] = useState<CheckItem[] | null>(null);

  const pagesAssets = useMetaPageAssets({
    kind: "pages",
    actId: adAccountId,
    enabled: step === "configure" && !!adAccountId,
  });
  const pixelsAssets = useMetaPageAssets({
    kind: "pixels",
    actId: adAccountId,
    enabled: step === "configure" && !!adAccountId,
  });
  const igAssets = useMetaPageAssets({
    kind: "instagram",
    pageId: pageId || undefined,
    enabled: step === "configure" && !!pageId,
  });

  const reset = useCallback(() => {
    setSelectedMeta(null);
    setCurrency("KZT");
    setName("");
    setType("Личный");
    setDailyBudget("50000");
    setCity("");
    setAdAccountId("");
    setPageId("");
    setPageName("");
    setInstagramId("");
    setAccessToken("");
    setTelegramGroupId("");
    setWhatsappNumber("");
    setPixelId("");
    setPixelEvent("Lead");
    setWebsiteUrl("");
    setUtmTemplate(DEFAULT_META_UTM_TEMPLATE);
    setBrief("");
    setChecks(null);
    setValidating(false);
  }, []);

  const applyMetaAccount = (acc: AvailableMetaAdAccount) => {
    setSelectedMeta(acc);
    setAdAccountId(acc.id);
    setName(acc.name);
    setCurrency(acc.currency || "KZT");
    setPageId("");
    setPageName("");
    setInstagramId("");
    setStep("configure");
  };

  useEffect(() => {
    if (!open) return;
    reset();
    setStep(initialStep);
  }, [open, initialStep, reset]);

  useEffect(() => {
    if (step !== "configure" || pageId) return;
    if (pagesAssets.data.length > 0) {
      setPageId(pagesAssets.data[0].id);
      setPageName(pagesAssets.data[0].name);
    }
  }, [step, pagesAssets.data, pageId]);

  useEffect(() => {
    if (!pageId) return;
    const p = pagesAssets.data.find((x) => x.id === pageId);
    if (p) setPageName(p.name);
  }, [pageId, pagesAssets.data]);

  const runValidation = async () => {
    if (!adAccountId.trim()) {
      toast.error("Укажите ID кабинета");
      return;
    }
    setValidating(true);
    setChecks(null);
    try {
      const { data, error } = await supabase.functions.invoke("meta-validate-cabinet", {
        body: {
          adAccountId: adAccountId.trim(),
          pageId: pageId.trim() || undefined,
          pixelId: pixelId.trim() || undefined,
          instagramId: instagramId.trim() || undefined,
          accessToken: accessToken.trim() || undefined,
        },
      });
      if (error) throw error;
      setChecks(data?.checks ?? []);
      if (data?.ok) toast.success("Все данные кабинета проверены");
      else toast.error("Есть ошибки в данных кабинета");
    } catch (e) {
      toast.error((e as Error).message || "Ошибка проверки");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("Укажите название кабинета");
      return;
    }
    if (!adAccountId.trim()) {
      toast.error("Выберите кабинет Meta");
      return;
    }
    onCreate({
      id: crypto.randomUUID(),
      name: name.toUpperCase(),
      externalId: adAccountId,
      online: true,
      type,
      spend: 0,
      leads: 0,
      leadCost: 0,
      sales: 0,
      revenue: 0,
      city: city || undefined,
      dailyBudget: Number(dailyBudget) || 0,
      currency: currency || "KZT",
      adAccountId,
      pageId: pageId || undefined,
      pageName: pageName || undefined,
      instagramId: instagramId || undefined,
      telegramGroupId: telegramGroupId || undefined,
      whatsappNumber: whatsappNumber || undefined,
      pixelId: pixelId || undefined,
      pixelEvent: pixelEvent || "Lead",
      websiteUrl: websiteUrl || undefined,
      utmTemplate: utmTemplate.trim() || DEFAULT_META_UTM_TEMPLATE,
      brief: brief || undefined,
      accessToken: accessToken || undefined,
    });
    onOpenChange(false);
    reset();
  };

  const inputCls = "h-11 rounded-xl bg-background/60";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-5xl overflow-hidden border-border/60 bg-card p-0">
        <div className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b border-border/60 px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Crosshair className="h-5 w-5 text-success" />
              {step === "pick" ? "Быстрое подключение Meta" : "Настройка кабинета"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {step === "pick"
                ? "Выберите рекламный кабинет из списка — данные подтянутся и синхронизируются автоматически"
                : "Страницу и Instagram можно выбрать сейчас или при запуске рекламы"}
            </DialogDescription>
          </DialogHeader>

          {step === "pick" ? (
            <>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <AddCabinetPickStep
                  active={open}
                  existingActIds={existingActIds}
                  accessToken={accessToken}
                  onAccessTokenChange={setAccessToken}
                  onSelect={applyMetaAccount}
                  onManual={() => setStep("configure")}
                />
              </div>
              <div className="border-t border-border/60 px-6 py-4">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-xl"
                  onClick={() => setStep("configure")}
                >
                  Ввести ID вручную
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2">
                <div className="space-y-5 overflow-y-auto border-border/60 px-6 py-5 lg:border-r">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 gap-1"
                    onClick={() => setStep("pick")}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Выбрать другой кабинет
                  </Button>

                  <section>
                    <SectionTitle accent="bg-success">Основное</SectionTitle>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <FieldLabel>Название *</FieldLabel>
                        <Input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <FieldLabel>Бюджет / день</FieldLabel>
                          <Input value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} className={inputCls} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel>Город</FieldLabel>
                          <Input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
                        </div>
                      </div>
                    </div>
                  </section>

                  <section>
                    <SectionTitle accent="bg-primary">
                      <span className="flex items-center gap-1.5">
                        <Facebook className="h-3.5 w-3.5" /> Meta
                      </span>
                    </SectionTitle>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <FieldLabel icon={Shield}>Ad Account</FieldLabel>
                        <Input
                          value={adAccountId}
                          onChange={(e) => setAdAccountId(e.target.value)}
                          className={inputCls}
                          readOnly={!!selectedMeta}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel icon={Link2}>Страница</FieldLabel>
                        <Select
                          value={pageId || "__none__"}
                          onValueChange={(v) => {
                            if (v === "__none__") {
                              setPageId("");
                              setPageName("");
                              setInstagramId("");
                              return;
                            }
                            setPageId(v);
                            setInstagramId("");
                          }}
                        >
                          <SelectTrigger className={inputCls}>
                            <SelectValue placeholder={pagesAssets.isLoading ? "Загрузка…" : "Не выбрано"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Не выбирать сейчас</SelectItem>
                            {pagesAssets.data.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {pageId && (
                        <div className="space-y-1.5">
                          <FieldLabel icon={MessageSquare}>Instagram</FieldLabel>
                          {igAssets.data.length > 0 ? (
                            <Select
                              value={instagramId || "__none__"}
                              onValueChange={(v) => setInstagramId(v === "__none__" ? "" : v)}
                            >
                              <SelectTrigger className={inputCls}>
                                <SelectValue placeholder="Не выбрано" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Не выбирать</SelectItem>
                                {igAssets.data.map((ig) => (
                                  <SelectItem key={(ig as { id: string }).id} value={(ig as { id: string }).id}>
                                    @{(ig as { username?: string; id: string }).username ?? (ig as { id: string }).id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}
                          <Input
                            value={instagramId}
                            onChange={(e) => setInstagramId(e.target.value)}
                            placeholder="ID вручную"
                            className={inputCls}
                          />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <FieldLabel icon={Crosshair}>Pixel</FieldLabel>
                        <Select
                          value={pixelId || "__none__"}
                          onValueChange={(v) => setPixelId(v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger className={inputCls}>
                            <SelectValue placeholder="Не выбрано" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Не выбирать</SelectItem>
                            {pixelsAssets.data.map((px) => (
                              <SelectItem key={px.id} value={px.id}>{px.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-xl"
                        onClick={runValidation}
                        disabled={validating || !adAccountId}
                      >
                        {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Проверить
                      </Button>
                      {checks?.map((c, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                          {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                          <span>{c.label}{c.detail ? ` — ${c.detail}` : ""}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="space-y-5 overflow-y-auto px-6 py-5">
                  <section>
                    <SectionTitle accent="bg-warning">Трекинг</SectionTitle>
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={telegramGroupId} onChange={(e) => setTelegramGroupId(e.target.value)} placeholder="Telegram" className={inputCls} />
                      <Input value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="WhatsApp" className={inputCls} />
                      <Input value={pixelEvent} onChange={(e) => setPixelEvent(e.target.value)} placeholder="Событие" className={inputCls} />
                      <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="URL" className={inputCls} />
                    </div>
                    <Textarea value={utmTemplate} onChange={(e) => setUtmTemplate(e.target.value)} rows={2} className="mt-3 rounded-xl font-mono text-xs" />
                  </section>
                  <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} placeholder="Заметки" className="rounded-xl" />
                  <div className="flex gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs text-primary">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    При запуске кампании страницу можно сменить в мастере — как сейчас.
                  </div>
                </div>
              </div>
              <div className="border-t border-border/60 px-6 py-4">
                <Button onClick={handleSubmit} className="h-12 w-full rounded-xl bg-success text-white">
                  <Crosshair className="h-4 w-4" />
                  Подключить кабинет
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddCabinetDialog;
