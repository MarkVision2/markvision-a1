import { Bell, Sparkles } from "lucide-react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout = ({ children }: AppLayoutProps) => {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col bg-background">
          <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border/60 bg-background/70 px-3 backdrop-blur-xl sm:px-6">
            <SidebarTrigger className="-ml-1" />
            <div className="hidden text-sm text-muted-foreground sm:block">
              Таргетолог
            </div>
            <div className="relative mx-auto w-full max-w-2xl">
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
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary"
            >
              <Bell className="h-4 w-4" />
            </button>
          </header>
          <div className="min-w-0 flex-1">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
