import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { cn } from "@/lib/utils";
import { ProjectOnboardingDialog } from "@/components/projects/ProjectOnboardingDialog";

interface Props {
  collapsed: boolean;
}

export function ProjectSwitcher({ collapsed }: Props) {
  const { projects, active, activeId, setActive, removeProject } = useProjectsStore();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const projectNameClass = "overflow-hidden break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={active?.name ?? "Проект"}
            className="flex min-h-[76px] w-full items-center gap-3 rounded-xl border border-border/60 bg-card/60 p-2.5 text-left transition-colors hover:bg-card"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/20 text-base font-bold text-success ring-1 ring-success/40">
              {active?.initials ?? "PR"}
            </span>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className={cn(projectNameClass, "text-sm font-semibold leading-tight")}>
                    {active?.name ?? "Проект"}
                  </div>
                  <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                    {active?.domain ?? "Проект"}
                  </div>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(420px,calc(100vw-2rem))] p-2">
          <div className="px-2 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Проекты
          </div>
          <div className="space-y-1">
            {projects.map((p) => {
              const isActive = p.id === activeId;
              return (
                <div key={p.id} className="group flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setActive(p.id); setOpen(false); }}
                    title={p.name}
                    className={cn(
                      "flex min-h-12 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary",
                      isActive && "bg-secondary"
                    )}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-success/20 text-xs font-bold text-success">
                      {p.initials}
                    </span>
                    <span className={cn(projectNameClass, "min-w-0 flex-1 leading-snug")}>{p.name}</span>
                    {isActive && <Check className="h-4 w-4 shrink-0 text-success" />}
                  </button>
                  {!p.isPrimary && (
                    <button
                      type="button"
                      onClick={() => removeProject(p.id)}
                      className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => { setCreateOpen(true); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-success hover:bg-success/10"
            >
              <Plus className="h-4 w-4" />
              Новый проект
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <ProjectOnboardingDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
