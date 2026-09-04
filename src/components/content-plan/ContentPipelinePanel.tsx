import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, Check, Clapperboard, Layers, Loader2, RefreshCw, Sparkles, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useContentPipeline } from "@/hooks/useContentPipeline";
import {
  formatDuration,
  isActivePipelineState,
  loadPersonas,
  loadPublishGroups,
  PIPELINE_ENGINE_META,
  PIPELINE_STATE_META,
  PIPELINE_STEPS,
  pipelineStepIndex,
  runDurationSeconds,
  type PipelineDetail,
  type PipelineEngine,
  type PipelineRun,
  type PipelineSettingsInput,
} from "@/lib/contentPipeline";
import { cn } from "@/lib/utils";

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
}

function StateBadge({ run }: { run: PipelineRun }) {
  const meta = PIPELINE_STATE_META[run.state];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.cls)}>
      {isActivePipelineState(run.state) && <Loader2 className="h-3 w-3 animate-spin" />}
      {meta.label}
    </span>
  );
}

function Steps({ run }: { run: PipelineRun | null }) {
  const idx = pipelineStepIndex(run?.state);
  const failed = run?.state === "failed" || run?.state === "cancelled";
  return (
    <ol className="grid grid-cols-6 gap-1 text-[11px]" aria-label="Этапы">
      {PIPELINE_STEPS.map((label, i) => {
        const done = i < idx;
        const current = i === idx && !!run && !failed;
        return (
          <li key={label} className="flex flex-col gap-1">
            <div
              className={cn(
                "h-1.5 rounded-full",
                done ? "bg-emerald-500" : current ? "bg-amber-500" : failed && i === idx ? "bg-destructive" : "bg-muted",
              )}
            />
            <span className={cn("truncate", current ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ScriptBlock({ detail }: { detail: PipelineDetail }) {
  const s = detail.script;
  if (!s) {
    return <p className="text-sm text-muted-foreground">Сценарий появится после этапа «Сценарий».</p>;
  }
  return (
    <div className="space-y-2 text-sm">
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Заголовок</span>
        <div className="font-medium">{s.title}</div>
      </div>
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Хук</span>
        <div>{s.hook}</div>
      </div>
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Текст озвучки</span>
        <p className="whitespace-pre-wrap leading-relaxed">{s.script}</p>
      </div>
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Описание</span>
        <p className="whitespace-pre-wrap">{s.description}</p>
      </div>
      <div className="text-xs text-muted-foreground">{s.hashtags.join(" ")}</div>
    </div>
  );
}

function VariantsBlock({ detail, busy, onCreate }: {
  detail: PipelineDetail;
  busy: boolean;
  onCreate: (groupIds: string[]) => Promise<unknown>;
}) {
  const [groups, setGroups] = useState<{ id: string; name: string; review_mode?: string }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadPublishGroups(detail.item.project_id).then((g) => { if (alive) setGroups(g); });
    return () => { alive = false; };
  }, [open, detail.item.project_id]);
  const taken = new Set(detail.variants.map((v) => v.target_group_id));
  if (detail.item.parent_item_id) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-pink-500" />
          Варианты под группы аккаунтов
          <span className="text-xs font-normal text-muted-foreground">
            {detail.variants.length ? `${detail.variants.length} шт.` : "разные персоны и подписи для разных групп"}
          </span>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen((v) => !v)}>Создать варианты</Button>
      </div>
      {open && (
        <div className="space-y-2 text-sm">
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">Групп аккаунтов пока нет — создайте их на странице «Публикации».</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => {
                const disabled = taken.has(g.id);
                const on = picked.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={disabled}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      disabled ? "opacity-50" : on ? "border-pink-500 bg-pink-500/10" : "border-border",
                    )}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== g.id) : [...p, g.id]))}
                  >
                    {g.name}{disabled ? " · есть" : ""}
                  </button>
                );
              })}
            </div>
          )}
          <Button
            size="sm"
            disabled={busy || picked.length === 0}
            onClick={() => void onCreate(picked).then(() => { setPicked([]); setOpen(false); })}
          >
            Создать для выбранных ({picked.length})
          </Button>
        </div>
      )}
      {detail.variants.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 text-sm">
          {detail.variants.map((v) => {
            const st = v.pipeline_runs?.state;
            return (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                <Link to={`/marketing/content-plan/${v.id}`} className="font-medium underline-offset-2 hover:underline">
                  {v.publish_account_groups?.name ?? "без группы"}
                </Link>
                {st && (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", PIPELINE_STATE_META[st].cls)}>
                    {PIPELINE_STATE_META[st].label}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{v.engine ? PIPELINE_ENGINE_META[v.engine].label : ""}</span>
                {v.publish_video_id && <span className="text-xs text-emerald-700">в библиотеке публикации</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const NONE = "__none__";

/**
 * Цель и движок темы: группа аккаунтов (куда уйдёт ролик после одобрения),
 * персона (голос/аватар/тон) и движок рендера. Редактируется пока запуск не
 * идёт — воркер читает эти поля в момент claim.
 */
function TargetBlock({ detail, busy, onSave }: {
  detail: PipelineDetail;
  busy: boolean;
  onSave: (input: PipelineSettingsInput) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<{ id: string; name: string; review_mode?: string }[]>([]);
  const [personas, setPersonas] = useState<{ id: string; name: string; engine_default?: PipelineEngine }[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([loadPublishGroups(detail.item.project_id), loadPersonas(detail.item.project_id)]).then(([g, p]) => {
      if (!alive) return;
      setGroups(g);
      setPersonas(p);
    });
    return () => { alive = false; };
  }, [open, detail.item.project_id]);
  const active = isActivePipelineState(detail.current_run?.state);
  if (active) return null;
  return (
    <div className="rounded-xl border border-border/60 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Цель и движок</div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen((v) => !v)}>{open ? "Скрыть" : "Изменить"}</Button>
      </div>
      {open && (
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Движок</Label>
            <Select value={detail.item.engine} disabled={busy} onValueChange={(v) => void onSave({ engine: v as PipelineEngine })}>
              <SelectTrigger aria-label="Движок" className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PIPELINE_ENGINE_META) as PipelineEngine[]).map((e) => (
                  <SelectItem key={e} value={e}>{PIPELINE_ENGINE_META[e].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Группа аккаунтов</Label>
            <Select value={detail.item.target_group_id ?? NONE} disabled={busy} onValueChange={(v) => void onSave({ target_group_id: v === NONE ? null : v })}>
              <SelectTrigger aria-label="Группа аккаунтов" className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Без группы (в очередь без автопубликации)</SelectItem>
                {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}{g.review_mode === "auto_publish" ? " · авто" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Персона</Label>
            <Select value={detail.item.persona_id ?? NONE} disabled={busy} onValueChange={(v) => void onSave({ persona_id: v === NONE ? null : v })}>
              <SelectTrigger aria-label="Персона" className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Без персоны</SelectItem>
                {personas.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContentPipelinePanel({ itemId, enabled = true }: { itemId: string; enabled?: boolean }) {
  const { detail, loading, error, busy, refetch, generate, approve, reject, retry, cancel, variants, settings } =
    useContentPipeline(itemId, enabled);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState("");

  const run = detail?.current_run ?? null;
  const video = detail?.assets.find((a) => a.asset_type === "normalized_video")?.public_url ?? detail?.item.media_url ?? null;

  const wrap = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const onReject = async () => {
    if (!comment.trim()) {
      toast.error("Напишите, что переделать");
      return;
    }
    await wrap("Отклонено — тема вернулась в очередь", () => reject(comment.trim()));
    setRejectOpen(false);
    setComment("");
  };

  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        AI-видео собирается только для типа Reels.
      </p>
    );
  }

  if (!detail && loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загружаем состояние конвейера…
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          {error ?? "Не удалось получить состояние."}{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>Обновить</button>
        </div>
      </div>
    );
  }

  const { can } = detail;
  const disabled = busy != null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Clapperboard className="h-4 w-4 text-pink-500" />
          AI-видео (сценарий → HeyGen → согласование)
          {run && <StateBadge run={run} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {can.generate && (
            <Button size="sm" className="gap-1" disabled={disabled} onClick={() => void wrap("Поставлено в очередь", generate)}>
              {busy === "generate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Сгенерировать
            </Button>
          )}
          {can.retry && (
            <Button size="sm" variant="outline" className="gap-1" disabled={disabled} onClick={() => void wrap("Новая попытка поставлена в очередь", () => retry())}>
              {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Повторить
            </Button>
          )}
          {can.review && (
            <>
              <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={disabled} onClick={() => void wrap("Одобрено", approve)}>
                {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Одобрить
              </Button>
              <Button size="sm" variant="outline" className="gap-1 text-destructive" disabled={disabled} onClick={() => setRejectOpen((v) => !v)}>
                <X className="h-3.5 w-3.5" />
                Отклонить
              </Button>
            </>
          )}
          {can.cancel && (
            <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" disabled={disabled} onClick={() => void wrap("Отменено", cancel)}>
              <XCircle className="h-3.5 w-3.5" />
              Отменить
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refetch()} aria-label="Обновить">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {rejectOpen && (
        <div className="space-y-2 rounded-xl border border-border/60 p-3">
          <Label>Что переделать (обязательно)</Label>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Например: слишком длинно, убрать обещания, другой хук" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={disabled} onClick={() => void onReject()}>
              {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Отправить на переработку
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejectOpen(false)}>Отмена</Button>
          </div>
        </div>
      )}

      <Steps run={run} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Движок <span className="font-semibold text-foreground">{PIPELINE_ENGINE_META[detail.item.engine]?.label ?? detail.item.engine}</span></span>
        {detail.item.target_group_name && (
          <span>Группа <span className="font-semibold text-foreground">{detail.item.target_group_name}</span>
            {detail.item.review_mode === "auto_publish" ? " · автопубликация" : ""}
          </span>
        )}
        {detail.item.persona_name && <span>Персона <span className="font-semibold text-foreground">{detail.item.persona_name}</span></span>}
        {detail.item.parent_item_id && (
          <Link to={`/marketing/content-plan/${detail.item.parent_item_id}`} className="underline">исходная тема</Link>
        )}
        {detail.item.publish_video_id && <span className="text-emerald-700">передано в публикацию</span>}
      </div>

      <TargetBlock detail={detail} busy={disabled} onSave={(input) => wrap("Настройки темы сохранены", () => settings(input))} />

      <VariantsBlock detail={detail} busy={disabled} onCreate={(ids) => wrap("Варианты созданы и поставлены в очередь", () => variants(ids))} />

      {run ? (
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
          <div>Попытка <span className="font-semibold text-foreground">{run.attempt}</span></div>
          <div>Начало <span className="font-semibold text-foreground">{fmtWhen(run.started_at)}</span></div>
          <div>Длительность <span className="font-semibold text-foreground">{formatDuration(runDurationSeconds(run))}</span></div>
          <div>Расход <span className="font-semibold text-foreground">${run.cost_usd.toFixed(3)}</span></div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Генерация ещё не запускалась. Нажмите «Сгенерировать» — тема встанет в очередь, обработка займёт несколько минут.
        </p>
      )}

      {run?.error_user && (run.state === "failed" || run.state === "retry_wait") && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <div>{run.error_user}</div>
            {run.state === "retry_wait" && run.next_retry_at && (
              <div className="mt-1 text-xs text-muted-foreground">Повтор: {fmtWhen(run.next_retry_at)}</div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-black/90">
          {video ? (
            <video src={video} controls className="aspect-[9/16] max-h-[60vh] w-full object-contain" />
          ) : (
            <div className="grid aspect-[9/16] max-h-[60vh] place-items-center text-sm text-muted-foreground">
              Превью появится после нормализации
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-border/60 p-4">
          <ScriptBlock detail={detail} />
        </div>
      </div>

      {(detail.runs.length > 0 || detail.reviews.length > 0) && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">История попыток и решений</div>
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
            {detail.runs.map((r) => {
              const review = detail.reviews.find((rv) => rv.pipeline_run_id === r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="text-xs text-muted-foreground">{fmtWhen(r.started_at)}</span>
                  <StateBadge run={r} />
                  <span className="text-xs text-muted-foreground">попытка {r.attempt} · {formatDuration(runDurationSeconds(r))}</span>
                  {r.error_user && (r.state === "failed") && <span className="text-xs text-destructive">{r.error_user}</span>}
                  {review && (
                    <span className="text-xs">
                      {review.decision === "approved" ? "✅" : "❌"} {review.reviewer_label ?? review.source}
                      {review.comment ? `: «${review.comment}»` : ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
