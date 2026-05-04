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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import type { AdCabinet } from "@/types/ads";

interface AddCabinetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (cabinet: AdCabinet) => void;
}

type CheckItem = { ok: boolean; label: string; detail?: string };

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

  // Трекинг и связь
  const [telegramGroupId, setTelegramGroupId] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [pixelEvent, setPixelEvent] = useState("Lead");
  const [websiteUrl, setWebsiteUrl] = useState("");

  // Заметки
  const [brief, setBrief] = useState("");

  // Validation state
  const [validating, setValidating] = useState(false);
  const [checks, setChecks] = useState<CheckItem[] | null>(null);
  const [accessToken, setAccessToken] = useState("");

  const reset = () => {
    setName(""); setType("Личный"); setDailyBudget("50000"); setCity("");
    setAdAccountId(""); setPageId(""); setPageName(""); setInstagramId("");
    setTelegramGroupId(""); setWhatsappNumber(""); setPixelId(""); setPixelEvent("Lead"); setWebsiteUrl("");
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

  const handleSubmit = () => {
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
      brief: brief || undefined,
      accessToken: accessToken || undefined,
    };
    onCreate(cabinet);
    toast.success("Кабинет создан — статистика подтянется автоматически");
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-border/60 bg-card">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-secondary/60 text-foreground">
              <Crosshair className="h-6 w-6" />
            </span>
            <div>
              <DialogTitle className="text-2xl">Добавить кабинет</DialogTitle>
              <DialogDescription>
                Создайте новый рекламный кабинет для мониторинга
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Основные настройки */}
        <div className="mt-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-success" />
          Основные настройки
        </div>
        <div className="space-y-5 rounded-2xl border border-border/60 bg-secondary/30 p-5">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Название кабинета *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр: Авто Сервис Павлодар" className="h-12 rounded-xl bg-background/60" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Дневной бюджет</Label>
              <Input value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} inputMode="numeric" placeholder="50000" className="h-12 rounded-xl bg-background/60" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Город</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Алматы" className="h-12 rounded-xl bg-background/60" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Тип кабинета</Label>
            <div className="grid grid-cols-2 gap-3">
              {(["Личный", "Агентский"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border bg-background/60 px-4 py-3 text-sm font-medium transition-colors",
                    type === t ? "border-success text-foreground shadow-[inset_0_0_0_1px_hsl(var(--success))]" : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}>
                  <span className={cn("grid h-4 w-4 place-items-center rounded-full border", type === t ? "border-success" : "border-muted-foreground/40")}>
                    {type === t && <span className="h-2 w-2 rounded-full bg-success" />}
                  </span>
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Личный</span> — статистика попадает во все разделы проекта (Дашборд, CRM, Сквозная аналитика, Таблица показателей, Отчётность).{" "}
              <span className="font-semibold text-foreground">Агентский</span> — отображается только в списке «Управление рекламой».
            </p>
          </div>
        </div>

        <Accordion type="multiple" defaultValue={["meta", "tracking"]} className="space-y-2">
          {/* Интеграция Meta */}
          <AccordionItem value="meta" className="rounded-2xl border border-border/60 bg-secondary/30 px-4">
            <AccordionTrigger className="hover:no-underline">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                <Facebook className="h-4 w-4 text-primary" />
                Интеграция Meta
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                    <Shield className="h-3.5 w-3.5" /> ID кабинета
                  </Label>
                  <Input value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} placeholder="act_…" className="h-11 rounded-xl bg-background/60" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5" /> ID страницы
                  </Label>
                  <Input value={pageId} onChange={(e) => setPageId(e.target.value)} className="h-11 rounded-xl bg-background/60" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                    <Globe className="h-3.5 w-3.5" /> Название страницы
                  </Label>
                  <Input value={pageName} onChange={(e) => setPageName(e.target.value)} className="h-11 rounded-xl bg-background/60" />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" /> Instagram ID
                  </Label>
                  <Input value={instagramId} onChange={(e) => setInstagramId(e.target.value)} className="h-11 rounded-xl bg-background/60" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                  <Shield className="h-3.5 w-3.5" /> Access Token (опционально)
                </Label>
                <Input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="EAA…"
                  className="h-11 rounded-xl bg-background/60"
                />
                <p className="text-[11px] text-muted-foreground">
                  Если не указан — используется системный токен Meta.
                </p>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Данные Meta Ads будут автоматически синхронизироваться каждые 2 часа. Убедитесь, что ID кабинета указан верно.</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={runValidation}
                  disabled={validating || !adAccountId.trim()}
                  className="h-10 rounded-xl"
                >
                  {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Проверить данные кабинета
                </Button>
              </div>
              {checks && (
                <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/40 p-3">
                  {checks.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      {c.ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-success shrink-0" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 text-destructive shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{c.label}</span>
                        {c.detail && <span className="text-muted-foreground"> — {c.detail}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Трекинг и связь */}
          <AccordionItem value="tracking" className="rounded-2xl border border-border/60 bg-secondary/30 px-4">
            <AccordionTrigger className="hover:no-underline">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                <Link2 className="h-4 w-4 text-success" />
                Трекинг и связь
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Telegram Group ID</Label>
                  <Input value={telegramGroupId} onChange={(e) => setTelegramGroupId(e.target.value)} className="h-11 rounded-xl bg-background/60" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Номер WhatsApp</Label>
                  <Input value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} className="h-11 rounded-xl bg-background/60" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Facebook Pixel ID</Label>
                  <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} className="h-11 rounded-xl bg-background/60" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Событие пикселя</Label>
                  <Input value={pixelEvent} onChange={(e) => setPixelEvent(e.target.value)} placeholder="Lead" className="h-11 rounded-xl bg-background/60" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                  <Globe className="h-3.5 w-3.5" /> URL сайта
                </Label>
                <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://" className="h-11 rounded-xl bg-background/60" />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Заметки / бриф</Label>
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="Дополнительная информация о клиенте…" className="rounded-2xl bg-secondary/30" />
        </div>

        <Button onClick={handleSubmit} className="h-12 w-full rounded-xl bg-success text-white hover:bg-success/90">
          <Crosshair className="h-4 w-4" />
          Создать кабинет
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default AddCabinetDialog;
