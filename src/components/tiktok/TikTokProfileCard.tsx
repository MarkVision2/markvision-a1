import { BadgeCheck, ExternalLink, Loader2, RefreshCw, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, type Lang, t, type TikTokUser } from "@/lib/tiktokClient";

interface Props {
  user: TikTokUser | null;
  fields: string | null;
  loading: boolean;
  error: string | null;
  lang: Lang;
  onLoad: () => void;
}

/** Display API: карточка профиля — то, что даёт user.info.basic / profile / stats. */
export function TikTokProfileCard({ user, fields, loading, error, lang, onLoad }: Props) {
  const stats: { label: string; value: number | null }[] = user
    ? [
      { label: t("followers", lang), value: user.follower_count },
      { label: t("following", lang), value: user.following_count },
      { label: t("likes", lang), value: user.likes_count },
      { label: t("videosCount", lang), value: user.video_count },
    ]
    : [];

  return (
    <div className="rounded-2xl border bg-card p-5">
      {!user && !loading && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground"><UserRound className="h-6 w-6" /></span>
          <p className="max-w-sm text-sm text-muted-foreground">{t("profileDesc", lang)}</p>
          <Button onClick={onLoad} size="sm">{t("loadProfile", lang)}</Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      {loading && !user && (
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-64" /></div>
        </div>
      )}

      {user && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start gap-4">
            <Avatar className="h-16 w-16 ring-2 ring-pink-500/40">
              <AvatarImage src={user.avatar_url ?? undefined} alt={user.display_name} />
              <AvatarFallback className="text-lg font-bold">{user.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold leading-tight">{user.display_name}</h3>
                {user.is_verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-600 dark:text-sky-300">
                    <BadgeCheck className="h-3.5 w-3.5" /> {t("verified", lang)}
                  </span>
                )}
              </div>
              {user.username && <div className="text-sm text-muted-foreground">@{user.username}</div>}
              {user.bio_description && <p className="mt-2 whitespace-pre-line text-sm">{user.bio_description}</p>}
              <div className="mt-2 font-mono text-[11px] text-muted-foreground">open_id: {user.open_id}</div>
            </div>
            <div className="flex items-center gap-2">
              {user.profile_deep_link && (
                <Button asChild variant="outline" size="sm">
                  <a href={user.profile_deep_link} target="_blank" rel="noreferrer noopener"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />{t("openProfile", lang)}</a>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onLoad} disabled={loading} aria-label={t("refresh", lang)}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl bg-muted/40 p-3">
                <div className="text-2xl font-bold tabular-nums">{formatCount(s.value, lang)}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          {fields && (
            <div className="text-[11px] text-muted-foreground">
              <span className="font-medium">{t("fieldsRequested", lang)}:</span>{" "}
              <code className="font-mono">{fields.split(",").join(", ")}</code>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
