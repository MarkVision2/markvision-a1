import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickCreateProjectDialog({ open, onOpenChange }: Props) {
  const { addProject, setActive } = useProjectsStore();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setBusy(false);
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(reset, 200);
  };

  const handleCreate = async () => {
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось создать проект";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md border-border/60 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-success" />
            Быстрое создание
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Укажите только название. Рекламный кабинет, WhatsApp и бриф можно добавить
            позже в разделах «Управление рекламой» и «Настройки».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="quick-project-name">Название проекта</Label>
          <Input
            id="quick-project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Напр: Автосервис Павлодар"
            className="h-11 rounded-xl"
            autoFocus
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Отмена
          </Button>
          <Button
            type="button"
            className="bg-success text-white hover:bg-success/90"
            onClick={() => void handleCreate()}
            disabled={busy || !name.trim()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
