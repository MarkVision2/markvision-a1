import { LayoutGrid, Menu, Target, Users, GitBranch } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";

const ITEMS = [
  { title: "Дашборд", url: "/dashboard", icon: LayoutGrid },
  { title: "Реклама", url: "/ads", icon: Target },
  { title: "CRM", url: "/crm", icon: Users },
  { title: "Аналитика", url: "/analytics", icon: GitBranch },
] as const;

/** Нижняя навигация для телефона — быстрый доступ без бокового меню. */
export function MobileBottomNav() {
  const { pathname } = useLocation();
  const { isMobile, toggleSidebar } = useSidebar();

  if (!isMobile) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label="Основная навигация"
    >
      <div className="mx-auto grid h-14 max-w-lg grid-cols-5">
        {ITEMS.map((item) => {
          const active =
            pathname === item.url ||
            (item.url === "/ads" && pathname.startsWith("/ads")) ||
            (item.url === "/crm" && pathname.startsWith("/crm")) ||
            (item.url === "/analytics" && pathname.startsWith("/analytics"));
          return (
            <NavLink
              key={item.url}
              to={item.url}
              className={cn(
                "flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold transition-colors",
                active ? "text-success" : "text-muted-foreground",
              )}
            >
              <item.icon className={cn("h-5 w-5", active && "text-success")} />
              <span className="max-w-full truncate">{item.title}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold text-muted-foreground"
          aria-label="Открыть меню"
        >
          <Menu className="h-5 w-5" />
          <span>Меню</span>
        </button>
      </div>
    </nav>
  );
}
