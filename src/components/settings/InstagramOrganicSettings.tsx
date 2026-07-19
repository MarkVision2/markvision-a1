import { useMemo, useState } from "react";
import {
  BarChart3, Camera, Copy, Loader2, MessageCircle, MousePointerClick, Pencil, Plus, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useInstagramCodewords, useCodewordStats, type InstagramCodeword } from "@/hooks/useInstagramOrganic";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { IG_ORGANIC_INTAKE_URL, igOrganicBotLink } from "@/lib/igOrganicLinks";
import { formatClickConversion } from "@/lib/codewordVariants";
import { InstagramAccountConnect } from "@/components/settings/InstagramAccountConnect";
import { VariantListInput } from "@/components/settings/VariantListInput";
import { normalizeVariantList } from "@/lib/codewordVariants";
import { cn } from "@/lib/utils";

/** Фиксированный текст кнопки в Instagram Direct (до 20 символов Meta). */
export const DM_ACCESS_BUTTON_TITLE = "получить доступ";

interface CodewordDraft {
  codeword: string;
  commentReplies: string[];
  dmMessages: string[];
  targetUrls: string[];
}

const EMPTY_DRAFT: CodewordDraft = {
  codeword: "",
  commentReplies: [""],
  dmMessages: [""],
  targetUrls: [""],
};

function draftFromItem(item: InstagramCodeword): CodewordDraft {
  return {
    codeword: item.codeword,
    commentReplies: item.commentReplies.length > 0 ? item.commentReplies : [""],
    dmMessages: item.dmMessages.length > 0 ? item.dmMessages : [""],
    targetUrls: item.targetUrls.length > 0 ? item.targetUrls : [""],
  };
}

function draftToPayload(draft: CodewordDraft) {
  return {
    codeword: draft.codeword,
    reelId: null as string | null,
    reelUrl: null as string | null,
    thumbnailUrl: null as string | null,
    caption: null as string | null,
    publishedAt: null as string | null,
    commentReplies: normalizeVariantList(draft.commentReplies),
    dmMessages: normalizeVariantList(draft.dmMessages),
    targetUrls: normalizeVariantList(draft.targetUrls),
    targetUrl: normalizeVariantList(draft.targetUrls)[0] ?? null,
    dmButtonTitle: DM_ACCESS_BUTTON_TITLE,
    active: true,
  };
}

function validateDraft(draft: CodewordDraft): string | null {
  if (!draft.codeword.trim()) return "Введите код-слово";
  if (normalizeVariantList(draft.commentReplies).length === 0) {
    return "Добавьте хотя бы один ответ на комментарий";
  }
  if (normalizeVariantList(draft.dmMessages).length === 0) {
    return "Добавьте хотя бы один текст сообщения в Direct";
  }
  if (normalizeVariantList(draft.targetUrls).length === 0) {
    return "Добавьте хотя бы одну ссылку для кнопки «получить доступ»";
  }
  return null;
}

export function InstagramOrganicSettings() {
  const { items, loading, add, update, remove } = useInstagramCodewords();
  const { stats } = useCodewordStats();
  const { activeId: projectId, projects } = useProjectsStore();
  const intakeToken = projects.find((p) => p.id === projectId)?.intakeToken ?? null;

  const [draft, setDraft] = useState<CodewordDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<InstagramCodeword | null>(null);
  const [editing, setEditing] = useState<InstagramCodeword | null>(null);
  const [editDraft, setEditDraft] = useState<CodewordDraft | null>(null);

  const statsById = useMemo(() => new Map(stats.map((s) => [s.codewordId, s])), [stats]);

  const handleAdd = async () => {
    const err = validateDraft(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      await add(draftToPayload(draft));
      setDraft(EMPTY_DRAFT);
      toast.success(`Код-слово «${draft.codeword.toLowerCase()}» добавлено`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (item: InstagramCodeword) => {
    setEditing(item);
    setEditDraft(draftFromItem(item));
  };

  const handleSaveEdit = async () => {
    if (!editing || !editDraft) return;
    const err = validateDraft(editDraft);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      await update(editing.id, draftToPayload(editDraft));
      toast.success("Код-слово обновлено");
      setEditing(null);
      setEditDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
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

  const copyText = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(`${label} скопирован`);
  };

  const samplePayload = (codeword: string, eventType: "codeword_comment" | "codeword_dm") => JSON.stringify(
    {
      token: intakeToken ?? "<PROJECT_TOKEN>",
      event_type: eventType,
      codeword,
      username: "@user_handle",
      contact: "+7700...",
    },
    null,
    2,
  );

  const renderFormFields = (
    value: CodewordDraft,
    onChange: (patch: Partial<CodewordDraft>) => void,
  ) => (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="ig-codeword">Код-слово</Label>
        <Input
          id="ig-codeword"
          placeholder="например, хаб"
          value={value.codeword}
          onChange={(e) => onChange({ codeword: e.target.value })}
          className="max-w-md font-medium"
        />
        <p className="text-[11px] text-muted-foreground">
          Подписчик пишет это слово в комментарии — система отвечает и шлёт Direct с кнопкой.
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MessageCircle className="h-4 w-4 text-pink-500" />
          Ответы на комментарий
        </div>
        <VariantListInput
          label="Варианты ответа"
          hint="До 10 штук. На каждое событие отправляется один случайный вариант."
          placeholder="Спасибо! Проверь Direct — отправили доступ 👇"
          items={value.commentReplies}
          onChange={(commentReplies) => onChange({ commentReplies })}
          multiline
        />
      </div>

      <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
        <div className="mb-3 text-sm font-semibold">Сообщение в Direct</div>
        <VariantListInput
          label="Текст над кнопкой"
          hint="До 10 вариантов. Случайный текст + кнопка «получить доступ»."
          placeholder="Готово! Жми кнопку ниже и забирай доступ 👇"
          items={value.dmMessages}
          onChange={(dmMessages) => onChange({ dmMessages })}
          multiline
        />
        <div className="mt-4 rounded-lg border border-border/50 bg-background/50 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Кнопка в Direct</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-md bg-pink-500/15 px-2.5 py-1 text-sm font-semibold text-pink-600 dark:text-pink-400">
              {DM_ACCESS_BUTTON_TITLE}
            </span>
            <span className="text-[11px] text-muted-foreground">
              фиксированная · клики считаем в аналитике
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MousePointerClick className="h-4 w-4 text-emerald-500" />
          Ссылки в Direct
        </div>
        <VariantListInput
          label="Куда ведёт «получить доступ»"
          hint="До 10 ссылок. Одна выбирается случайно; каждый клик по кнопке пишется в статистику."
          placeholder="https://landing.example/?utm_source=ig"
          items={value.targetUrls}
          onChange={(targetUrls) => onChange({ targetUrls })}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <InstagramAccountConnect />

      <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 p-4 text-sm text-muted-foreground">
        Нет Meta-токена или нужен вход через Facebook? Откройте{" "}
        <a href="/settings?tab=meta-tokens" className="font-semibold text-primary hover:underline">
          Настройки → Meta
        </a>
        : там Facebook OAuth и список Meta-токенов. После сохранения токена вернитесь сюда и нажмите
        «Выбрать Instagram аккаунт».
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-5 flex items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-pink-500/15 text-pink-500">
            <Camera className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Новое код-слово</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Код-слово → случайный ответ в комментарии → Direct с кнопкой «получить доступ».
              Клики по кнопке считаются автоматически.
            </p>
          </div>
        </div>

        {renderFormFields(draft, (patch) => setDraft((d) => ({ ...d, ...patch })))}

        <div className="mt-5 flex justify-end">
          <Button onClick={handleAdd} disabled={saving || !projectId} className="gap-2 rounded-xl">
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
          <div className="space-y-3">
            {items.map((it) => {
              const st = statsById.get(it.id);
              const wrote = (st?.codewordDms ?? 0) + (st?.codewordComments ?? 0);
              const clicks = st?.linkClicks ?? 0;
              const conv = formatClickConversion(Math.max(wrote, 1) > 0 ? wrote : 0, clicks);
              const shortLink = it.shortId ? igOrganicBotLink(it.shortId) : null;

              return (
                <div
                  key={it.id}
                  className="rounded-xl border border-border/60 bg-background/40 p-4"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-pink-500/10 font-mono text-sm font-bold uppercase text-pink-600 dark:text-pink-400">
                      {it.codeword.slice(0, 3)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base font-semibold">«{it.codeword}»</span>
                        {!it.active && (
                          <span className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            выкл
                          </span>
                        )}
                        <span className="rounded-md bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-medium text-pink-600 dark:text-pink-400">
                          {DM_ACCESS_BUTTON_TITLE}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{it.commentReplies.length} ответов в коммент.</span>
                        <span>{it.dmMessages.length} текстов DM</span>
                        <span>{it.targetUrls.length} ссылок</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(it)} aria-label="Редактировать">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Switch checked={it.active} onCheckedChange={(v) => handleToggle(it, v)} aria-label="Активность" />
                      <button
                        onClick={() => setConfirmDelete(it)}
                        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <StatPill label="Написали код-слово" value={wrote} accent="text-sky-600" />
                    <StatPill label="Нажали «получить доступ»" value={clicks} accent="text-emerald-600" />
                    <StatPill label="Конверсия в клик" value={conv} accent="text-orange-600" isText />
                    <StatPill label="Заявки" value={st?.leads ?? 0} accent="text-violet-600" />
                  </div>

                  {shortLink && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Трекинг кнопки</span>
                      <code className="min-w-0 flex-1 truncate text-[11px]">{shortLink}</code>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyText(shortLink, "Ссылка")}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" />
          Как считается аналитика
        </h4>
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>
            <b className="text-foreground">Написали код-слово</b> — комментарий или Direct с код-словом.
          </li>
          <li>
            <b className="text-foreground">Нажали «получить доступ»</b> — клик по кнопке в Direct
            (короткая ссылка markvision.kz/r/… → событие <code className="rounded bg-secondary px-1">link_click</code>).
          </li>
          <li>
            <b className="text-foreground">Конверсия</b> = клики по кнопке ÷ написали код-слово × 100%.
          </li>
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h4 className="mb-2 text-sm font-semibold">Webhook для n8n / GreenAPI</h4>
        <p className="mb-3 text-xs text-muted-foreground">
          При событии API возвращает случайные варианты: <code className="rounded bg-secondary px-1">comment_reply</code>, <code className="rounded bg-secondary px-1">dm_message</code>, <code className="rounded bg-secondary px-1">redirect_url</code>.
        </p>
        <div className="mb-4 flex items-center gap-2">
          <Input value={IG_ORGANIC_INTAKE_URL} readOnly className="font-mono text-xs" />
          <Button variant="outline" size="icon" onClick={copyEndpoint} aria-label="Скопировать">
            <Copy className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Комментарий с код-словом</Label>
            <pre className="mt-1.5 overflow-x-auto rounded-lg border border-border/60 bg-secondary/30 p-3 text-[11px] leading-relaxed">
{samplePayload(items[0]?.codeword || "хаб", "codeword_comment")}
            </pre>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Direct с код-словом</Label>
            <pre className="mt-1.5 overflow-x-auto rounded-lg border border-border/60 bg-secondary/30 p-3 text-[11px] leading-relaxed">
{samplePayload(items[0]?.codeword || "хаб", "codeword_dm")}
            </pre>
          </div>
        </div>
      </div>

      <Dialog open={!!editing && !!editDraft} onOpenChange={(o) => { if (!o) { setEditing(null); setEditDraft(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Редактировать «{editing?.codeword}»</DialogTitle>
            <DialogDescription>
              Изменения сразу для новых событий. Клики по кнопке и статистика прошлых событий сохранятся.
            </DialogDescription>
          </DialogHeader>
          {editDraft && renderFormFields(editDraft, (patch) => setEditDraft((d) => d ? { ...d, ...patch } : d))}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); setEditDraft(null); }}>Отмена</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatPill({ label, value, accent, isText }: { label: string; value: number | string; accent: string; isText?: boolean }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-lg font-bold tabular-nums", accent, isText && "text-base")}>{value}</div>
    </div>
  );
}
