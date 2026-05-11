import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  numeric?: boolean;
  suffix?: string;
  ariaLabel?: string;
  /** When true, allow text to wrap onto multiple lines instead of truncating. */
  wrap?: boolean;
}

/** Click to edit. Saves on blur or Enter. Esc cancels. */
export function InlineEdit({
  value, onSave, placeholder, className, inputClassName, multiline, numeric, suffix, ariaLabel, wrap,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => {
    const v = numeric ? draft.replace(/[^\d]/g, "") : draft.trim();
    if (v !== value) onSave(v);
    setEditing(false);
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
          }}
          rows={3}
          aria-label={ariaLabel}
          className={cn(
            "w-full resize-none rounded-md border border-border bg-background px-2 py-1 text-sm outline-none ring-1 ring-primary/40",
            inputClassName,
          )}
        />
      );
    }
    return (
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        value={draft}
        onChange={(e) => setDraft(numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        inputMode={numeric ? "numeric" : undefined}
        aria-label={ariaLabel}
        className={cn(
          "w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none ring-1 ring-primary/40",
          inputClassName,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "group max-w-full items-baseline gap-1 rounded-md px-1 -mx-1 text-left hover:bg-secondary/60",
        wrap ? "flex" : "inline-flex",
        !value && "text-muted-foreground",
        className,
      )}
      title={wrap ? (value || "Кликните чтобы изменить") : "Кликните чтобы изменить"}
    >
      <span className={wrap ? "break-words" : "truncate"}>{value || placeholder || "—"}</span>
      {suffix && value && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </button>
  );
}