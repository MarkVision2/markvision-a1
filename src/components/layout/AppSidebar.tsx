import {
  LayoutGrid,
  Target,
  Wand2,
  TableProperties,
  Users,
  GitBranch,
  Wallet,
  FileBarChart2,
  Settings,
  PhoneCall,
  Sparkles,
  Filter,
  Hash,
  Bot,
  Send,
  TrendingUp,
  CalendarClock,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { prefetchRoute } from "@/lib/routePrefetch";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ProjectSwitcher } from "./ProjectSwitcher";

type NavItem = {
  title: string;
  url: string;
  icon: typeof LayoutGrid;
};

const main: NavItem[] = [
  { title: "Дашборд", url: "/dashboard", icon: LayoutGrid },
];

const marketing: NavItem[] = [
  { title: "Управление рекламой", url: "/ads", icon: Target },
  { title: "Контент-завод", url: "/", icon: Wand2 },
  { title: "Контент-центр", url: "/marketing/content-center", icon: TrendingUp },
  { title: "Автопостинг", url: "/marketing/autopost", icon: CalendarClock },
];

// Marketing OS — собирается динамически в компоненте, т.к. URL зависит от активного проекта
const marketingOsIcon = Sparkles;

const sales: NavItem[] = [
  { title: "CRM", url: "/crm", icon: Users },
  { title: "AI РОП", url: "/sales-ai", icon: PhoneCall },
  { title: "AI агенты", url: "/ai-agents", icon: Bot },
  { title: "Рассылка", url: "/broadcasts", icon: Send },
];

// Аналитика — «Таблица показателей» (источник правды) первой, дальше от общего
// к частному: сквозная → креативы → контент.
const analytics: NavItem[] = [
  { title: "Таблица показателей", url: "/metrics", icon: TableProperties },
  { title: "Сквозная аналитика", url: "/analytics", icon: GitBranch },
  { title: "Воронка по креативам", url: "/analytics/creatives", icon: Filter },
  { title: "Контент-аналитика", url: "/analytics/content", icon: Hash },
];

// Финансы и отчётность вынесены из «Аналитики» в отдельную группу —
// чтобы блок аналитики не превращался в кашу из 6 пунктов.
const finance: NavItem[] = [
  { title: "Финансы", url: "/finance", icon: Wallet },
  { title: "Отчётность", url: "/reports", icon: FileBarChart2 },
];

const system: NavItem[] = [
  { title: "Настройки", url: "/settings", icon: Settings },
];

function buildGroups(activeProjectId: string): { label: string; items: NavItem[] }[] {
  const marketingOs: NavItem[] = activeProjectId
    ? [{ title: "Стратегия", url: `/projects/${activeProjectId}/strategy`, icon: marketingOsIcon }]
    : [];
  return [
    { label: "Главное", items: main },
    { label: "Маркетинг", items: [...marketing, ...marketingOs] },
    { label: "Продажи", items: sales },
    { label: "Аналитика", items: analytics },
    { label: "Финансы и отчёты", items: finance },
  ];
}

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { activeId } = useProjectsStore();
  const GROUPS = buildGroups(activeId);

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors",
      isActive
        ? "bg-success/10 text-success before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-success"
        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
    );

  return (
    <Sidebar collapsible="icon" className="border-r border-border/60">
      <SidebarHeader className="p-3">
        <ProjectSwitcher collapsed={collapsed} />
      </SidebarHeader>

      <SidebarContent className="px-2">
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="px-3 text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        onClick={() => { if (isMobile) setOpenMobile(false); }}
                        onFocus={() => prefetchRoute(item.url)}
                        onMouseEnter={() => prefetchRoute(item.url)}
                        className={({ isActive }) =>
                          itemClass({
                            isActive:
                              isActive ||
                              (item.url === "/" && pathname.startsWith("/create")),
                          })
                        }
                        end={item.url === "/"}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {system.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      onClick={() => { if (isMobile) setOpenMobile(false); }}
                      onFocus={() => prefetchRoute(item.url)}
                      onMouseEnter={() => prefetchRoute(item.url)}
                      className={({ isActive }) => itemClass({ isActive })}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>
    </Sidebar>
  );
}

export default AppSidebar;
