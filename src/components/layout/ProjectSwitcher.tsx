import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Check, ChevronsUpDown, Plus, Settings2, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Локальный диалог — не экспортируем, чтобы Lovable не ломал import/JSX отдельными правками. */
function ProjectQuickCreatePanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { addProject, setActive } = useProjectsStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    onOpenChange(false);
    setTimeout(() => setName(""), 200);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Введите название проекта");
      return;
    }
    setBusy(true);
    try {
      const project = await addProject(trimmed);
      await setActive(project.id);
      toast.success(`Проект «${project.name}» создан`);
      close();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать проект");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (v) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Быстрое создание</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="quick-project-name">Название проекта</Label>
            <Input
              id="quick-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, Стоматология AURA"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
            />
          </div>
          <Button className="w-full" onClick={() => void create()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Создать
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface Props {
  collapsed: boolean;
}

export function ProjectSwitcher({ collapsed }: Props) {
  const { projects, active, activeId, setActive, removeProject } = useProjectsStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card/60 p-2.5 text-left transition-colors hover:bg-card"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/20 text-base font-bold text-success ring-1 ring-success/40">
              {active?.initials ?? "PR"}
            </span>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{active?.name ?? "Проект"}</div>
                  <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                    {active?.domain ?? "Проект"}
                  </div>
                </div>
                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
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
                    className={cn(
                      "flex flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary",
                      isActive && "bg-secondary",
                    )}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-success/20 text-xs font-bold text-success">
                      {p.initials}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {isActive && <Check className="h-4 w-4 text-success" />}
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
          <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => { setCreateOpen(true); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-success hover:bg-success/10"
            >
              <Plus className="h-4 w-4" />
              Быстрое создание
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); navigate("/projects/new"); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-primary hover:bg-primary/10"
            >
              <Settings2 className="h-4 w-4" />
              Новый проект: полная настройка
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <ProjectQuickCreatePanel open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
