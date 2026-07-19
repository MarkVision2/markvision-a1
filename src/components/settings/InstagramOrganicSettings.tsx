import { useMemo, useState } from "react";
import {
  ChevronDown,
  Copy,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
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
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { IG_ORGANIC_INTAKE_URL, igOrganicBotLink } from "@/lib/igOrganicLinks";
import { formatClickConversion, normalizeVariantList } from "@/lib/codewordVariants";
import { InstagramAccountConnect } from "@/components/settings/InstagramAccountConnect";
import { VariantListInput } from "@/components/settings/VariantListInput";
import { cn } from "@/lib/utils";

/** Фиксированный текст кнопки в Instagram Direct (до 20 символов Meta). */
export const DM_ACCESS_BUTTON_TITLE = "получить доступ";

const DEFAULT_COMMENT = "Спасибо! Проверь Direct — отправили доступ 👇";
const DEFAULT_DM = "Готово! Жми кнопку ниже и забирай доступ 👇";

interface CodewordDraft {
  codeword: string;
  commentReplies: string[];
  dmMessages: string[];
  targetUrls: string[];
}

function emptyDraft(): CodewordDraft {
  return {
    codeword: "",
    commentReplies: [DEFAULT_COMMENT],
    dmMessages: [DEFAULT_DM],
    targetUrls: [""],
  };
}

function draftFromItem(item: InstagramCodeword): CodewordDraft {
  return {
    codeword: item.codeword,
    commentReplies: item.commentReplies.length > 0 ? item.commentReplies : [DEFAULT_COMMENT],
    dmMessages: item.dmMessages.length > 0 ? item.dmMessages : [DEFAULT_DM],
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
    return "Нужен хотя бы один ответ на комментарий";
  }
  if (normalizeVariantList(draft.dmMessages).length === 0) {
    return "Нужен хотя бы один текст в Direct";
  }
  if (normalizeVariantList(draft.targetUrls).length === 0) {
    return "Вставьте ссылку для кнопки «получить доступ»";
  }
  return null;
}

export function InstagramOrganicSettings() {
  const { items, loading, add, update, remove } = useInstagramCodewords();
  const { stats } = useCodewordStats();
  const { activeId: projectId, projects } = useProjectsStore();
  const { account } = useInstagramAccount();
  const intakeToken = projects.find((p) => p.id === projectId)?.intakeToken ?? null;

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<InstagramCodeword | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<InstagramCodeword | null>(null);
  const [draft, setDraft] = useState<CodewordDraft>(emptyDraft);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMoreTexts, setShowMoreTexts] = useState(false);

  const statsById = useMemo(() => new Map(stats.map((s) => [s.codewordId, s])), [stats]);
  const isEdit = !!editing;

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft());
    setShowMoreTexts(false);
    setComposerOpen(true);
  };

  const openEdit = (item: InstagramCodeword) => {
    setEditing(item);
    setDraft(draftFromItem(item));
    setShowMoreTexts(
      item.commentReplies.length > 1 || item.dmMessages.length > 1 || item.targetUrls.length > 1,
    );
    setComposerOpen(true);
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setEditing(null);
    setDraft(emptyDraft());
    setShowMoreTexts(false);
  };

  const handleSave = async () => {
    const err = validateDraft(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await update(editing.id, draftToPayload(draft));
        toast.success("Сохранено");
      } else {
        await add(draftToPayload(draft));
        toast.success(`«${draft.codeword.trim().toLowerCase()}» добавлено`);
      }
      closeComposer();
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

  const copyText = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(`${label} скопирован`);
  };

  const previewWord = draft.codeword.trim() || "хаб";

  return (
    <div className="space-y-5">
      <InstagramAccountConnect />

      {!account && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
          Сначала подключи Instagram выше. Код-слова заработают после привязки аккаунта.
          {" "}
          <a href="/settings?tab=meta-tokens" className="font-semibold underline-offset-2 hover:underline">
            Meta-токены
          </a>
        </div>
      )}

      {/* Список + быстрое добавление */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Код-слова</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Комментарий с словом → ответ → Direct с кнопкой «{DM_ACCESS_BUTTON_TITLE}».
            </p>
          </div>
          <Button
            onClick={openCreate}
            disabled={!projectId}
            className="gap-2 rounded-xl"
          >
            <Plus className="h-4 w-4" />
            Добавить код-слово
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка…
          </div>
        ) : items.length === 0 ? (
          <button
            type="button"
            onClick={openCreate}
            disabled={!projectId}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-secondary/10 px-6 py-12 text-center transition-colors hover:border-pink-500/40 hover:bg-pink-500/5"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-pink-500/15 text-pink-500">
              <Sparkles className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-foreground">Создать первое код-слово</span>
            <span className="max-w-sm text-xs text-muted-foreground">
              Достаточно слова и ссылки — ответы и текст Direct подставим сами.
            </span>
          </button>
        ) : (
          <ul className="space-y-2.5">
            {items.map((it) => {
              const st = statsById.get(it.id);
              const wrote = (st?.codewordDms ?? 0) + (st?.codewordComments ?? 0);
              const clicks = st?.linkClicks ?? 0;
              const conv = formatClickConversion(wrote, clicks);
              const shortLink = it.shortId ? igOrganicBotLink(it.shortId) : null;
              const linkPreview = it.targetUrls[0] ?? it.targetUrl;

              return (
                <li
                  key={it.id}
                  className={cn(
                    "rounded-xl border border-border/60 bg-background/50 p-3.5 sm:p-4",
                    !it.active && "opacity-60",
                  )}
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-pink-500/10 font-mono text-xs font-bold uppercase text-pink-600 dark:text-pink-400">
                      {it.codeword.slice(0, 3)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base font-semibold">«{it.codeword}»</span>
                        {!it.active && (
                          <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            выкл
                          </span>
                        )}
                      </div>
                      {linkPreview && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">{linkPreview}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{it.commentReplies.length} ответ.</span>
                        <span>{it.dmMessages.length} DM</span>
                        <span>{it.targetUrls.length} ссыл.</span>
                        <span>
                          {wrote} написали · {clicks} кликов · {st?.leads ?? 0} лидов · {conv}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(it)}
                        aria-label="Редактировать"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Switch
                        checked={it.active}
                        onCheckedChange={(v) => handleToggle(it, v)}
                        aria-label="Активность"
                      />
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(it)}
                        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {shortLink && (
                    <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-secondary/30 px-2.5 py-1.5">
                      <code className="min-w-0 flex-1 truncate text-[11px]">{shortLink}</code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => copyText(shortLink, "Ссылка")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Advanced collapsed */}
      <section className="rounded-2xl border border-border/60 bg-card/40">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-5 py-3.5 text-left text-sm font-medium"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          Для разработчиков · webhook n8n
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showAdvanced && "rotate-180")} />
        </button>
        {showAdvanced && (
          <div className="space-y-3 border-t border-border/50 px-5 pb-5 pt-3">
            <p className="text-xs text-muted-foreground">
              Обычный сценарий идёт через Instagram webhook MarkVision — n8n не обязателен.
            </p>
            <div className="flex items-center gap-2">
              <Input value={IG_ORGANIC_INTAKE_URL} readOnly className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyText(IG_ORGANIC_INTAKE_URL, "URL")}
                aria-label="Скопировать"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border/50 bg-secondary/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
{JSON.stringify(
  {
    token: intakeToken ?? "<PROJECT_TOKEN>",
    event_type: "codeword_comment",
    codeword: items[0]?.codeword || "хаб",
    username: "@user",
  },
  null,
  2,
)}
            </pre>
          </div>
        )}
      </section>

      {/* Composer */}
      <Dialog open={composerOpen} onOpenChange={(o) => { if (!o) closeComposer(); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEdit ? `Редактировать «${editing?.codeword}»` : "Новое код-слово"}</DialogTitle>
            <DialogDescription>
              Минимум: слово + ссылка. Остальное уже заполнено — можно сразу сохранить.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cw-word">1. Код-слово</Label>
              <Input
                id="cw-word"
                autoFocus
                placeholder="хаб"
                value={draft.codeword}
                onChange={(e) => setDraft((d) => ({ ...d, codeword: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    document.getElementById("cw-link")?.focus();
                  }
                }}
                className="text-base font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cw-link" className="inline-flex items-center gap-1.5">
                <MousePointerClick className="h-3.5 w-3.5 text-emerald-500" />
                2. Ссылка кнопки «{DM_ACCESS_BUTTON_TITLE}»
              </Label>
              <Input
                id="cw-link"
                type="url"
                placeholder="https://…"
                value={draft.targetUrls[0] ?? ""}
                onChange={(e) => {
                  const rest = draft.targetUrls.slice(1);
                  setDraft((d) => ({ ...d, targetUrls: [e.target.value, ...rest] }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Клики по кнопке считаем автоматически.
              </p>
            </div>

            {/* Live mini-preview */}
            <div className="rounded-xl border border-border/60 bg-secondary/20 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                Как увидит подписчик
              </div>
              <p>
                Пишет <span className="font-mono font-semibold text-foreground">«{previewWord}»</span>
                {" → "}
                ответ в комментарии
                {" → "}
                Direct: «{(draft.dmMessages[0] || DEFAULT_DM).slice(0, 48)}
                {(draft.dmMessages[0] || DEFAULT_DM).length > 48 ? "…" : ""}»
                {" + "}
                <span className="rounded bg-pink-500/15 px-1.5 py-0.5 font-semibold text-pink-600 dark:text-pink-400">
                  {DM_ACCESS_BUTTON_TITLE}
                </span>
              </p>
            </div>

            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowMoreTexts((v) => !v)}
            >
              <span className="inline-flex items-center gap-1.5">
                <MessageCircle className="h-3.5 w-3.5" />
                Тексты ответов и варианты
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showMoreTexts && "rotate-180")} />
            </button>

            {showMoreTexts && (
              <div className="space-y-4 rounded-xl border border-border/50 bg-background/40 p-3.5">
                <VariantListInput
                  label="Ответы на комментарий"
                  placeholder={DEFAULT_COMMENT}
                  items={draft.commentReplies}
                  onChange={(commentReplies) => setDraft((d) => ({ ...d, commentReplies }))}
                  multiline
                  compact
                />
                <VariantListInput
                  label="Текст над кнопкой в Direct"
                  placeholder={DEFAULT_DM}
                  items={draft.dmMessages}
                  onChange={(dmMessages) => setDraft((d) => ({ ...d, dmMessages }))}
                  multiline
                  compact
                />
                <VariantListInput
                  label="Дополнительные ссылки (рандом)"
                  placeholder="https://…"
                  items={draft.targetUrls}
                  onChange={(targetUrls) => setDraft((d) => ({ ...d, targetUrls }))}
                  compact
                />
                <div className="rounded-lg bg-pink-500/10 px-3 py-2 text-[11px] text-pink-700 dark:text-pink-300">
                  Кнопка всегда: <b>{DM_ACCESS_BUTTON_TITLE}</b> · до 10 вариантов, каждый раз случайный
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={closeComposer}>
              Отмена
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving || !projectId} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {isEdit ? "Сохранить" : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить код-слово?</AlertDialogTitle>
            <AlertDialogDescription>
              «{confirmDelete?.codeword}» больше не будет срабатывать. Статистика кликов сохранится.
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
