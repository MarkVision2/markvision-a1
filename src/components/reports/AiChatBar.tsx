import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { ReportData } from "@/hooks/useReportData";

interface Props {
  data: ReportData | null;
  rangeLabel: string;
}

export function AiChatBar({ data, rangeLabel }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || !data) return;
    setOpen(true);
    setLoading(true);
    setAnswer("");
    try {
      const { data: resp, error } = await supabase.functions.invoke("report-ai-chat", {
        body: {
          mode: "chat",
          question: q,
          rangeLabel,
          totals: data.totals,
          prev: data.prev ?? null,
          scoring: data.scoring,
          channels: data.channels.slice(0, 10),
        },
      });
      if (error) throw error;
      setAnswer((resp as { text?: string })?.text ?? "");
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={ask} className="relative flex-1">
        <Sparkles className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Спросите ИИ о ваших данных..."
          className="h-12 w-full rounded-2xl border border-border/60 bg-card/40 pl-11 pr-16 text-sm outline-none transition-colors focus:border-success/50"
        />
        <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-border/60 bg-secondary/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </form>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-success" />
              AI Аналитик
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-xl border border-border/40 bg-card/40 p-3 text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Вопрос:</span>
            <div className="mt-1">{q}</div>
          </div>
          <div className="rounded-xl border border-success/20 bg-success/5 p-4 text-sm leading-relaxed">
            {loading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Думаю...
              </span>
            ) : (
              answer || "—"
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}