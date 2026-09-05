import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, ExternalLink, FlaskConical, Languages, Loader2, LogOut, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContinueWithTikTokButton, TikTokLogo } from "@/components/tiktok/TikTokBrand";
import { TikTokPostComposer } from "@/components/tiktok/TikTokPostComposer";
import { TikTokProfileCard } from "@/components/tiktok/TikTokProfileCard";
import { TikTokScopes } from "@/components/tiktok/TikTokScopes";
import { TikTokVideoGrid } from "@/components/tiktok/TikTokVideoGrid";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { readOAuthResult, startPublishOAuth } from "@/lib/publishingClient";
import { errorText, type Lang, t, tiktokApi, type TikTokAccount, type TikTokStatusResponse, type TikTokUser, type TikTokVideo } from "@/lib/tiktokClient";
import { cn } from "@/lib/utils";

const RETURN_PATH = "/settings?tab=tiktok";
const LANG_KEY = "mv.tiktok.lang";

function readLang(): Lang {
  try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "ru"; } catch { return "ru"; }
}

/**
 * Раздел «Подключение TikTok» (Настройки → Подключения → TikTok) — витрина
 * интеграции для App review TikTok for Developers и рабочий инструмент: вход
 * (Login Kit), профиль и видео (Display API), публикация (Content Posting API),
 * отключение с отзывом токена. Интерфейс двуязычный (RU/EN) — ревьюеры
 * площадки читают по-английски. Возврат с согласия TikTok — на этот же таб.
 */
export default function TikTokConnect() {
  const { activeId: projectId } = useProjectsStore();
  const [lang, setLang] = useState<Lang>(readLang);
  const [status, setStatus] = useState<TikTokStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [params, setParams] = useSearchParams();

  const [profile, setProfile] = useState<{ user: TikTokUser; fields: string } | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [videos, setVideos] = useState<TikTokVideo[] | null>(null);
  const [videosCursor, setVideosCursor] = useState<number | null>(null);
  const [videosMore, setVideosMore] = useState(false);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState<string | null>(null);

  const toggleLang = () => {
    const next: Lang = lang === "ru" ? "en" : "ru";
    setLang(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* приватный режим */ }
  };

  const refetch = useCallback(async () => {
    if (!projectId) { setStatus(null); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await tiktokApi.status(projectId);
      setStatus(r);
      setSelectedId((cur) => (cur && r.accounts.some((a) => a.id === cur) ? cur : r.accounts[0]?.id ?? null));
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Сброс данных Display API при смене аккаунта.
  useEffect(() => {
    setProfile(null); setProfileError(null);
    setVideos(null); setVideosCursor(null); setVideosMore(false); setVideosError(null);
  }, [selectedId]);

  // Возврат с согласия TikTok: ?publish_connected=tiktok / ?publish_error=…
  useEffect(() => {
    const result = readOAuthResult(params.toString() ? `?${params.toString()}` : "");
    if (!result) return;
    if (result.connected) {
      toast.success(`${t("connectedToast", lang)}${result.connected.account ? `: ${result.connected.account}` : ""}`);
      void refetch();
    } else if (result.error) {
      toast.error(`${t("connectFailed", lang)}: ${result.error}`);
    }
    setParams((p) => { p.delete("publish_connected"); p.delete("publish_error"); p.delete("account"); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const account: TikTokAccount | null = useMemo(
    () => status?.accounts.find((a) => a.id === selectedId) ?? null,
    [status, selectedId],
  );

  const connect = async () => {
    if (!projectId) return;
    setOauthBusy(true);
    try {
      const url = await startPublishOAuth(projectId, "tiktok", null, RETURN_PATH);
      window.location.assign(url);
    } catch (e) {
      toast.error(errorText(e, lang));
      setOauthBusy(false);
    }
  };

  const loadProfile = async () => {
    if (!projectId || !account) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      setProfile(await tiktokApi.profile(projectId, account.id));
    } catch (e) {
      setProfileError(errorText(e, lang));
    } finally {
      setProfileLoading(false);
    }
  };

  const loadVideos = async (more = false) => {
    if (!projectId || !account) return;
    setVideosLoading(true);
    setVideosError(null);
    try {
      const r = await tiktokApi.videos(projectId, account.id, more ? videosCursor : null);
      setVideos((cur) => (more && cur ? [...cur, ...r.videos] : r.videos));
      setVideosCursor(r.cursor);
      setVideosMore(r.has_more);
    } catch (e) {
      setVideosError(errorText(e, lang));
    } finally {
      setVideosLoading(false);
    }
  };

  const disconnect = async () => {
    if (!projectId || !disconnectId) return;
    setDisconnecting(true);
    try {
      const r = await tiktokApi.disconnect(projectId, disconnectId);
      toast.success(r.revoked ? t("disconnected", lang) : t("disconnectedNoRevoke", lang));
      setDisconnectId(null);
      await refetch();
    } catch (e) {
      toast.error(errorText(e, lang));
    } finally {
      setDisconnecting(false);
    }
  };

  const app = status?.app ?? null;

  return (
    <>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-300"><TikTokLogo className="h-5 w-5" /></span>
            <div>
              <h3 className="text-base font-semibold">{t("pageTitle", lang)}</h3>
              <p className="max-w-2xl text-sm text-muted-foreground">{t("pageDesc", lang)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {app && (
              <Badge variant="outline" className={cn("border-transparent", app.sandbox ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                {app.sandbox ? <FlaskConical className="mr-1 h-3 w-3" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                {app.sandbox ? t("sandbox", lang) : t("production", lang)}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={loading} aria-label={t("refresh", lang)}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" onClick={toggleLang} aria-label="Language">
              <Languages className="mr-1.5 h-4 w-4" />{t("langToggle", lang)}
            </Button>
          </div>
        </div>

        {!projectId && <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noProject", lang)}</div>}

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        {app && !app.configured && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("appNotConfigured", lang)}</span>
          </div>
        )}

        {app?.sandbox && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span>{t("sandboxHint", lang)}</span>
          </div>
        )}

        {/* ─────────── 1. Login Kit ─────────── */}
        {projectId && (
          <Section n={1} title={t("loginTitle", lang)} product="Login Kit">
            <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
              <div className="flex flex-col items-start justify-center gap-4 rounded-2xl border bg-gradient-to-br from-pink-500/10 via-card to-cyan-500/10 p-6">
                <p className="text-sm text-muted-foreground">{t("loginDesc", lang)}</p>
                <ContinueWithTikTokButton
                  label={t("continueWithTikTok", lang)}
                  busy={oauthBusy}
                  disabled={!app?.configured}
                  onClick={() => void connect()}
                />
                <div className="text-[11px] text-muted-foreground">
                  {t("requested", lang)}: <code className="font-mono">{(app?.requested_scopes ?? []).join(", ")}</code>
                </div>
              </div>

              <div className="rounded-2xl border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("accounts", lang)}</h3>
                  {status && status.accounts.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => void connect()} disabled={oauthBusy || !app?.configured}>{t("connectAnother", lang)}</Button>
                  )}
                </div>
                {loading && !status && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />…</div>}
                {status && status.accounts.length === 0 && (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("notConnected", lang)}</div>
                )}
                <ul className="space-y-2">
                  {status?.accounts.map((a) => {
                    const active = a.id === selectedId;
                    const expired = a.status === "token_expired" || a.status === "error";
                    return (
                      <li key={a.id}>
                        {/* Не <button>: внутри есть свои кнопки (переподключить/отключить). */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(a.id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(a.id); } }}
                          className={cn("flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition", active ? "border-pink-500 bg-pink-500/5 ring-1 ring-pink-500" : "hover:bg-muted/50")}
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black text-white"><TikTokLogo className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-sm font-semibold">{a.account_name}</span>
                              {a.handle && <span className="text-xs text-muted-foreground">@{a.handle}</span>}
                              {active && <Badge variant="outline" className="border-transparent bg-pink-500/10 text-[10px] text-pink-700 dark:text-pink-300">{t("activeAccount", lang)}</Badge>}
                              {expired ? (
                                <Badge variant="outline" className="border-transparent bg-destructive/10 text-[10px] text-destructive">{a.status}</Badge>
                              ) : (
                                <Badge variant="outline" className="border-transparent bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mr-1 h-3 w-3" />{t("connected", lang)}</Badge>
                              )}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              open_id: <code className="font-mono">{a.external_account_id.slice(0, 12)}…</code>
                              {a.token_expires_at && <> · {t("tokenUntil", lang)} {new Date(a.token_expires_at).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { dateStyle: "short", timeStyle: "short" })}</>}
                              {a.missing_scopes.length > 0 && <> · <span className="text-amber-600">{t("missingScopes", lang)}: {a.missing_scopes.join(", ")}</span></>}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {(expired || a.missing_scopes.length > 0) && (
                              <Button variant="outline" size="sm" onClick={() => void connect()} disabled={oauthBusy}>{t("reconnect", lang)}</Button>
                            )}
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDisconnectId(a.id)} aria-label={t("disconnect", lang)}>
                              <Unplug className="h-4 w-4" />
                            </Button>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </Section>
        )}

        {/* ─────────── 2. Права ─────────── */}
        {projectId && app && (
          <Section n={2} title={t("scopesTitle", lang)} description={t("scopesDesc", lang)} product="Scopes">
            <TikTokScopes catalog={app.catalog} requested={app.requested_scopes} account={account} lang={lang} />
          </Section>
        )}

        {/* ─────────── 3. Display API: профиль ─────────── */}
        {projectId && (
          <Section n={3} title={t("profileTitle", lang)} product="Display API" locked={!account} lockedText={t("needAccount", lang)}>
            <TikTokProfileCard user={profile?.user ?? null} fields={profile?.fields ?? null} loading={profileLoading} error={profileError} lang={lang} onLoad={() => void loadProfile()} />
          </Section>
        )}

        {/* ─────────── 4. Display API: видео ─────────── */}
        {projectId && (
          <Section n={4} title={t("videosTitle", lang)} product="Display API" locked={!account} lockedText={t("needAccount", lang)}>
            <TikTokVideoGrid videos={videos} hasMore={videosMore} loading={videosLoading} error={videosError} lang={lang} onLoad={() => void loadVideos(false)} onMore={() => void loadVideos(true)} />
          </Section>
        )}

        {/* ─────────── 5. Content Posting API ─────────── */}
        {projectId && (
          <Section n={5} title={t("postTitle", lang)} description={t("postDesc", lang)} product="Content Posting API" locked={!account} lockedText={t("needAccount", lang)}>
            <TikTokPostComposer projectId={projectId} account={account} lang={lang} onPublished={() => { if (videos) void loadVideos(false); }} />
          </Section>
        )}

        {/* ─────────── 6. Как устроено + документы ─────────── */}
        {projectId && (
          <Section n={6} title={t("howItWorks", lang)} product="OAuth 2.0">
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <ol className="space-y-2 rounded-2xl border bg-card p-5 text-sm">
                {(["step1", "step2", "step3", "step4"] as const).map((k, i) => (
                  <li key={k} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-pink-500/10 text-xs font-bold text-pink-600">{i + 1}</span>
                    <span>{t(k, lang)}</span>
                  </li>
                ))}
              </ol>
              <div className="space-y-3 rounded-2xl border bg-card p-5 text-sm">
                <div className="font-semibold">{t("legal", lang)}</div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm"><Link to="/terms" target="_blank"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />{t("terms", lang)}</Link></Button>
                  <Button asChild variant="outline" size="sm"><Link to="/privacy" target="_blank"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />{t("privacy", lang)}</Link></Button>
                </div>
                {app && (
                  <div className="text-[11px] text-muted-foreground">
                    <div className="font-medium">{t("redirectUri", lang)}</div>
                    <code className="break-all font-mono">{app.redirect_uri}</code>
                  </div>
                )}
              </div>
            </div>
          </Section>
        )}
      </div>

      <AlertDialog open={disconnectId != null} onOpenChange={(o) => { if (!o) setDisconnectId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disconnect", lang)}</AlertDialogTitle>
            <AlertDialogDescription>{t("disconnectConfirm", lang)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>{lang === "ru" ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void disconnect(); }} disabled={disconnecting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}{t("disconnect", lang)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Нумерованный блок раздела — по номеру удобно вести демонстрационное видео. */
function Section({ n, title, description, product, locked, lockedText, children }: {
  n: number; title: string; description?: string; product: string; locked?: boolean; lockedText?: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3" aria-labelledby={`tt-section-${n}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-black text-sm font-bold text-white dark:ring-1 dark:ring-white/15">{n}</span>
        <h2 id={`tt-section-${n}`} className="text-lg font-bold tracking-tight">{title}</h2>
        <Badge variant="outline" className="border-transparent bg-muted font-mono text-[10px]">{product}</Badge>
      </div>
      {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      {locked ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{lockedText}</div>
      ) : children}
    </section>
  );
}
