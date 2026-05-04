import { cn } from "@/lib/utils";
import { BarChart3, Zap } from "lucide-react";

interface Props {
  title: string;
  rangeLabel: string;
  pageNumber: number;
  pageTotal: number;
  rightLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export function ReportPageWrapper({
  title, rangeLabel, pageNumber, pageTotal, rightLabel, className, children,
}: Props) {
  return (
    <section
      className={cn(
        "report-page rounded-3xl border border-border/60 bg-card/40 p-6 sm:p-8",
        className,
      )}
      style={{
        background:
          "linear-gradient(180deg, hsl(220 40% 14%) 0%, hsl(220 40% 11%) 100%)",
      }}
    >
      <header className="flex items-start justify-between border-b border-border/40 pb-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15 text-success">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <div className="text-base font-bold">{title}</div>
            <div className="text-xs text-muted-foreground">· {rangeLabel}</div>
          </div>
        </div>
        {rightLabel && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {rightLabel}
          </span>
        )}
      </header>

      <div className="py-6">{children}</div>

      <footer className="mt-4 flex items-center justify-between border-t border-border/40 pt-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <Zap className="h-3 w-3 text-success" />
          Сгенерировано <span className="font-semibold text-foreground/80">MarkVision AI</span>
        </span>
        <span>Страница {pageNumber} из {pageTotal}</span>
      </footer>
    </section>
  );
}