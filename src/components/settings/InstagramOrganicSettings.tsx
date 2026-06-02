import { useState } from "react";
import { Camera, Copy, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useInstagramCodewords, type InstagramCodeword } from "@/hooks/useInstagramOrganic";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { IG_ORGANIC_INTAKE_URL, igOrganicBotLink } from "@/lib/igOrganicLinks";
import { InstagramAccountConnect } from "@/components/settings/InstagramAccountConnect";


interface DraftCodeword {
  codeword: string;
  reelUrl: string;
  targetUrl: string;
  thumbnailUrl: string;
  caption: string;
}

const EMPTY_DRAFT: DraftCodeword = {
  codeword: "",
  reelUrl: "",
  targetUrl: "",
  thumbnailUrl: "",
  caption: "",
};

export function InstagramOrganicSettings() {
  const { items, loading, add, update, remove } = useInstagramCodewords();
  const { activeId: projectId, projects } = useProjectsStore();
  const intakeToken = projects.find((p) => p.id === projectId)?.intakeToken ?? null;

  const [draft, setDraft] = useState<DraftCodeword>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<InstagramCodeword | null>(null);

  const handleAdd = async () => {
    if (!draft.codeword.trim()) {
      toast.error("Введите код-слово");
      return;
    }
    setSaving(true);
    try {
      await add({
        codeword: draft.codeword,
        reelId: null,
        reelUrl: draft.reelUrl || null,
        thumbnailUrl: draft.thumbnailUrl || null,
        caption: draft.caption || null,
        publishedAt: null,
        targetUrl: draft.targetUrl || null,
        active: true,
      });
      setDraft(EMPTY_DRAFT);
      toast.success(`Код-слово «${draft.codeword.toLowerCase()}» добавлено`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (item: InstagramCodeword, active: boolean) => {
    try {
      await update(item.id, { active });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось обновить");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await remove(confirmDelete.id);
      toast.success("Код-слово удалено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setConfirmDelete(null);
    }
  };

  const copyEndpoint = () => {
    void navigator.clipboard.writeText(IG_ORGANIC_INTAKE_URL);
    toast.success("URL скопирован");
  };

  const samplePayload = (codeword: string) => JSON.stringify(
    {
      token: intakeToken ?? "<PROJECT_TOKEN>",
      event_type: "codeword_dm",
      codeword,
      username: "@user_handle",
      contact: "+7700...",
      reel_url: "https://www.instagram.com/reel/...",
    },
    null,
    2,
  );

  return (
    <div className="space-y-6">
      <InstagramAccountConnect />
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-pink-500/15 text-pink-500">
            <Camera className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Instagram organic — код-слова</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Заведите код-слово для каждого рилса. Когда подписчики напишут его в Direct, n8n или GreenAPI отправят событие сюда, и оно появится в воронке на дашборде.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ig-codeword">Код-слово</Label>
            <Input
              id="ig-codeword"
              placeholder="например, smile"
              value={draft.codeword}
              onChange={(e) => setDraft((d) => ({ ...d, codeword: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ig-reel">Ссылка на рилс</Label>
            <Input
              id="ig-reel"
              placeholder="https://www.instagram.com/reel/..."
              value={draft.reelUrl}
              onChange={(e) => setDraft((d) => ({ ...d, reelUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ig-target">Ссылка, которую отправляем в ответ</Label>
            <Input
              id="ig-target"
              placeholder="https://landing.example/?utm_source=ig_organic"
              value={draft.targetUrl}
              onChange={(e) => setDraft((d) => ({ ...d, targetUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ig-thumb">Превью рилса (URL картинки)</Label>
            <Input
              id="ig-thumb"
              placeholder="https://..."
              value={draft.thumbnailUrl}
              onChange={(e) => setDraft((d) => ({ ...d, thumbnailUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ig-caption">Краткое описание рилса</Label>
            <Input
              id="ig-caption"
              placeholder="О чём этот рилс — для статистики"
              value={draft.caption}
              onChange={(e) => setDraft((d) => ({ ...d, caption: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={handleAdd} disabled={saving || !projectId} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Добавить код-слово
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold">Активные код-слова</h4>
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Загрузка…</div>
        ) : items.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-border/60 py-10 text-center">
            <Camera className="mb-2 h-6 w-6 text-muted-foreground/60" />
            <div className="text-sm text-muted-foreground">Пока нет ни одного код-слова</div>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div
                key={it.id}
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-3"
              >
                {it.thumbnailUrl ? (
                  <img src={it.thumbnailUrl} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
                ) : (
                  <span className="grid h-12 w-12 place-items-center rounded-lg bg-pink-500/10">
                    <Camera className="h-5 w-5 text-pink-500" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">«{it.codeword}»</span>
                    {!it.active && (
                      <span className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        выкл
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {it.reelUrl && (
                      <a
                        href={it.reelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      >
                        рилс <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {it.targetUrl && (
                      <a
                        href={it.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      >
                        ссылка ответа <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {it.caption && <span className="truncate">{it.caption}</span>}
                  </div>
                </div>
                <Switch
                  checked={it.active}
                  onCheckedChange={(v) => handleToggle(it, v)}
                  aria-label="Активность"
                />
                <button
                  onClick={() => setConfirmDelete(it)}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Удалить"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h4 className="mb-2 text-sm font-semibold">Куда отправлять события из n8n / GreenAPI</h4>
        <p className="mb-3 text-xs text-muted-foreground">
          Настройте автоматизацию: при получении DM с код-словом — отправлять POST на этот URL. То же самое для клика по ссылке и появления заявки.
        </p>
        <div className="mb-4 flex items-center gap-2">
          <Input value={IG_ORGANIC_INTAKE_URL} readOnly className="font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={copyEndpoint} aria-label="Скопировать">
            <Copy className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Пример payload — событие «DM с код-словом»
          </Label>
          <pre className="overflow-x-auto rounded-lg border border-border/60 bg-secondary/30 p-3 text-[11px] leading-relaxed">
{samplePayload(items[0]?.codeword || "smile")}
          </pre>
          <p className="text-[11px] text-muted-foreground">
            <code className="rounded bg-secondary px-1">event_type</code> может принимать значения: <code className="rounded bg-secondary px-1">codeword_dm</code>, <code className="rounded bg-secondary px-1">link_click</code>, <code className="rounded bg-secondary px-1">lead</code>.
            Аутентификация — заголовком <code className="rounded bg-secondary px-1">x-intake-token</code> или полем <code className="rounded bg-secondary px-1">token</code> в теле.
          </p>
        </div>
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить код-слово?</AlertDialogTitle>
            <AlertDialogDescription>
              «{confirmDelete?.codeword}» больше не будет распознаваться. История событий останется в аналитике.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
