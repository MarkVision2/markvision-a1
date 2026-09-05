import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, FileVideo, Inbox, Link2, Loader2, Send, Sparkles, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ACCEPT_VIDEO, formatBytes, uploadPublishVideo, validateVideoFile } from "@/lib/publishingUpload";
import {
  buildPostInfo,
  consentText,
  type CreatorInfo,
  emptyPostForm,
  errorText,
  isFinalStage,
  type Lang,
  type PostForm,
  type PostMode,
  PRIVACY_LABELS,
  type PublishStatusResponse,
  STAGE_LABELS,
  stageProgress,
  t,
  tiktokApi,
  type TikTokAccount,
  TITLE_LIMIT,
} from "@/lib/tiktokClient";

interface Props {
  projectId: string;
  account: TikTokAccount | null;
  lang: Lang;
  /** Вызывается после успешной публикации — чтобы лента видео перечиталась. */
  onPublished?: () => void;
}

type VideoSource = { url: string; name: string; size: number | null; pull: boolean } | null;

/**
 * Content Posting API: форма прямой публикации / черновика во «Входящие».
 * Порядок и элементы — по UX-гайду площадки: имя автора из creator_info,
 * приватность выбирает пользователь, выключенные автором взаимодействия
 * нельзя включить, раскрытие коммерческого контента, согласие под кнопкой.
 */
export function TikTokPostComposer({ projectId, account, lang, onPublished }: Props) {
  const [mode, setMode] = useState<PostMode>("direct");
  const [form, setForm] = useState<PostForm>(emptyPostForm);
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [creatorError, setCreatorError] = useState<string | null>(null);
  const [creatorLoading, setCreatorLoading] = useState(false);
  const [source, setSource] = useState<VideoSource>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [startMessage, setStartMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<PublishStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  const patch = (p: Partial<PostForm>) => setForm((f) => ({ ...f, ...p }));

  // creator_info — при смене аккаунта: имя автора и доступные уровни приватности.
  useEffect(() => {
    setCreator(null);
    setCreatorError(null);
    patch({ privacy_level: null });
    if (!account) return;
    let alive = true;
    setCreatorLoading(true);
    tiktokApi.creatorInfo(projectId, account.id)
      .then((r) => { if (alive) setCreator(r.creator); })
      .catch((e) => { if (alive) setCreatorError(errorText(e, lang)); })
      .finally(() => { if (alive) setCreatorLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, account?.id]);

  // Опрос статуса каждые 3 с до финальной стадии.
  useEffect(() => {
    if (!publishId || !account) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await tiktokApi.publishStatus(projectId, account.id, publishId);
        if (!alive) return;
        setStatus(r);
        setStatusError(null);
        if (isFinalStage(r.status)) {
          if (r.status === "PUBLISH_COMPLETE" || r.status === "SEND_TO_USER_INBOX") onPublished?.();
          return;
        }
      } catch (e) {
        if (alive) setStatusError(errorText(e, lang));
      }
      if (alive) pollRef.current = window.setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      alive = false;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishId, account?.id]);

  const pickFile = async (file: File | null) => {
    if (!file) return;
    const invalid = validateVideoFile(file);
    if (invalid) { toast.error(invalid); return; }
    setUploadPct(0);
    try {
      const { url } = await uploadPublishVideo(projectId, file, setUploadPct);
      setSource({ url, name: file.name, size: file.size, pull: false });
      setUrlDraft("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadPct(null);
    }
  };

  const useUrl = () => {
    const u = urlDraft.trim();
    if (!/^https:\/\//.test(u)) { toast.error(lang === "ru" ? "Нужна https-ссылка" : "An https link is required"); return; }
    setSource({ url: u, name: u.split("/").pop()?.split("?")[0] || u, size: null, pull: false });
  };

  const validation = useMemo(() => {
    if (mode !== "direct" || !creator) return null;
    const r = buildPostInfo(form, creator);
    // «in» вместо r.ok: без strictNullChecks дискриминант boolean не сужает union.
    return "error" in r ? r.error[lang] : null;
  }, [form, creator, mode, lang]);

  const canSubmit = Boolean(account && source && !busy && (mode === "inbox" || (creator && !validation)));

  const submit = async () => {
    if (!account) { toast.error(t("needAccount", lang)); return; }
    if (!source) { toast.error(t("needVideo", lang)); return; }
    setBusy(true);
    setStatus(null);
    setStatusError(null);
    try {
      const r = await tiktokApi.publish(projectId, {
        account_id: account.id,
        mode,
        source: source.pull ? "url" : "file",
        video_url: source.url,
        form,
        lang,
      });
      setPublishId(r.publish_id);
      setStartMessage(r.message);
      toast.success(lang === "ru" ? "Отправлено в TikTok" : "Sent to TikTok");
    } catch (e) {
      toast.error(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPublishId(null);
    setStatus(null);
    setStatusError(null);
    setStartMessage(null);
    setSource(null);
    setForm(emptyPostForm());
  };

  const privacyOptions = creator?.privacy_level_options ?? [];
  const showBrandedWarning = form.commercial_content && form.branded_content && form.privacy_level === "SELF_ONLY";

  /* ─────────────── статус после отправки ─────────────── */
  if (publishId) {
    const stage = status?.status ?? "UNKNOWN";
    const done = status ? isFinalStage(stage) : false;
    const failed = stage === "FAILED";
    return (
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", failed ? "bg-destructive/10 text-destructive" : done ? "bg-emerald-500/10 text-emerald-600" : "bg-pink-500/10 text-pink-600")}>
            {failed ? <XCircle className="h-5 w-5" /> : done ? <CheckCircle2 className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{t("statusTitle", lang)}</h3>
            <p className="text-sm text-muted-foreground">{status ? STAGE_LABELS[stage][lang] : startMessage}</p>
            <Progress value={status ? stageProgress(stage) : 10} className={cn("mt-3 h-2", failed && "[&>div]:bg-destructive", done && !failed && "[&>div]:bg-emerald-500")} />
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <div><span className="font-medium">{t("publishId", lang)}:</span> <code className="font-mono">{publishId}</code></div>
              {status?.uploaded_bytes != null && status.uploaded_bytes > 0 && !done && <div>{formatBytes(status.uploaded_bytes)}</div>}
              {!done && <div>{t("processingNote", lang)}</div>}
            </div>
            {failed && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{status?.fail_explained?.[lang] ?? status?.fail_reason ?? "—"}</span>
              </div>
            )}
            {stage === "SEND_TO_USER_INBOX" && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{t("inboxDone", lang)}</span>
              </div>
            )}
            {statusError && <p className="mt-2 text-xs text-destructive">{statusError}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {status?.post_url && (
                <Button asChild size="sm">
                  <a href={status.post_url} target="_blank" rel="noreferrer noopener"><ExternalLink className="mr-1.5 h-4 w-4" />{t("openPost", lang)}</a>
                </Button>
              )}
              {done && <Button variant="outline" size="sm" onClick={reset}>{t("newPost", lang)}</Button>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────── форма ─────────────── */
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-5 rounded-2xl border bg-card p-5">
        {/* Режим */}
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            { id: "direct" as PostMode, icon: Send, label: t("modeDirect", lang), hint: t("modeDirectHint", lang), scope: "video.publish" },
            { id: "inbox" as PostMode, icon: Inbox, label: t("modeInbox", lang), hint: t("modeInboxHint", lang), scope: "video.upload" },
          ]).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 text-left transition",
                mode === m.id ? "border-pink-500 bg-pink-500/5 ring-1 ring-pink-500" : "hover:bg-muted/50",
              )}
            >
              <m.icon className={cn("mt-0.5 h-4 w-4 shrink-0", mode === m.id ? "text-pink-600" : "text-muted-foreground")} />
              <span>
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-muted-foreground">{m.hint}</span>
                <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{m.scope}</code>
              </span>
            </button>
          ))}
        </div>

        {/* Автор */}
        {mode === "direct" && (
          <div className="flex items-center gap-3 rounded-xl bg-muted/40 p-3">
            {creatorLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
              <Avatar className="h-9 w-9">
                <AvatarImage src={creator?.avatar_url ?? undefined} />
                <AvatarFallback>{(creator?.nickname ?? account?.account_name ?? "T").slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <div className="text-xs text-muted-foreground">{t("postingAs", lang)}</div>
              <div className="truncate font-semibold">{creator?.nickname ?? account?.account_name ?? t("notConnected", lang)}{creator?.username ? <span className="font-normal text-muted-foreground"> · @{creator.username}</span> : null}</div>
              {creator?.max_video_post_duration_sec != null && (
                <div className="text-[11px] text-muted-foreground">{lang === "ru" ? "макс. длительность" : "max duration"}: {Math.round(creator.max_video_post_duration_sec / 60)} {lang === "ru" ? "мин" : "min"}</div>
              )}
            </div>
            {creatorError && <span className="text-xs text-destructive">{creatorError}</span>}
          </div>
        )}

        {/* Видео */}
        <div className="space-y-2">
          <Label>{t("videoSource", lang)}</Label>
          <input ref={fileRef} type="file" accept={ACCEPT_VIDEO} className="hidden" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
          {source ? (
            <div className="flex items-center gap-3 rounded-xl border p-3">
              <FileVideo className="h-5 w-5 shrink-0 text-pink-600" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">{source.name}</div>
                <div className="text-xs text-muted-foreground">{source.size != null ? formatBytes(source.size) : source.url}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSource(null)}>✕</Button>
            </div>
          ) : uploadPct != null ? (
            <div className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground"><span>{t("uploading", lang)}</span><span>{uploadPct}%</span></div>
              <Progress value={uploadPct} className="h-2" />
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition hover:border-pink-500/60 hover:bg-pink-500/5"
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">{t("chooseFile", lang)}</span>
                <span className="text-xs text-muted-foreground">MP4 / MOV</span>
              </button>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder={t("orPasteUrl", lang)} className="pl-9" />
                </div>
                <Button variant="outline" onClick={useUrl} disabled={!urlDraft.trim()}>OK</Button>
              </div>
            </div>
          )}
          {source && (
            <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
              <Checkbox checked={source.pull} onCheckedChange={(v) => setSource({ ...source, pull: Boolean(v) })} className="mt-0.5" />
              <span><span className="font-medium text-foreground">{t("pullFromUrl", lang)}</span><br />{t("urlSourceHint", lang)}</span>
            </label>
          )}
        </div>

        {mode === "direct" && (
          <>
            {/* Заголовок */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="tt-title">{t("titleLabel", lang)}</Label>
                <span className={cn("text-[11px] tabular-nums", form.title.length > TITLE_LIMIT ? "text-destructive" : "text-muted-foreground")}>{form.title.length} / {TITLE_LIMIT}</span>
              </div>
              <Textarea id="tt-title" rows={3} value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t("titlePlaceholder", lang)} />
            </div>

            {/* Приватность */}
            <div className="space-y-2">
              <Label>{t("privacyLabel", lang)}</Label>
              <Select value={form.privacy_level ?? ""} onValueChange={(v) => patch({ privacy_level: v })} disabled={!creator}>
                <SelectTrigger><SelectValue placeholder={t("privacyPlaceholder", lang)} /></SelectTrigger>
                <SelectContent>
                  {privacyOptions.map((o) => (
                    <SelectItem key={o} value={o}>
                      <span className="font-medium">{PRIVACY_LABELS[o]?.[lang] ?? o}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{PRIVACY_LABELS[o]?.hint[lang] ?? ""}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showBrandedWarning && (
                <p className="text-xs text-destructive">{lang === "ru" ? "Брендированный контент нельзя публиковать только для себя — выберите другую видимость." : "Branded content can't be private — choose another visibility."}</p>
              )}
            </div>

            {/* Взаимодействия */}
            <div className="space-y-2">
              <Label>{t("interactions", lang)}</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {([
                  { key: "allow_comment" as const, label: t("allowComment", lang), off: creator?.comment_disabled },
                  { key: "allow_duet" as const, label: t("allowDuet", lang), off: creator?.duet_disabled },
                  { key: "allow_stitch" as const, label: t("allowStitch", lang), off: creator?.stitch_disabled },
                ]).map((i) => (
                  <label key={i.key} className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm", i.off && "opacity-60")}>
                    <span>
                      {i.label}
                      {i.off && <span className="block text-[10px] text-muted-foreground">{t("disabledByCreator", lang)}</span>}
                    </span>
                    <Switch checked={i.off ? false : form[i.key]} disabled={Boolean(i.off)} onCheckedChange={(v) => patch({ [i.key]: v } as Partial<PostForm>)} />
                  </label>
                ))}
              </div>
            </div>

            {/* Коммерческий контент */}
            <div className="space-y-3 rounded-xl border p-3">
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium">{t("commercial", lang)}</span>
                  <span className="block text-xs text-muted-foreground">{t("commercialHint", lang)}</span>
                </span>
                <Switch checked={form.commercial_content} onCheckedChange={(v) => patch({ commercial_content: v, ...(v ? {} : { your_brand: false, branded_content: false }) })} />
              </label>
              {form.commercial_content && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm">
                    <Checkbox checked={form.your_brand} onCheckedChange={(v) => patch({ your_brand: Boolean(v) })} className="mt-0.5" />
                    <span><span className="block font-medium">{t("yourBrand", lang)}</span><span className="block text-xs text-muted-foreground">{t("yourBrandHint", lang)}</span></span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm">
                    <Checkbox checked={form.branded_content} onCheckedChange={(v) => patch({ branded_content: Boolean(v) })} className="mt-0.5" />
                    <span><span className="block font-medium">{t("brandedContent", lang)}</span><span className="block text-xs text-muted-foreground">{t("brandedContentHint", lang)}</span></span>
                  </label>
                </div>
              )}
            </div>

            {/* AIGC */}
            <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <span className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                <span>
                  <span className="block text-sm font-medium">{t("aigc", lang)}</span>
                  <span className="block text-xs text-muted-foreground">{t("aigcHint", lang)}</span>
                </span>
              </span>
              <Switch checked={form.ai_generated} onCheckedChange={(v) => patch({ ai_generated: v })} />
            </label>
          </>
        )}

        {/* Кнопка и согласие */}
        <div className="space-y-2 border-t pt-4">
          {validation && source && <p className="text-xs text-amber-600">{validation}</p>}
          <Button className="w-full bg-black text-white hover:bg-neutral-900 dark:ring-1 dark:ring-white/15" size="lg" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : mode === "direct" ? <Send className="mr-2 h-4 w-4" /> : <Inbox className="mr-2 h-4 w-4" />}
            {mode === "direct" ? t("publish", lang) : t("sendDraft", lang)}
          </Button>
          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            {mode === "direct" ? consentText(form, lang) : t("inboxDone", lang)}
          </p>
        </div>
      </div>

      {/* Превью поста */}
      <PostPreview form={form} mode={mode} creator={creator} account={account} sourceName={source?.name ?? null} lang={lang} />
    </div>
  );
}

/** Как это будет выглядеть в TikTok — телефон с подписью, автором и метками. */
function PostPreview({ form, mode, creator, account, sourceName, lang }: { form: PostForm; mode: PostMode; creator: CreatorInfo | null; account: TikTokAccount | null; sourceName: string | null; lang: Lang }) {
  const name = creator?.username ? `@${creator.username}` : account?.handle ? `@${account.handle}` : account?.account_name ?? "@tiktok";
  const labels: string[] = [];
  if (form.commercial_content && form.branded_content) labels.push(lang === "ru" ? "Платное партнёрство" : "Paid partnership");
  else if (form.commercial_content && form.your_brand) labels.push(lang === "ru" ? "Рекламный контент" : "Promotional content");
  if (form.ai_generated) labels.push(lang === "ru" ? "Создано ИИ" : "AI-generated");
  return (
    <div className="flex items-start justify-center">
      <div className="relative w-[280px] overflow-hidden rounded-[2rem] border-[6px] border-neutral-900 bg-neutral-950 shadow-2xl" style={{ aspectRatio: "9 / 19" }}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(236,72,153,.35),transparent_55%),radial-gradient(circle_at_70%_80%,rgba(34,211,238,.3),transparent_50%)]" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-4 pt-4 text-[11px] font-semibold text-white/70">
          <span>{lang === "ru" ? "Подписки" : "Following"}</span>
          <span className="border-b-2 border-white pb-0.5 text-white">{lang === "ru" ? "Рекомендации" : "For You"}</span>
        </div>
        {sourceName && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-1 text-[10px] text-white/80">{sourceName}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 pr-14 text-white">
          <div className="text-sm font-bold">{name}</div>
          <div className="mt-1 line-clamp-4 whitespace-pre-line text-xs leading-snug text-white/90">
            {mode === "inbox" ? (lang === "ru" ? "Описание добавите в приложении TikTok" : "Add the caption in the TikTok app") : form.title || (lang === "ru" ? "Заголовок появится здесь" : "Your title appears here")}
          </div>
          {labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {labels.map((l) => <span key={l} className="rounded bg-white/15 px-1.5 py-0.5 text-[10px]">{l}</span>)}
            </div>
          )}
          {mode === "direct" && form.privacy_level && (
            <div className="mt-2 text-[10px] text-white/60">{PRIVACY_LABELS[form.privacy_level]?.[lang] ?? form.privacy_level}</div>
          )}
        </div>
        <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4 text-white/85">
          {["♥", "💬", "↗"].map((g) => <span key={g} className="text-xl">{g}</span>)}
        </div>
      </div>
    </div>
  );
}
