import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Check = { key: string; label: string; ok: boolean; detail: string };
type HealthResult = {
  ok: boolean;
  error?: string;
  cabinet_id?: string;
  project_id?: string;
  checked_at?: string;
  checks?: Check[];
};

interface Props {
  cabinetId: string;
  className?: string;
}

export function HealthCheckPanel({ cabinetId, className }: Props) {
  const [data, setData] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!cabinetId) return;
    setLoading(true);
    try {
      const { data: res, error } = await supabase.rpc("cabinet_health_check" as any, {
        p_cabinet_id: cabinetId,
      });
      if (error) {
        setData({ ok: false, error: error.message });
      } else {
        setData(res as HealthResult);
      }
    } catch (e: any) {
      setData({ ok: false, error: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }, [cabinetId]);

  useEffect(() => { run(); }, [run]);

  const checks = data?.checks ?? [];
  const failed = checks.filter((c) => !c.ok).length;

  return (
    <div className={cn("rounded-2xl border border-border/60 bg-card/60 p-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Состояние интеграций</h3>
          {checks.length > 0 && (
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
              failed === 0 ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
            )}>
              {failed === 0 ? "Всё в порядке" : `${failed} из ${checks.length} требуют внимания`}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={run} disabled={loading} className="h-8">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {data?.error && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {data.error}
        </div>
      )}

      <ul className="mt-3 space-y-1.5">
        {checks.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {c.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
              )}
              <span className="text-sm font-medium">{c.label}</span>
            </div>
            <span className="truncate text-[11px] text-muted-foreground" title={c.detail}>
              {c.detail}
            </span>
          </li>
        ))}
        {!loading && checks.length === 0 && !data?.error && (
          <li className="rounded-lg border border-dashed border-border/40 px-3 py-3 text-center text-xs text-muted-foreground">
            Нет данных. Нажмите обновить.
          </li>
        )}
      </ul>
    </div>
  );
}
