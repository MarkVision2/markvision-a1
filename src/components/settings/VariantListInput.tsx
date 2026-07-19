import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CODEWORD_MAX_VARIANTS, normalizeVariantList } from "@/lib/codewordVariants";

interface VariantListInputProps {
  label: string;
  hint?: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
  multiline?: boolean;
  /** Компактный вид без тяжёлого хинта. */
  compact?: boolean;
}

function splitPaste(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, CODEWORD_MAX_VARIANTS);
}

export function VariantListInput({
  label,
  hint,
  placeholder,
  items,
  onChange,
  multiline,
  compact,
}: VariantListInputProps) {
  const rows = items.length > 0 ? items : [""];

  const setRow = (index: number, value: string) => {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  };

  const addRow = () => {
    if (rows.length >= CODEWORD_MAX_VARIANTS) return;
    onChange([...rows, ""]);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [""]);
  };

  const applyPaste = (index: number, text: string) => {
    const parts = splitPaste(text);
    if (parts.length <= 1) {
      setRow(index, text);
      return;
    }
    const before = rows.slice(0, index);
    const after = rows.slice(index + 1);
    onChange([...before, ...parts, ...after].slice(0, CODEWORD_MAX_VARIANTS));
  };

  const filled = normalizeVariantList(rows).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Label>{label}</Label>
          {hint && !compact ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {filled}/{CODEWORD_MAX_VARIANTS}
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <span className="mt-2.5 w-5 shrink-0 text-center text-[10px] font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            {multiline ? (
              <Textarea
                placeholder={placeholder}
                value={row}
                onChange={(e) => setRow(i, e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (text.includes("\n")) {
                    e.preventDefault();
                    applyPaste(i, text);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    addRow();
                  }
                }}
                rows={compact ? 2 : 2}
                className="min-h-[52px] resize-none text-sm"
              />
            ) : (
              <Input
                placeholder={placeholder}
                value={row}
                onChange={(e) => setRow(i, e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (text.includes("\n")) {
                    e.preventDefault();
                    applyPaste(i, text);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (row.trim() && rows.length < CODEWORD_MAX_VARIANTS) addRow();
                  }
                }}
                className="text-sm"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(i)}
              disabled={rows.length === 1 && !row.trim()}
              aria-label="Удалить вариант"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      {rows.length < CODEWORD_MAX_VARIANTS && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" />
          Ещё вариант
        </Button>
      )}
      {compact ? (
        <p className="text-[10px] text-muted-foreground">
          Enter — новый ряд · вставь несколько строк сразу
        </p>
      ) : null}
    </div>
  );
}
