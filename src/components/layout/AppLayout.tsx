import { Bell } from "lucide-react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { TaskReminderToast } from "@/components/crm/TaskReminderToast";

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col bg-background">
          <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/70 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:gap-3 sm:px-6">
            <SidebarTrigger className="h-10 w-10 shrink-0 md:hidden" />
            <div className="hidden min-w-0 flex-1 sm:block">
              <div className="relative mx-auto w-full max-w-2xl">
                <input
                  placeholder="Спросите ИИ… (скоро)"
                  disabled
                  title="AI-поиск появится в следующих обновлениях"
                  className="h-10 w-full cursor-not-allowed rounded-full border border-border/60 bg-secondary/30 px-4 text-sm outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1 sm:ml-0">
              <button
                type="button"
                aria-label="Уведомления"
                className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"
              >
                <Bell className="h-4 w-4" />
              </button>
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-x-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </SidebarInset>
      </div>
      <MobileBottomNav />
      <TaskReminderToast />
    </SidebarProvider>
  );
};

export default AppLayout;
