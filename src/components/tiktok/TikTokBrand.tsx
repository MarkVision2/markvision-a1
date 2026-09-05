import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Логотип TikTok (монохром) — для кнопки входа и шапки раздела. */
export function TikTokLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("h-5 w-5", className)} fill="currentColor">
      <path d="M12.53.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

interface ContinueButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  busy?: boolean;
}

/**
 * Кнопка «Continue with TikTok» по гайдлайну Login Kit: чёрная плашка,
 * логотип слева, текст без сокращений. Ничего кроме входа она не делает.
 */
export function ContinueWithTikTokButton({ label, busy, className, disabled, ...rest }: ContinueButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cn(
        "inline-flex h-12 items-center gap-3 rounded-full bg-black px-6 text-[15px] font-semibold text-white shadow-lg shadow-black/20 transition",
        "hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60 dark:ring-1 dark:ring-white/15",
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <TikTokLogo className="h-5 w-5" />}
      {label}
    </button>
  );
}
