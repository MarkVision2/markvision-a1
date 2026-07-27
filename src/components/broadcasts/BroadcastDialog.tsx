import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  Loader2,
  MessageCircle,
  Send,
  Smartphone,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { fetchGroups, fetchGroupInvite, type WaGroup } from "@/lib/broadcastServer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULT_STAGES } from "@/hooks/useCrmStore";
import { filterCrmContacts } from "@/hooks/useBroadcasts";
import type { LeadContact } from "@/hooks/useLeadContacts";
import {
  CHANNEL_META,
  PACE_META,
  emptyBroadcastDraft,
  parseContacts,
  renderMessage,
  type AudienceSource,
  type Broadcast,
  type BroadcastChannel,
  type BroadcastDraft,
  type BroadcastPace,
} from "@/lib/broadcastStore";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  broadcast: Broadcast | null;
  crmContacts: LeadContact[];
  onSave: (draft: BroadcastDraft, recipientsCount: number) => void;
}

const inputCls =
  "w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50";

function draftFromBroadcast(b: Broadcast): BroadcastDraft {
  return {
    name: b.name,
    channel: b.channel,
    audienceSource: b.audienceSource,
    crmFilter: b.crmFilter,
    uploadedContacts: b.uploadedContacts,
    title: b.title,
    message: b.message,
    targetUrl: b.targetUrl,
    messageVariants: b.messageVariants,
    sendPace: b.sendPace,
    groupId: b.groupId,
    schedule: b.schedule,
    recipientsCount: b.recipientsCount,
  };
}

export function BroadcastDialog({ open, onOpenChange, broadcast, crmContacts, onSave }: Props) {
  const [draft, setDraft] = useState<BroadcastDraft>(emptyBroadcastDraft);
  const [pasted, setPasted] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const { activeId: projectId } = useProjectsStore();
  const [groups, setGroups] = useState<WaGroup[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (broadcast) {
      setDraft(draftFromBroadcast(broadcast));
      setPasted(broadcast.uploadedContacts.map((c) => `${c.name}${c.name ? ", " : ""}${c.phone}`).join("\n"));
    } else {
      setDraft(emptyBroadcastDraft());
      setPasted("");
    }
  }, [open, broadcast]);

  const patch = <K extends keyof BroadcastDraft>(key: K, value: BroadcastDraft[K]) =>
    setDraft((p) => ({ ...p, [key]: value }));

  // Доступные источники из базы CRM
  const sources = useMemo(() => {
    const set = new Map<string, number>();
    for (const c of crmContacts) {
      const s = c.source || "—";
      set.set(s, (set.get(s) ?? 0) + 1);
    }
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }, [crmContacts]);

  // Парсим вставленные контакты на лету
  const parsedUpload = useMemo(() => (draft.audienceSource === "upload" ? parseContacts(pasted) : []), [pasted, draft.audienceSource]);

  // Итоговое число получателей
  const recipientsCount = useMemo(() => {
    if (draft.audienceSource === "upload") return parsedUpload.length;
    return filterCrmContacts(crmContacts, draft.crmFilter.stageKeys, draft.crmFilter.sources).length;
  }, [draft.audienceSource, draft.crmFilter, parsedUpload, crmContacts]);

  const toggleStage = (key: string) => {
    const has = draft.crmFilter.stageKeys.includes(key);
    patch("crmFilter", {
      ...draft.crmFilter,
      stageKeys: has ? draft.crmFilter.stageKeys.filter((k) => k !== key) : [...draft.crmFilter.stageKeys, key],
    });
  };
  const toggleSource = (src: string) => {
    const has = draft.crmFilter.sources.includes(src);
    patch("crmFilter", {
      ...draft.crmFilter,
      sources: has ? draft.crmFilter.sources.filter((s) => s !== src) : [...draft.crmFilter.sources, src],
    });
  };

  const insertVar = () => patch("message", `${draft.message}{имя}`);
  const insertLink = () => patch("message", `${draft.message}{ссылка}`);

  // ── Рассылка со вступлением в WhatsApp-группу ──
  const loadGroups = async () => {
    if (!projectId) return;
    setGroupBusy(true);
    try {
      const list = await fetchGroups(projectId);
      setGroups(list);
      if (list.length === 0) toast("Групп не найдено — номер должен состоять в группе");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось получить группы");
    } finally {
      setGroupBusy(false);
    }
  };

  const pickGroup = async (groupId: string) => {
    if (!projectId || !groupId) return;
    setGroupBusy(true);
    try {
      const invite = await fetchGroupInvite(projectId, groupId);
      setDraft((p) => ({
        ...p,
        groupId,
        targetUrl: invite || p.targetUrl,
        message: /(\{ссылка\}|\{link\})/i.test(p.message)
          ? p.message
          : `${p.message}${p.message ? "\n\n" : ""}Вступить в группу: {ссылка}`,
      }));
      toast.success("Группа выбрана — ссылка на вступление подставлена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось получить ссылку группы");
    } finally {
      setGroupBusy(false);
    }
  };

  const clearGroup = () => setDraft((p) => ({ ...p, groupId: "" }));

  // Правка текста инвалидирует старые ИИ-варианты.
  const onMessageChange = (value: string) =>
    setDraft((p) => ({ ...p, message: value, messageVariants: [] }));

  // Генерация ИИ-вариантов (антиспам): каждому получателю уходит свой.
  const generateVariants = async () => {
    if (!draft.message.trim()) return;
    setGenLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("broadcast-ai-variants", {
        body: { message: draft.message, count: 20 },
      });
      if (error) throw new Error(error.message || "Ошибка генерации");
      const variants = ((data as { variants?: string[] } | null)?.variants ?? []).filter(Boolean);
      if (!variants.length) throw new Error("ИИ не вернул варианты");
      patch("messageVariants", variants);
      toast.success(`Готово: ${variants.length} вариантов — каждому получателю уйдёт свой`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сгенерировать");
    } finally {
      setGenLoading(false);
    }
  };

  const previewContact = useMemo(() => {
    if (draft.audienceSource === "upload") return parsedUpload[0] ?? { name: "Имя" };
    const list = filterCrmContacts(crmContacts, draft.crmFilter.stageKeys, draft.crmFilter.sources);
    return list[0] ?? { name: "Имя" };
  }, [draft, parsedUpload, crmContacts]);

  const needsLink = /(\{ссылка\}|\{link\})/i.test(draft.message);
  const canSave =
    draft.name.trim().length > 0 &&
    draft.message.trim().length > 0 &&
    recipientsCount > 0 &&
    (!needsLink || draft.targetUrl.trim().length > 0) &&
    (draft.schedule.mode === "now" || !!draft.schedule.at);

  const submit = () => {
    if (!canSave) return;
    const finalDraft: BroadcastDraft = {
      ...draft,
      name: draft.name.trim(),
      uploadedContacts: draft.audienceSource === "upload" ? parsedUpload : [],
      recipientsCount,
    };
    onSave(finalDraft, recipientsCount);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Send className="h-4 w-4" />
            </span>
            {broadcast ? "Настройка рассылки" : "Новая рассылка"}
          </DialogTitle>
          <DialogDescription>
            Отправьте сообщение по базе CRM или загруженному списку контактов.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Название */}
          <Field label="Название рассылки">
            <input
              value={draft.name}
              onChange={(e) => patch("name", e.target.value)}
              placeholder="Например: Акция на имплантацию — март"
              maxLength={80}
              className={inputCls}
            />
          </Field>

          {/* Канал */}
          <Field label="Канал отправки">
            <div className="grid grid-cols-2 gap-2">
              {(["whatsapp", "sms"] as BroadcastChannel[]).map((ch) => {
                const active = draft.channel === ch;
                const Icon = ch === "whatsapp" ? MessageCircle : Smartphone;
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => patch("channel", ch)}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/60 bg-background/40 hover:bg-secondary/40",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="h-4 w-4" />
                      {CHANNEL_META[ch].label}
                    </span>
                    <span className={cn("text-[11px]", CHANNEL_META[ch].available ? "text-muted-foreground" : "text-warning")}>
                      {CHANNEL_META[ch].note}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Аудитория */}
          <Field label="Кому отправляем">
            <div className="mb-2 grid grid-cols-2 gap-2">
              {([
                { id: "crm", label: "База CRM", icon: Users },
                { id: "upload", label: "Загрузить список", icon: Upload },
              ] as { id: AudienceSource; label: string; icon: typeof Users }[]).map((a) => {
                const active = draft.audienceSource === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => patch("audienceSource", a.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/60 bg-background/40 text-muted-foreground hover:bg-secondary/40",
                    )}
                  >
                    <a.icon className="h-4 w-4" />
                    {a.label}
                  </button>
                );
              })}
            </div>

            {draft.audienceSource === "crm" ? (
              <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-3">
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Этапы воронки
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {DEFAULT_STAGES.map((s) => {
                      const active = draft.crmFilter.stageKeys.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleStage(s.id)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                            active
                              ? "border-primary/60 bg-primary/10 text-primary"
                              : "border-border/60 text-muted-foreground hover:bg-secondary/40",
                          )}
                        >
                          {s.title}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">Не выбрано — значит все этапы.</p>
                </div>

                {sources.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Источники
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {sources.slice(0, 12).map(([src, count]) => {
                        const active = draft.crmFilter.sources.includes(src);
                        return (
                          <button
                            key={src}
                            type="button"
                            onClick={() => toggleSource(src)}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                              active
                                ? "border-primary/60 bg-primary/10 text-primary"
                                : "border-border/60 text-muted-foreground hover:bg-secondary/40",
                            )}
                          >
                            {src} <span className="opacity-60">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={5}
                  placeholder={"Вставьте контакты, по одному в строке:\nИван, +7 700 123 45 67\nАйгерим, +7 701 765 43 21\n+7 702 000 00 00"}
                  className={cn(inputCls, "resize-y font-mono text-xs")}
                />
                <p className="text-[11px] text-muted-foreground">
                  Формат: «Имя, номер» или просто номер. Дубликаты убираются автоматически.
                </p>
              </div>
            )}

            <div className="mt-2 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
              <Users className="h-3.5 w-3.5" />
              Получателей: {recipientsCount}
            </div>
          </Field>

          {/* Сообщение */}
          <Field label="Сообщение">
            <input
              value={draft.title}
              onChange={(e) => patch("title", e.target.value)}
              placeholder="Заголовок (необязательно)"
              maxLength={120}
              className={cn(inputCls, "mb-2 font-semibold")}
            />
            <textarea
              value={draft.message}
              onChange={(e) => onMessageChange(e.target.value)}
              rows={5}
              placeholder="Здравствуйте, {имя}! У нас для вас специальное предложение…"
              className={cn(inputCls, "resize-y")}
            />
            <div className="mt-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={insertVar}
                  className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  + {"{имя}"}
                </button>
                <button
                  type="button"
                  onClick={insertLink}
                  className="rounded-md border border-border/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  + {"{ссылка}"}
                </button>
              </div>
              <span className="text-[11px] text-muted-foreground">{draft.message.length} симв.</span>
            </div>

            {/* ИИ-варианты против спама */}
            <div className="mt-2">
              {draft.messageVariants.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-[11px]">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-success" />
                  <span className="font-semibold text-success">{draft.messageVariants.length} ИИ-вариантов</span>
                  <span className="text-muted-foreground">— каждому уходит свой, не как спам</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={generateVariants}
                      disabled={genLoading}
                      className="rounded-md border border-border/60 px-2 py-0.5 font-medium transition-colors hover:bg-secondary/60 disabled:opacity-60"
                    >
                      {genLoading ? "…" : "Обновить"}
                    </button>
                    <button
                      type="button"
                      onClick={() => patch("messageVariants", [])}
                      className="rounded-md border border-border/60 px-2 py-0.5 font-medium transition-colors hover:bg-secondary/60"
                    >
                      Убрать
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={generateVariants}
                  disabled={genLoading || !draft.message.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  {genLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  ИИ-варианты против спама
                </button>
              )}
              <p className="mt-1 text-[10px] text-muted-foreground">
                ИИ перепишет текст в разные формулировки (приветствие, порядок слов) — массовая отправка
                не выглядит одинаково и реже ловит спам-фильтры.
              </p>
            </div>

            {draft.message.trim() && (
              <div className="mt-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Предпросмотр
                </div>
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {renderMessage(draft.title, draft.message, previewContact, draft.targetUrl).replace(/\*(.+?)\*/g, "$1")}
                </div>
              </div>
            )}
          </Field>

          {/* Вступление в WhatsApp-группу */}
          <Field label="Вступление в WhatsApp-группу (необязательно)">
            {draft.groupId ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-xs">
                <Users className="h-3.5 w-3.5 shrink-0 text-success" />
                <span className="font-semibold text-success">Группа выбрана</span>
                <span className="truncate text-muted-foreground">
                  {groups.find((g) => g.id === draft.groupId)?.name ?? draft.groupId}
                </span>
                <button
                  type="button"
                  onClick={clearGroup}
                  className="ml-auto rounded-md border border-border/60 px-2 py-0.5 font-medium transition-colors hover:bg-secondary/60"
                >
                  Убрать
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={loadGroups}
                  disabled={groupBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  {groupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                  Выбрать группу
                </button>
                {groups.length > 0 && (
                  <select
                    onChange={(e) => pickGroup(e.target.value)}
                    defaultValue=""
                    className={inputCls}
                  >
                    <option value="" disabled>Выберите группу…</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground">
              Выберите группу — ссылка на вступление подставится в {"{ссылка}"} автоматически, а мы посчитаем,
              кто реально перешёл и <b>вступил в группу</b>.
            </p>
          </Field>

          {/* Ссылка для {ссылка} — трекинг переходов */}
          {/(\{ссылка\}|\{link\})/i.test(draft.message) && (
            <Field label="Ссылка для перехода">
              <input
                value={draft.targetUrl}
                onChange={(e) => patch("targetUrl", e.target.value)}
                placeholder="https://ваш-сайт.kz/promo"
                className={inputCls}
              />
              <p className="text-[11px] text-muted-foreground">
                {"{ссылка}"} в тексте станет короткой трекинг-ссылкой — переход клиента отметится как «перешёл».
              </p>
            </Field>
          )}

          {/* Расписание */}
          <Field label="Когда отправить">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => patch("schedule", { mode: "now", at: null })}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                  draft.schedule.mode === "now"
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 bg-background/40 text-muted-foreground hover:bg-secondary/40",
                )}
              >
                <Send className="h-4 w-4" />
                Сразу
              </button>
              <button
                type="button"
                onClick={() => patch("schedule", { mode: "scheduled", at: draft.schedule.at })}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                  draft.schedule.mode === "scheduled"
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 bg-background/40 text-muted-foreground hover:bg-secondary/40",
                )}
              >
                <Clock className="h-4 w-4" />
                По расписанию
              </button>
            </div>
            {draft.schedule.mode === "scheduled" && (
              <input
                type="datetime-local"
                value={draft.schedule.at ?? ""}
                onChange={(e) => patch("schedule", { mode: "scheduled", at: e.target.value })}
                className={cn(inputCls, "mt-2")}
              />
            )}
          </Field>

          {/* Темп отправки */}
          <Field label="Темп отправки">
            <div className="grid grid-cols-3 gap-2">
              {(["slow", "medium", "fast"] as BroadcastPace[]).map((p) => {
                const active = draft.sendPace === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => patch("sendPace", p)}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors",
                      active ? "border-primary/60 bg-primary/10" : "border-border/60 bg-background/40 hover:bg-secondary/40",
                    )}
                  >
                    <span className="text-sm font-semibold">{PACE_META[p].label}</span>
                    <span className="text-[10px] text-muted-foreground">{PACE_META[p].hint}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Сервер отправляет капельно с рандомными паузами. Чем медленнее — тем безопаснее для номера.
            </p>
          </Field>
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!canSave} className="bg-gradient-primary text-primary-foreground">
            {broadcast ? "Сохранить" : "Создать рассылку"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold">{label}</label>
      {children}
    </div>
  );
}
