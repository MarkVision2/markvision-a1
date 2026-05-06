import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const PRODUCT_TYPES = [
  "B2C импульс",
  "B2C обдуманная",
  "B2C luxury",
  "B2B",
  "Подписка",
] as const;
export const CHANNELS = [
  "Instagram", "TikTok", "Google", "Яндекс", "2GIS", "VK", "Telegram", "YouTube",
] as const;
export const PRICE_MODELS = ["разово", "подписка", "за лид", "пакет/тариф"] as const;
export const RESEARCH_DEPTHS = ["быстрый", "глубокий"] as const;

export interface BriefFormValue {
  niche: string;
  product: string;
  audience: string;
  usp: string;
  geo: string;
  tone: string;
  monthlyBudget: string;
  productType: typeof PRODUCT_TYPES[number];
  priceModel: typeof PRICE_MODELS[number];
  researchDepth: typeof RESEARCH_DEPTHS[number];
  currentClients: string;
  channels: string[];
  directCompetitors: string;
  indirectCompetitors: string;
  differentiator: string;
  painsRaw: string;
}

export const emptyBrief: BriefFormValue = {
  niche: "",
  product: "",
  audience: "",
  usp: "",
  geo: "",
  tone: "дружелюбный, экспертный",
  monthlyBudget: "",
  productType: "B2C обдуманная",
  priceModel: "разово",
  researchDepth: "быстрый",
  currentClients: "",
  channels: ["Instagram"],
  directCompetitors: "",
  indirectCompetitors: "",
  differentiator: "",
  painsRaw: "",
};

interface Props {
  value: BriefFormValue;
  onChange: (v: BriefFormValue) => void;
  onSubmit: () => void;
  busy?: boolean;
  submitLabel?: string;
}

export function BriefForm({ value, onChange, onSubmit, busy, submitLabel }: Props) {
  const set = <K extends keyof BriefFormValue>(key: K, val: BriefFormValue[K]) =>
    onChange({ ...value, [key]: val });

  const toggleChannel = (c: string) =>
    set("channels", value.channels.includes(c) ? value.channels.filter((x) => x !== c) : [...value.channels, c]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Ниша</Label>
          <Input value={value.niche} onChange={(e) => set("niche", e.target.value)} placeholder="Стоматология" />
        </div>
        <div className="space-y-1.5">
          <Label>Гео</Label>
          <Input value={value.geo} onChange={(e) => set("geo", e.target.value)} placeholder="Алматы, Астана" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Продукт / услуга — одним предложением</Label>
        <Textarea rows={2} value={value.product} onChange={(e) => set("product", e.target.value)}
          placeholder="Имплантация под ключ за 1 день, гарантия 5 лет" />
      </div>

      <div className="space-y-1.5">
        <Label>Целевая аудитория</Label>
        <Textarea rows={2} value={value.audience} onChange={(e) => set("audience", e.target.value)}
          placeholder="Женщины 25-45, доход средний+, важна эстетика" />
      </div>

      <div className="space-y-1.5">
        <Label>УТП / отстройка</Label>
        <Textarea rows={2} value={value.usp} onChange={(e) => set("usp", e.target.value)}
          placeholder="Гарантия 5 лет, рассрочка 0%, первый приём бесплатно" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Бюджет / мес (₸)</Label>
          <Input type="number" value={value.monthlyBudget}
            onChange={(e) => set("monthlyBudget", e.target.value)} placeholder="500000" />
        </div>
        <div className="space-y-1.5">
          <Label>Модель оплаты</Label>
          <Select value={value.priceModel} onValueChange={(v) => set("priceModel", v as BriefFormValue["priceModel"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRICE_MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Тон коммуникации</Label>
          <Input value={value.tone} onChange={(e) => set("tone", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Тип продукта (веса для индекса сегментов)</Label>
          <Select value={value.productType} onValueChange={(v) => set("productType", v as BriefFormValue["productType"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRODUCT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Глубина анализа</Label>
          <Select value={value.researchDepth} onValueChange={(v) => set("researchDepth", v as BriefFormValue["researchDepth"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESEARCH_DEPTHS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Текущие клиенты — опиши 2-3 реальных (опционально)</Label>
        <Textarea rows={2} value={value.currentClients}
          onChange={(e) => set("currentClients", e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label>Каналы размещения</Label>
        <div className="flex flex-wrap gap-2 rounded-lg border border-border/60 bg-card/40 p-2">
          {CHANNELS.map((c) => (
            <label key={c} className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 hover:bg-secondary/60">
              <Checkbox checked={value.channels.includes(c)} onCheckedChange={() => toggleChannel(c)} />
              <span className="text-sm">{c}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Прямые конкуренты</Label>
          <Textarea rows={2} value={value.directCompetitors}
            onChange={(e) => set("directCompetitors", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Косвенные конкуренты</Label>
          <Textarea rows={2} value={value.indirectCompetitors}
            onChange={(e) => set("indirectCompetitors", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Чем отличаешься от рынка</Label>
        <Textarea rows={2} value={value.differentiator}
          onChange={(e) => set("differentiator", e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label>Боли клиентов — конкретные фразы если слышал</Label>
        <Textarea rows={2} value={value.painsRaw} onChange={(e) => set("painsRaw", e.target.value)}
          placeholder="«Боюсь что криво поставят» «Долго не могу решиться»..." />
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onSubmit} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
          {submitLabel ?? "Запустить онбординг"}
        </Button>
      </div>
    </div>
  );
}

/** Сопоставляет колонки project_briefs из БД с формой. */
export function briefFromDb(row: Record<string, unknown> | null | undefined): BriefFormValue {
  if (!row) return { ...emptyBrief };
  const r = row;
  const channels = Array.isArray(r.channels) ? (r.channels as string[]) : [];
  return {
    niche: (r.niche as string) ?? "",
    product: (r.product as string) ?? "",
    audience: (r.audience as string) ?? "",
    usp: (r.usp as string) ?? "",
    geo: (r.geo as string) ?? "",
    tone: (r.tone as string) ?? emptyBrief.tone,
    monthlyBudget: r.monthly_budget != null ? String(r.monthly_budget) : "",
    productType: ((r.product_type as BriefFormValue["productType"]) ?? emptyBrief.productType),
    priceModel: ((r.price_model as BriefFormValue["priceModel"]) ?? emptyBrief.priceModel),
    researchDepth: ((r.research_depth as BriefFormValue["researchDepth"]) ?? emptyBrief.researchDepth),
    currentClients: (r.current_clients as string) ?? "",
    channels: channels.length ? channels : emptyBrief.channels,
    directCompetitors: (r.direct_competitors as string) ?? "",
    indirectCompetitors: (r.indirect_competitors as string) ?? "",
    differentiator: (r.differentiator as string) ?? "",
    painsRaw: (r.pains_raw as string) ?? "",
  };
}

/** Convert form value to the body shape expected by generate-project-brief edge function. */
export function briefToInvokeBody(v: BriefFormValue): Record<string, unknown> {
  return {
    niche: v.niche,
    audience: v.audience,
    product: v.product,
    usp: v.usp,
    geo: v.geo,
    tone: v.tone,
    monthlyBudget: v.monthlyBudget ? Number(v.monthlyBudget) : undefined,
    productType: v.productType,
    researchDepth: v.researchDepth,
    priceModel: v.priceModel,
    currentClients: v.currentClients,
    channels: v.channels,
    directCompetitors: v.directCompetitors,
    indirectCompetitors: v.indirectCompetitors,
    differentiator: v.differentiator,
    painsRaw: v.painsRaw,
  };
}

/** Hook helper: keep form in sync when DB brief loads. */
export function useBriefFormState(dbRow: Record<string, unknown> | null | undefined) {
  const [value, setValue] = useState<BriefFormValue>(() => briefFromDb(dbRow));
  useEffect(() => {
    setValue(briefFromDb(dbRow));
  }, [dbRow]);
  return [value, setValue] as const;
}
