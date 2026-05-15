import { useState } from "react";
import {
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
import { cn } from "@/lib/utils";
import { DEFAULT_META_UTM_TEMPLATE } from "@/lib/utmDefaults";
import type { AdCabinet } from "@/types/ads";

interface AddCabinetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (cabinet: AdCabinet) => void;
}

type CheckItem = { ok: boolean; label: string; detail?: string };

/** Унифицированный label секции — как в CreateCampaignDialog. */
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

const AddCabinetDialog = ({ open, onOpenChange, onCreate }: AddCabinetDialogProps) => {
  // Основное
  const [name, setName] = useState("");
  const [type, setType] = useState<"Личный" | "Агентский">("Личный");
  const [dailyBudget, setDailyBudget] = useState("50000");
  const [city, setCity] = useState("");

  // Meta
  const [adAccountId, setAdAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [accessToken, setAccessToken] = useState("");

  // Трекинг и связь
  const [telegramGroupId, setTelegramGroupId] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [pixelEvent, setPixelEvent] = useState("Lead");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [utmTemplate, setUtmTemplate] = useState(DEFAULT_META_UTM_TEMPLATE);

  // Заметки
  const [brief, setBrief] = useState("");

  // Validation state
  const [validating, setValidating] = useState(false);
  const [checks, setChecks] = useState<CheckItem[] | null>(null);

  const reset = () => {
    setName(""); setType("Личный"); setDailyBudget("50000"); setCity("");
    setAdAccountId(""); setPageId(""); setPageName(""); setInstagramId("");
    setTelegramGroupId(""); setWhatsappNumber(""); setPixelId(""); setPixelEvent("Lead"); setWebsiteUrl("");
    setUtmTemplate(DEFAULT_META_UTM_TEMPLATE);
    setBrief(""); setAccessToken(""); setChecks(null); setValidating(false);
  };

  const runValidation = async () => {
    if (!adAccountId.trim()) {
      toast.error("Укажите ID кабинета (Ad Account)");
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
      const items: CheckItem[] = data?.checks ?? [];
      setChecks(items);
      if (data?.ok) toast.success("Все данные кабинета проверены");
      else toast.error("Есть ошибки в данных кабинета");
    } catch (e) {
      toast.error((e as Error).message || "Ошибка проверки");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Укажите название кабинета");
      return;
    }
    const cabinet: AdCabinet = {
      id: crypto.randomUUID(),
      name: name.toUpperCase(),
      externalId: adAccountId || `ACT_${Math.floor(Math.random() * 1e16)}`,
      online: true,
      type,
      spend: 0,
      leads: 0,
      leadCost: 0,
      sales: 0,
      revenue: 0,
      city: city || undefined,
      dailyBudget: Number(dailyBudget) || 0,
      currency: "KZT",
      adAccountId: adAccountId || undefined,
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
    };

    // Sync в client_configs выполняется внутри useCabinetsStore.addCabinet
    // (он же дёргает src/lib/cabinetSync.ts → syncCabinetToClientConfig).
    // Здесь только передаём данные наверх — никакой прямой записи в client_configs.
    onCreate(cabinet);
    onOpenChange(false);
    reset();
  };

  const inputCls = "h-11 rounded-xl bg-background/60";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-5xl overflow-hidden border-border/60 bg-card p-0">
        <div className="flex max-h-[92vh] flex-col">
          {/* Sticky header */}
          <DialogHeader className="border-b border-border/60 px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Crosshair className="h-5 w-5 text-success" />
              Добавить кабинет
            </DialogTitle>
            <DialogDescription className="text-xs">
              Подключите рекламный кабинет — статистика подтянется автоматически
            </DialogDescription>
          </DialogHeader>

          {/* Two-column scrollable body */}
          <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* LEFT: основное + Meta */}
            <div className="space-y-6 overflow-y-auto border-border/60 px-6 py-5 lg:border-r">
              <section>
                <SectionTitle accent="bg-success">Основное</SectionTitle>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <FieldLabel>Название кабинета *</FieldLabel>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Напр: Авто Сервис Павлодар"
                      className={inputCls}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <FieldLabel>Дневной бюджет</FieldLabel>
                      <div className="relative">
                        <Input
                          value={dailyBudget}
                          onChange={(e) => setDailyBudget(e.target.value)}
                          inputMode="numeric"
                          placeholder="50000"
                          className={cn(inputCls, "pr-10")}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          ₸
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>Город</FieldLabel>
                      <Input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="Алматы"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <FieldLabel>Тип кабинета</FieldLabel>
                    <div className="grid grid-cols-2 gap-2">
                      {(["Личный", "Агентский"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setType(t)}
                          className={cn(
                            "flex items-center justify-center gap-2 rounded-xl border bg-background/60 px-3 py-2.5 text-xs font-medium transition-colors",
                            type === t
                              ? "border-success text-foreground shadow-[inset_0_0_0_1px_hsl(var(--success))]"
                              : "border-border/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-4 w-4 place-items-center rounded-full border",
                              type === t ? "border-success" : "border-muted-foreground/40",
                            )}
                          >
                            {type === t && <span className="h-2 w-2 rounded-full bg-success" />}
                          </span>
                          {t}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">Личный</span> — статистика во всех разделах проекта.{" "}
                      <span className="font-semibold text-foreground">Агентский</span> — только в списке кабинетов.
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle accent="bg-primary">
                  <span className="flex items-center gap-1.5">
                    <Facebook className="h-3.5 w-3.5" /> Интеграция Meta
                  </span>
                </SectionTitle>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <FieldLabel icon={Shield}>ID кабинета</FieldLabel>
                      <Input
                        value={adAccountId}
                        onChange={(e) => setAdAccountId(e.target.value)}
                        placeholder="act_…"
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel icon={Link2}>ID страницы</FieldLabel>
                      <Input
                        value={pageId}
                        onChange={(e) => setPageId(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel icon={Globe}>Название страницы</FieldLabel>
                      <Input
                        value={pageName}
                        onChange={(e) => setPageName(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel icon={MessageSquare}>Instagram ID</FieldLabel>
                      <Input
                        value={instagramId}
                        onChange={(e) => setInstagramId(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel icon={Shield}>Access Token (опционально)</FieldLabel>
                    <Input
                      type="password"
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="EAA…"
                      className={inputCls}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Если не указан — используется системный токен Meta.
                    </p>
                  </div>

                  <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs text-primary">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Данные Meta будут синхронизироваться автоматически каждую ночь.
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={runValidation}
                    disabled={validating || !adAccountId.trim()}
                    className="h-10 w-full rounded-xl"
                  >
                    {validating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Проверить данные кабинета
                  </Button>

                  {checks && (
                    <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/40 p-3">
                      {checks.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          {c.ok ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                          ) : (
                            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="font-medium">{c.label}</span>
                            {c.detail && (
                              <span className="text-muted-foreground"> — {c.detail}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* RIGHT: трекинг + бриф */}
            <div className="space-y-6 overflow-y-auto px-6 py-5">
              <section>
                <SectionTitle accent="bg-warning">
                  <span className="flex items-center gap-1.5">
                    <Link2 className="h-3.5 w-3.5" /> Трекинг и связь
                  </span>
                </SectionTitle>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <FieldLabel icon={Send}>Telegram Group ID</FieldLabel>
                      <Input
                        value={telegramGroupId}
                        onChange={(e) => setTelegramGroupId(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel icon={MessageSquare}>WhatsApp</FieldLabel>
                      <Input
                        value={whatsappNumber}
                        onChange={(e) => setWhatsappNumber(e.target.value)}
                        placeholder="+7…"
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel icon={Crosshair}>Pixel ID</FieldLabel>
                      <Input
                        value={pixelId}
                        onChange={(e) => setPixelId(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel>Событие пикселя</FieldLabel>
                      <Input
                        value={pixelEvent}
                        onChange={(e) => setPixelEvent(e.target.value)}
                        placeholder="Lead"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel icon={Globe}>URL сайта</FieldLabel>
                    <Input
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://"
                      className={inputCls}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel icon={Link2}>UTM-шаблон (Meta URL parameters)</FieldLabel>
                    <Textarea
                      value={utmTemplate}
                      onChange={(e) => setUtmTemplate(e.target.value)}
                      rows={2}
                      placeholder={DEFAULT_META_UTM_TEMPLATE}
                      className="rounded-xl bg-background/60 font-mono text-xs"
                    />
                    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        Подставится в поле <b>URL parameters</b> каждой кампании Meta.
                        <b className="text-foreground"> utm_content=&#123;&#123;ad.id&#125;&#125;</b> обязателен —
                        по нему сквозная аналитика связывает лиды с конкретным креативом.
                      </span>
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle accent="bg-muted-foreground">Заметки / бриф</SectionTitle>
                <Textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={8}
                  placeholder="Дополнительная информация о клиенте, продукте, особенностях…"
                  className="rounded-xl bg-background/60"
                />
              </section>
            </div>
          </div>

          {/* Sticky footer */}
          <div className="border-t border-border/60 bg-background/40 px-6 py-4">
            <Button
              onClick={handleSubmit}
              className="h-12 w-full rounded-xl bg-success text-white hover:bg-success/90"
            >
              <Crosshair className="h-4 w-4" />
              Создать кабинет
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddCabinetDialog;
