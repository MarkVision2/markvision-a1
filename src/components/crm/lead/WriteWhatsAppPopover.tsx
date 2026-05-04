import { useMemo, useState } from "react";
import { MessageCircle, Search, Send, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  MESSAGE_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
} from "@/data/messageTemplates";
import { applyTemplateVars } from "@/lib/templateVars";
import { openWhatsApp } from "@/lib/whatsapp";
import type { Lead } from "@/types/crm";

interface Props {
  trigger: React.ReactNode;
  lead: Lead;
  /** Called after a message is launched in WhatsApp, so the parent can log it. */
  onSent?: (text: string, templateKey?: string) => void;
}

export function WriteWhatsAppPopover({ trigger, lead, onSent }: Props) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<TemplateCategory>("first_contact");
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState("");

  const hasPhone = !!lead.phone?.trim();

  const filtered = useMemo(() => {
    const list = MESSAGE_TEMPLATES.filter((t) => t.category === cat);
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        t.text.toLowerCase().includes(needle),
    );
  }, [cat, q]);

  const launch = (text: string | undefined, templateKey?: string) => {
    if (!hasPhone) {
      toast.error("У лида нет номера телефона");
      return;
    }
    const ok = openWhatsApp(lead.phone, text);
    if (!ok) {
      toast.error("Не удалось открыть WhatsApp");
      return;
    }
    toast.success(text ? "Открываем WhatsApp с шаблоном…" : "Открываем WhatsApp…");
    onSent?.(text ?? "", templateKey);
    setOpen(false);
    setCustom("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] p-0">
        <div className="border-b border-border/60 p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/15 text-success">
              <MessageCircle className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">
                Сообщение в WhatsApp
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {lead.name} · {lead.phone || "номер не указан"}
              </div>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hasPhone}
            onClick={() => launch(undefined)}
            className="mt-2.5 h-8 w-full justify-center gap-1.5 text-xs"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Открыть пустой чат
          </Button>
        </div>

        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск шаблона…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {TEMPLATE_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  cat === c.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-foreground hover:bg-secondary",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[260px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Ничего не найдено
            </div>
          ) : (
            filtered.map((t) => {
              const preview = applyTemplateVars(t.text, lead);
              return (
                <button
                  key={t.key}
                  type="button"
                  disabled={!hasPhone}
                  onClick={() => launch(preview, t.key)}
                  className={cn(
                    "mb-1.5 block w-full rounded-lg border border-border/60 bg-background p-2 text-left transition-colors",
                    hasPhone
                      ? "hover:border-success/40 hover:bg-success/5"
                      : "cursor-not-allowed opacity-60",
                  )}
                >
                  <div className="text-xs font-semibold">{t.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {preview}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-border/60 p-2">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
            Свой текст
          </div>
          <Textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Напишите сообщение…"
            rows={2}
            className="resize-none text-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={!hasPhone || !custom.trim()}
            onClick={() => launch(custom.trim())}
            className="mt-2 h-8 w-full justify-center gap-1.5 bg-success text-primary-foreground hover:bg-success/90"
          >
            <Send className="h-3.5 w-3.5" />
            Отправить в WhatsApp
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}