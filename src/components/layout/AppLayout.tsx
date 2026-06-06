import { Bell, Sparkles } from "lucide-react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { TaskReminderToast } from "@/components/crm/TaskReminderToast";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { ContentFactoryGalleryProvider } from "@/contexts/ContentFactoryGalleryContext";

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  const { active } = useProjectsStore();

  return (
    <ContentFactoryGalleryProvider>
    <SidebarProvider>
      <div className="flex min-h-svh w-full">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col bg-background">
          <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:gap-3 sm:px-6">
            <SidebarTrigger className="h-9 w-9 shrink-0 md:hidden" aria-label="Открыть меню" />
            <div className="min-w-0 flex-1 md:hidden">
              <div className="truncate text-sm font-semibold">{active?.name ?? "MarkVision"}</div>
              <div className="truncate text-[10px] text-muted-foreground">Проект</div>
            </div>
            <div className="relative hidden min-w-0 flex-1 md:mx-auto md:block md:max-w-2xl">
              <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <input
                placeholder="Спросите ИИ… (скоро)"
                disabled
                title="AI-поиск появится в следующих обновлениях"
                className="h-10 w-full cursor-not-allowed rounded-full border border-border/60 bg-secondary/30 pl-10 pr-14 text-sm outline-none placeholder:text-muted-foreground/60"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                ⌘K
              </span>
            </div>
            <button
              type="button"
              aria-label="Уведомления"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-secondary"
            >
              <Bell className="h-4 w-4" />
            </button>
          </header>
          <main className="mobile-main min-w-0 flex-1 overflow-x-hidden">{children}</main>
          <MobileBottomNav />
        </SidebarInset>
      </div>
      <TaskReminderToast />
    </SidebarProvider>
    </ContentFactoryGalleryProvider>
  );
};

export default AppLayout;
