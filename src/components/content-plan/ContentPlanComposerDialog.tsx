import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CONTENT_PLAN_CATEGORY_META,
  CONTENT_PLAN_STATUS_META,
  CONTENT_PLAN_TYPE_META,
  type ContentPlanCategory,
  type ContentPlanStatus,
  type ContentPlanType,
} from "@/lib/contentPlan";
import type { ContentPlanDraft } from "@/hooks/useContentPlan";

export function ContentPlanComposerDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (draft: ContentPlanDraft) => Promise<string>;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ContentPlanCategory>("content");
  const [contentType, setContentType] = useState<ContentPlanType>("REELS");
  const [status, setStatus] = useState<ContentPlanStatus>("idea");
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [prompts, setPrompts] = useState("");
  const [codeword, setCodeword] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setCategory("content");
    setContentType("REELS");
    setStatus("idea");
    setDescription("");
    setHashtags("");
    setPrompts("");
    setCodeword("");
    setScheduledLocal("");
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Введите название");
      return;
    }
    setSaving(true);
    try {
      let scheduledAt: string | null = null;
      if (scheduledLocal) {
        scheduledAt = new Date(scheduledLocal).toISOString();
      }
      const id = await onCreate({
        title,
        category,
        contentType,
        status: scheduledAt && status === "idea" ? "scheduled" : status,
        description: description.trim() || null,
        hashtags: hashtags.trim() || null,
        prompts: prompts.trim() || null,
        codeword: codeword.trim().toLowerCase() || null,
        scheduledAt,
      });
      toast.success("Публикация добавлена в план");
      reset();
      onOpenChange(false);
      return id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая публикация</DialogTitle>
          <DialogDescription>
            Идея попадёт в контент-план. Автопостинг и код-слово можно привязать позже.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Название</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="3 вещи которые должен автоматизировать маркетолог"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Тип</Label>
              <Select value={contentType} onValueChange={(v) => setContentType(v as ContentPlanType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTENT_PLAN_TYPE_META) as ContentPlanType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CONTENT_PLAN_TYPE_META[k].emoji} {CONTENT_PLAN_TYPE_META[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Категория</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ContentPlanCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTENT_PLAN_CATEGORY_META) as ContentPlanCategory[]).map((k) => (
                    <SelectItem key={k} value={k}>{CONTENT_PLAN_CATEGORY_META[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ContentPlanStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTENT_PLAN_STATUS_META) as ContentPlanStatus[]).map((k) => (
                    <SelectItem key={k} value={k}>{CONTENT_PLAN_STATUS_META[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Дата / время публикации</Label>
              <Input
                type="datetime-local"
                value={scheduledLocal}
                onChange={(e) => setScheduledLocal(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Код-слово (опционально)</Label>
            <Input
              value={codeword}
              onChange={(e) => setCodeword(e.target.value)}
              placeholder="хаб"
              className="font-mono uppercase"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Хэштеги</Label>
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#marketing #ai" />
          </div>
          <div className="space-y-1.5">
            <Label>Промпты</Label>
            <Textarea value={prompts} onChange={(e) => setPrompts(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={saving} className="gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
