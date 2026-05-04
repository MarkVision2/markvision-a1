import { useState } from "react";
import { Sparkles, Loader2, MessageCircle, Wand2, ShieldQuestion, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AiSuggestMode = "reply" | "improve" | "objection";

interface Props {
  messages: { fromMe: boolean; text: string }[];
  stage?: string;
  leadName?: string;
  channel?: string;
  draft?: string;
  rejectReason?: string;
  service?: string;
  amount?: number;
  onPick: (text: string) => void;
}

const MODE_LABEL: Record<AiSuggestMode, string> = {
  reply: "Ответить",
  improve: "Улучшить мой текст",
  objection: "Снять возражение",
};

export function AiSuggestButton({
  messages, stage, leadName, channel, draft, rejectReason, service, amount, onPick,
}: Props) {
  const [loading, setLoading] = useState<AiSuggestMode | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeMode, setActiveMode] = useState<AiSuggestMode | null>(null);

  const ask = async (mode: AiSuggestMode) => {
    if (mode === "improve" && !draft?.trim()) {
      toast.info("Сначала наберите черновик в поле ввода");
      return;
    }
    setLoading(mode);
    setSuggestions([]);
    setActiveMode(mode);
    try {
      const { data, error } = await supabase.functions.invoke("crm-ai-suggest", {
        body: { mode, messages, stage, leadName, channel, draft, rejectReason, service, amount },
      });
      if (error) throw error;
      const s = (data as { suggestions?: string[] })?.suggestions ?? [];
      if (s.length === 0) toast.info("AI не вернул вариантов, попробуйте ещё раз");
      setSuggestions(s);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Не удалось получить подсказку";
      toast.error(msg);
    } finally {
      setLoading(null);
    }
  };

  const isLoading = loading !== null;

  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isLoading}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            AI{loading ? ` · ${MODE_LABEL[loading]}` : "-подсказка"}
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={() => ask("reply")} className="text-xs">
            <MessageCircle className="mr-2 h-3.5 w-3.5" /> Ответить клиенту
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => ask("improve")} className="text-xs" disabled={!draft?.trim()}>
            <Wand2 className="mr-2 h-3.5 w-3.5" /> Улучшить мой текст
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => ask("objection")} className="text-xs">
            <ShieldQuestion className="mr-2 h-3.5 w-3.5" /> Снять возражение
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {activeMode && (
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {MODE_LABEL[activeMode]}
            </div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                onPick(s);
                setSuggestions([]);
              }}
              className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left text-xs hover:bg-primary/10"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}