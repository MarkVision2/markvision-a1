/**
 * Предпросмотр публикации: как ролик с подписью будет выглядеть в ленте
 * конкретной площадки. Чисто визуальный макет — данные площадок сюда не ходят,
 * задача одна: увидеть обрезку кадра и хвост подписи до отправки на 40 аккаунтов.
 */
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Music2, Send, Share2, ThumbsUp } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PLATFORM_META, formatFollowers, type PublishAccount, type PublishPlatform } from "@/lib/publishingClient";

/**
 * Точка-акцент площадки. PLATFORM_META.cls — светлотемные text-*-700,
 * на тёмном фоне шапки он не читается, поэтому здесь свой набор.
 */
const PLATFORM_DOT: Record<PublishPlatform, string> = {
  instagram: "bg-pink-500",
  tiktok: "bg-sky-400",
  youtube: "bg-red-500",
  threads: "bg-zinc-400",
};
import { cn } from "@/lib/utils";

export interface PreviewContent {
  /** Ссылка на видео (blob: для локального файла) — null, пока файл не выбран. */
  mediaUrl: string | null;
  title: string;
  caption: string;
  hashtags: string[];
  /** Отношение сторон исходника; 0.5625 = 9:16. */
  aspect: number | null;
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Подпись + хэштеги одной строкой — площадки склеивают их именно так. */
export function fullCaption(c: PreviewContent): string {
  const tags = c.hashtags.filter(Boolean).map((h) => `#${h.replace(/^#/, "")}`).join(" ");
  return [c.caption.trim(), tags].filter(Boolean).join("\n\n");
}

const TODAY = () => new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

/** Кадр видео; пока файла нет — заглушка в правильной пропорции. */
function Media({ url, ratio, className }: { url: string | null; ratio: number; className?: string }) {
  return (
    <div
      className={cn("relative w-full overflow-hidden bg-muted", className)}
      style={{ aspectRatio: String(ratio) }}
    >
      {url ? (
        // muted+playsInline: браузер рисует первый кадр без автозапуска звука.
        <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          Кадр появится после выбора видео
        </div>
      )}
    </div>
  );
}

function Handle({ a }: { a: PublishAccount }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="text-[10px]">{initials(a.account_name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{a.handle ?? a.account_name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {TODAY()}
          {a.followers != null && ` · ${formatFollowers(a.followers)}`}
        </div>
      </div>
    </div>
  );
}

function CaptionBlock({ a, text }: { a: PublishAccount; text: string }) {
  if (!text) return <p className="px-3 pb-3 text-sm text-muted-foreground">Подпись пока пустая</p>;
  return (
    <p className="whitespace-pre-wrap px-3 pb-3 text-sm leading-snug">
      <span className="font-semibold">{a.handle ?? a.account_name} </span>
      {text}
    </p>
  );
}

/* ───────────────────────────── площадки ───────────────────────────── */

function InstagramCard({ a, c }: { a: PublishAccount; c: PreviewContent }) {
  // Лента режет вертикаль до 4:5, Reels показывает 9:16 целиком.
  const ratio = c.aspect && c.aspect < 0.7 ? 9 / 16 : 4 / 5;
  return (
    <>
      <div className="flex items-center justify-between p-3">
        <Handle a={a} />
        <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <Media url={c.mediaUrl} ratio={ratio} />
      <div className="flex items-center gap-4 p-3">
        <Heart className="h-5 w-5" />
        <MessageCircle className="h-5 w-5" />
        <Send className="h-5 w-5" />
        <Bookmark className="ml-auto h-5 w-5" />
      </div>
      <CaptionBlock a={a} text={fullCaption(c)} />
    </>
  );
}

function TikTokCard({ a, c }: { a: PublishAccount; c: PreviewContent }) {
  return (
    <div className="relative">
      <Media url={c.mediaUrl} ratio={9 / 16} />
      {/* Правая колонка действий и подпись поверх кадра — как в приложении */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-transparent to-transparent">
        <div className="flex items-end justify-between gap-3 p-3">
          <div className="min-w-0 flex-1 text-white">
            <div className="truncate text-sm font-semibold">@{a.handle ?? a.account_name}</div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-snug">{fullCaption(c) || "Подпись пока пустая"}</p>
            <div className="mt-1.5 flex items-center gap-1 text-[11px] opacity-80">
              <Music2 className="h-3 w-3" /> оригинальный звук
            </div>
          </div>
          <div className="flex flex-col items-center gap-3 text-white">
            <Heart className="h-5 w-5" />
            <MessageCircle className="h-5 w-5" />
            <Share2 className="h-5 w-5" />
          </div>
        </div>
      </div>
    </div>
  );
}

function YoutubeCard({ a, c }: { a: PublishAccount; c: PreviewContent }) {
  const vertical = c.aspect != null && c.aspect < 0.7;
  return (
    <>
      <Media url={c.mediaUrl} ratio={vertical ? 9 / 16 : 16 / 9} />
      <div className="flex gap-3 p-3">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="text-[10px]">{initials(a.account_name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium">{c.title.trim() || "Без названия"}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {a.account_name} · {vertical ? "Shorts" : "Видео"} · только что
          </div>
        </div>
        <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </>
  );
}

function ThreadsCard({ a, c }: { a: PublishAccount; c: PreviewContent }) {
  return (
    <div className="flex gap-3 p-3">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-[10px]">{initials(a.account_name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{a.handle ?? a.account_name}</span>
          <span className="text-xs text-muted-foreground">только что</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-snug">{fullCaption(c) || "Подпись пока пустая"}</p>
        <div className="overflow-hidden rounded-xl border">
          <Media url={c.mediaUrl} ratio={c.aspect && c.aspect < 0.7 ? 9 / 16 : 4 / 5} />
        </div>
        <div className="flex items-center gap-4 pt-1 text-muted-foreground">
          <Heart className="h-4 w-4" />
          <MessageCircle className="h-4 w-4" />
          <Share2 className="h-4 w-4" />
          <ThumbsUp className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

const BY_PLATFORM: Record<PublishPlatform, (p: { a: PublishAccount; c: PreviewContent }) => JSX.Element> = {
  instagram: InstagramCard,
  tiktok: TikTokCard,
  youtube: YoutubeCard,
  threads: ThreadsCard,
};

/** Одна карточка предпросмотра под конкретный аккаунт. */
export function PostPreview({ account, content }: { account: PublishAccount; content: PreviewContent }) {
  const Card = BY_PLATFORM[account.platform] ?? InstagramCard;
  const meta = PLATFORM_META[account.platform];
  return (
    <figure className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-card">
      <figcaption className="flex items-center justify-between gap-2 border-b border-border/70 bg-secondary/50 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          <span className={cn("h-2 w-2 rounded-full", PLATFORM_DOT[account.platform] ?? "bg-muted-foreground")} />
          {meta?.label ?? account.platform}
        </span>
        <span className="truncate text-muted-foreground">{account.account_name}</span>
      </figcaption>
      <Card a={account} c={content} />
    </figure>
  );
}
