import { Navigate } from "react-router-dom";
import { Loader2, ShieldOff } from "lucide-react";
import { useMyAccess } from "@/hooks/useMyAccess";
import type { ModuleKey } from "@/hooks/useTeamStore";

const FALLBACK_BY_MODULE: Record<ModuleKey, string> = {
  dashboard: "/dashboard",
  ads: "/ads",
  factory: "/",
  content_center: "/marketing/content-center",
  content_plan: "/marketing/content-plan",
  strategy: "/dashboard",
  crm: "/crm",
  sales_ai: "/sales-ai",
  ai_agents: "/ai-agents",
  broadcasts: "/broadcasts",
  analytics: "/analytics",
  creative_funnel: "/analytics/creatives",
  content_analytics: "/analytics/content",
  metrics: "/metrics",
  finance: "/finance",
  reports: "/reports",
  settings: "/settings",
};

/** Пускает в раздел только если у пользователя есть доступ к модулю. */
export function RequireModule({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const { loading, modules, has } = useMyAccess();

  if (loading) {
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (has(module)) return <>{children}</>;

  const first = modules[0];
  if (first && FALLBACK_BY_MODULE[first] !== FALLBACK_BY_MODULE[module]) {
    return <Navigate to={FALLBACK_BY_MODULE[first]} replace />;
  }

  return (
    <div className="grid h-[60vh] place-items-center px-6 text-center">
      <div className="space-y-2">
        <ShieldOff className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Нет доступа к разделу</h1>
        <p className="text-sm text-muted-foreground">
          Обратитесь к администратору, чтобы получить права на этот модуль.
        </p>
      </div>
    </div>
  );
}
