import { Check, CircleDashed, Loader2, AlertCircle } from "lucide-react";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";
import { cn } from "@/lib/utils";

const LABEL: Record<AutoSaveStatus, string> = {
  idle: "Все изменения сохранены",
  dirty: "Есть несохранённые изменения",
  saving: "Сохраняю…",
  saved: "Сохранено",
  error: "Ошибка сохранения",
};

export function SaveStatusBadge({ status, error, className }: { status: AutoSaveStatus; error?: string | null; className?: string }) {
  const Icon =
    status === "saving" ? Loader2 :
    status === "saved" ? Check :
    status === "error" ? AlertCircle :
    status === "dirty" ? CircleDashed :
    Check;

  return (
    <span
      title={status === "error" ? error ?? undefined : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
        status === "saved" && "border-success/40 bg-success/10 text-success",
        status === "saving" && "border-primary/40 bg-primary/10 text-primary",
        status === "dirty" && "border-warning/40 bg-warning/10 text-warning",
        status === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
        status === "idle" && "border-border/60 bg-secondary/40 text-muted-foreground",
        className,
      )}
    >
      <Icon className={cn("h-3 w-3", status === "saving" && "animate-spin")} />
      {LABEL[status]}
    </span>
  );
}