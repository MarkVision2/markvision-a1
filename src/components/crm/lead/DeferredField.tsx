import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type CommonProps = {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Keep only digits in the draft (for amounts). */
  digitsOnly?: boolean;
  maxLength?: number;
};

type InputProps = CommonProps & {
  multiline?: false;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  min?: number | string;
  max?: number | string;
};

type TextareaProps = CommonProps & {
  multiline: true;
  rows?: number;
};

/**
 * Controlled field with local draft so typing stays smooth.
 * Commits on blur (and Enter for single-line). External value syncs only
 * when not focused — avoids cursor jump from store/realtime re-renders.
 */
export function DeferredField(props: InputProps | TextareaProps) {
  const { value, onCommit, className, placeholder, ariaLabel, digitsOnly, maxLength } = props;
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const normalize = (raw: string) => (digitsOnly ? raw.replace(/[^\d]/g, "") : raw);

  const commit = () => {
    const next = normalize(draftRef.current);
    if (next !== value) onCommit(next);
  };

  const onChange = (raw: string) => setDraft(normalize(raw));

  if (props.multiline) {
    return (
      <Textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        rows={props.rows ?? 3}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(className)}
      />
    );
  }

  return (
    <Input
      type={props.type ?? "text"}
      inputMode={props.inputMode}
      min={props.min}
      max={props.max}
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(className)}
    />
  );
}
