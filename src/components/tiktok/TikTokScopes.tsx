import { CheckCircle2, Circle, KeyRound, LayoutGrid, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type Lang,
  scopeGranted,
  scopesByProduct,
  t,
  TIKTOK_PRODUCTS,
  type TikTokAccount,
  type TikTokProduct,
  type TikTokScopeInfo,
} from "@/lib/tiktokClient";

const PRODUCT_ICON: Record<TikTokProduct, typeof KeyRound> = {
  login_kit: KeyRound,
  display_api: LayoutGrid,
  content_posting_api: Send,
};

const PRODUCT_CLS: Record<TikTokProduct, string> = {
  login_kit: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  display_api: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  content_posting_api: "bg-pink-500/10 text-pink-600 dark:text-pink-300",
};

/**
 * Продукты TikTok for Developers и права внутри каждого: что просим, зачем
 * и выдано ли выбранному аккаунту. Это же — «карта» для демонстрационного видео.
 */
export function TikTokScopes({ catalog, requested, account, lang }: { catalog: TikTokScopeInfo[]; requested: string[]; account: TikTokAccount | null; lang: Lang }) {
  const groups = scopesByProduct(catalog.length ? catalog : undefined);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {groups.map(({ product, scopes }) => {
        const Icon = PRODUCT_ICON[product];
        return (
          <div key={product} className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className={cn("grid h-9 w-9 place-items-center rounded-xl", PRODUCT_CLS[product])}>
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <div className="font-semibold leading-tight">{TIKTOK_PRODUCTS[product][lang]}</div>
                <div className="text-[11px] text-muted-foreground">{scopes.length} {lang === "ru" ? "прав" : "scopes"}</div>
              </div>
            </div>
            <ul className="space-y-2.5">
              {scopes.map((s) => {
                const isRequested = requested.includes(s.scope);
                const granted = account ? scopeGranted(account, s.scope) : false;
                return (
                  <li key={s.scope} className="rounded-xl bg-muted/40 p-3">
                    <div className="flex items-start gap-2">
                      {account ? (
                        granted
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                      ) : (
                        <Circle className={cn("mt-0.5 h-4 w-4 shrink-0", isRequested ? "text-sky-500" : "text-muted-foreground/40")} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold">{s.scope}</code>
                          {account ? (
                            <Badge variant="outline" className={cn("border-transparent text-[10px]", granted ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                              {granted ? t("granted", lang) : t("notGranted", lang)}
                            </Badge>
                          ) : isRequested ? (
                            <Badge variant="outline" className="border-transparent bg-sky-500/10 text-[10px] text-sky-700 dark:text-sky-300">{t("requested", lang)}</Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm font-medium leading-snug">{s.title[lang]}</div>
                        <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{s.purpose[lang]}</div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
