import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function QuickCreateProjectDialog({ open, onOpenChange }: Props) {
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
