import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MESSAGE_TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "@/data/messageTemplates";
import { applyTemplateVars } from "@/lib/templateVars";
import type { Lead } from "@/types/crm";
import { Search } from "lucide-react";

interface Props {
  trigger: React.ReactNode;
  lead: Lead;
  onPick: (text: string, templateKey: string) => void;
}

export function TemplatePicker({ trigger, lead, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<TemplateCategory>("first_contact");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const list = MESSAGE_TEMPLATES.filter((t) => t.category === cat);
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter(
      (t) => t.title.toLowerCase().includes(needle) || t.text.toLowerCase().includes(needle),
    );
  }, [cat, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-0">
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

        <div className="max-h-[320px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">Ничего не найдено</div>
          ) : (
            filtered.map((t) => {
              const preview = applyTemplateVars(t.text, lead);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    onPick(preview, t.key);
                    setOpen(false);
                  }}
                  className="mb-1.5 block w-full rounded-lg border border-border/60 bg-background p-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="text-xs font-semibold">{t.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{preview}</div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}