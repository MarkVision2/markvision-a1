import { useCallback, useEffect, useRef, useState } from "react";
import { Facebook, Instagram, Loader2, CheckCircle2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

type PendingPageInstagram = { id: string; username?: string; profile_picture_url?: string } | null;
type PendingPage = { id: string; name: string; instagram?: PendingPageInstagram };
type PendingAdAccount = { id: string; name: string; currency: string | null };
type PendingSelection = { selectionId: string; pages: PendingPage[]; adAccounts: PendingAdAccount[] };

type ConnectedSummary = {
  pageName: string | null;
  igUsername: string | null;
  igProfilePic: string | null;
  igFollowers: number | null;
  igMediaCount: number | null;
  igLastError: string | null;
  adAccountName: string | null;
  adAccountId: string | null;
  adCurrency: string | null;
};

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

type OAuthMessage = {
  source?: string;
  success?: boolean;
  error?: string;
  summary?: string;
  needsSelection?: boolean;
  selectionId?: string;
  pages?: PendingPage[];
  adAccounts?: PendingAdAccount[];
};

const OAUTH_MESSAGE_SOURCE = "fb-oauth";

// Один вход через Facebook — попап открывает диалог Facebook, а после
// подключения facebook-oauth-callback редиректит попап обратно на эту же
// страницу с результатом в query-параметрах (?fb_connected/?fb_error/
// ?fb_select). Supabase Edge Functions не умеют отдавать рабочий text/html
// на GET (браузер покажет его как обычный текст), поэтому связь с открывшим
// окном происходит не из функции, а из самого фронтенда: если страница
// обнаруживает, что она открыта в попапе (есть window.opener), она
// форвардит результат родительскому окну через postMessage и закрывается
// сама; иначе обрабатывает результат на месте (обычный редирект — попап был
// заблокирован). Если у аккаунта несколько страниц или рекламных кабинетов —
// просим выбрать явно, а не угадываем.
export function FacebookConnect() {
  const { activeId: projectId } = useProjectsStore();
  const [connecting, setConnecting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string | null>(null);
  const [connected, setConnected] = useState<ConnectedSummary | null>(null);
  const [params, setParams] = useSearchParams();
  const pollRef = useRef<number | null>(null);

  // Показываем, что реально подключено сейчас — без этого после успешного
  // подключения карточка не менялась (только тост), и было непонятно,
  // применилось ли что-то на самом деле. Собираем полную картину: страница +
  // Instagram (instagram_accounts) и рекламный кабинет (ad_cabinets_safe —
  // безопасное представление без токенов), сматченный по той же странице.
  const refreshConnected = useCallback(async () => {
    if (!projectId) {
      setConnected(null);
      return;
    }
    const { data: ig } = await supabase
      .from("instagram_accounts")
      .select("username, page_id, page_name, profile_picture_url, followers_count, media_count, last_error")
      .eq("project_id", projectId)
      .maybeSingle();

    let adQuery = supabase
      .from("ad_cabinets_safe" as any)
      .select("name, ad_account_id, currency, page_name, page_id")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (ig?.page_id) adQuery = adQuery.eq("page_id", ig.page_id);
    const { data: adRows } = await adQuery;
    const ad = (adRows as unknown as Array<{ name: string; ad_account_id: string; currency: string; page_name: string; page_id: string }> | null)?.[0] ?? null;

    if (!ig && !ad) {
      setConnected(null);
      return;
    }
    setConnected({
      pageName: ig?.page_name ?? ad?.page_name ?? null,
      igUsername: ig?.username ?? null,
      igProfilePic: ig?.profile_picture_url ?? null,
      igFollowers: ig?.followers_count ?? null,
      igMediaCount: ig?.media_count ?? null,
      igLastError: ig?.last_error ?? null,
      adAccountName: ad?.name ?? null,
      adAccountId: ad?.ad_account_id ?? null,
      adCurrency: ad?.currency ?? null,
    });
  }, [projectId]);

  useEffect(() => {
    refreshConnected();
  }, [refreshConnected]);

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const openSelection = (sel: PendingSelection) => {
    setSelection(sel);
    setSelectedPageId(sel.pages.length === 1 ? sel.pages[0].id : null);
    setSelectedAdAccountId(null);
  };

  // facebook-oauth-callback always redirects back here with the result in
  // the query string. If this page instance is the popup itself (it has an
  // opener), forward the result to the parent window and close; otherwise
  // (popup was blocked and this is the same tab that navigated away) handle
  // it locally, same as before.
  useEffect(() => {
    const connectedSummary = params.get("fb_connected");
    const error = params.get("fb_error");
    const select = params.get("fb_select");
    if (!connectedSummary && !error && !select) return;

    const isPopup = !!window.opener && window.opener !== window;
    if (isPopup) {
      try {
        let payload: OAuthMessage;
        if (connectedSummary) {
          payload = { source: OAUTH_MESSAGE_SOURCE, success: true, summary: connectedSummary };
        } else if (error) {
          payload = { source: OAUTH_MESSAGE_SOURCE, success: false, error };
        } else {
          const sel = JSON.parse(select as string) as PendingSelection;
          payload = { source: OAUTH_MESSAGE_SOURCE, success: true, needsSelection: true, ...sel };
        }
        window.opener.postMessage(payload, window.location.origin);
        window.close();
      } catch {
        // Fall through to local handling if postMessage/close somehow fails.
      }
      return;
    }

    if (connectedSummary) {
      toast.success("Facebook подключён", { description: connectedSummary });
      refreshConnected();
      setParams((p) => { p.delete("fb_connected"); return p; }, { replace: true });
    } else if (error) {
      toast.error("Не удалось подключить Facebook", { description: error });
      setParams((p) => { p.delete("fb_error"); return p; }, { replace: true });
    } else if (select) {
      try {
        openSelection(JSON.parse(select) as PendingSelection);
      } catch { /* malformed, ignore */ }
      setParams((p) => { p.delete("fb_select"); return p; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams]);

  useEffect(() => {
    const handler = (event: MessageEvent<OAuthMessage>) => {
      if (event.data?.source !== OAUTH_MESSAGE_SOURCE) return;
      stopPolling();
      setConnecting(false);
      const payload = event.data;
      if (!payload.success) {
        toast.error("Не удалось подключить Facebook", { description: payload.error });
      } else if (payload.needsSelection && payload.selectionId && payload.pages) {
        openSelection({ selectionId: payload.selectionId, pages: payload.pages, adAccounts: payload.adAccounts ?? [] });
      } else {
        toast.success("Facebook подключён", { description: payload.summary });
        refreshConnected();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [refreshConnected]);

  useEffect(() => stopPolling, []);

  const handleConnect = async () => {
    if (!projectId) {
      toast.error("Сначала выберите проект");
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-oauth-start", {
        body: { project_id: projectId, return_url: window.location.href },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Не удалось получить ссылку авторизации");

      const popup = window.open(data.url as string, "fb-oauth", "width=560,height=680");
      if (!popup) {
        // Popup blocked — fall back to a normal redirect in this tab.
        window.location.href = data.url as string;
        return;
      }
      pollRef.current = window.setInterval(() => {
        if (popup.closed) {
          stopPolling();
          setConnecting(false);
        }
      }, 500);
    } catch (e) {
      toast.error("Не удалось начать подключение", { description: e instanceof Error ? e.message : String(e) });
      setConnecting(false);
    }
  };

  const handleConfirmSelection = async () => {
    if (!selection || !selectedPageId) return;
    setFinishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-oauth-finish", {
        body: { selection_id: selection.selectionId, page_id: selectedPageId, ad_account_id: selectedAdAccountId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success("Facebook подключён", { description: data?.summary });
      setSelection(null);
      refreshConnected();
    } catch (e) {
      toast.error("Не удалось завершить подключение", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setFinishing(false);
    }
  };

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#1877F2]/15 text-[#1877F2]">
            <Facebook className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Подключить Facebook</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Один вход через Facebook — выберите страницу и рекламный кабинет, а систему подключит их
              к этому проекту: автопостинг, аналитика и автоответы на комментарии в Direct заработают сразу,
              без отдельных токенов.
            </p>
          </div>
        </div>
        <Button onClick={handleConnect} disabled={connecting || !projectId} className="gap-2 bg-[#1877F2] hover:bg-[#1877F2]/90">
          {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
          {connected ? "Переподключить Facebook" : "Войти через Facebook"}
        </Button>

        {connected && (
          <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-secondary/40 p-3">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1877F2]/15 text-[#1877F2]">
                <Facebook className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <span className="truncate">Страница «{connected.pageName ?? "—"}»</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {connected.igProfilePic ? (
                <img src={connected.igProfilePic} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pink-500/15 text-pink-500">
                  <Instagram className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0 flex-1 text-sm">
                {connected.igUsername ? (
                  <>
                    <div className="font-semibold">Instagram @{connected.igUsername}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtNum(connected.igFollowers ?? 0)} подписчиков · {fmtNum(connected.igMediaCount ?? 0)} публикаций
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground">Instagram не привязан к этой странице</div>
                )}
              </div>
            </div>

            {connected.igLastError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {connected.igLastError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                <Wallet className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                {connected.adAccountName ? (
                  <>
                    <div className="truncate font-semibold">{connected.adAccountName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {connected.adAccountId}{connected.adCurrency ? ` · ${connected.adCurrency}` : ""}
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground">Рекламный кабинет не подключён</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!selection} onOpenChange={(open) => { if (!open) setSelection(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Выберите, что подключить</DialogTitle>
            <DialogDescription>
              У этого Facebook-аккаунта несколько страниц{selection && selection.adAccounts.length > 1 ? " и рекламных кабинетов" : ""}.
              Выберите страницу — рядом показан привязанный к ней Instagram, если он есть; именно он подключится к проекту.
            </DialogDescription>
          </DialogHeader>

          {selection && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">Страница ({selection.pages.length})</p>
                <Command className="rounded-lg border">
                  <CommandInput placeholder="Поиск страницы…" />
                  <CommandList className="max-h-56">
                    <CommandEmpty>Ничего не найдено</CommandEmpty>
                    <CommandGroup>
                      {selection.pages.map((page) => (
                        <CommandItem
                          key={page.id}
                          value={`${page.name} ${page.instagram?.username ?? ""}`}
                          onSelect={() => setSelectedPageId(page.id)}
                          className={cn("cursor-pointer gap-2", selectedPageId === page.id && "bg-accent")}
                        >
                          <CheckCircle2 className={cn("h-4 w-4 shrink-0 text-primary", selectedPageId !== page.id && "opacity-0")} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{page.name}</div>
                            {page.instagram ? (
                              <div className="flex items-center gap-1 text-xs text-pink-500">
                                <Instagram className="h-3 w-3 shrink-0" />
                                <span className="truncate">@{page.instagram.username}</span>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground">без Instagram</div>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>

              {selection.adAccounts.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Рекламный кабинет (необязательно)</p>
                  <Command className="rounded-lg border">
                    <CommandInput placeholder="Поиск кабинета…" />
                    <CommandList className="max-h-40">
                      <CommandEmpty>Ничего не найдено</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="без рекламного кабинета"
                          onSelect={() => setSelectedAdAccountId(null)}
                          className={cn("cursor-pointer gap-2", selectedAdAccountId === null && "bg-accent")}
                        >
                          <CheckCircle2 className={cn("h-4 w-4 text-primary", selectedAdAccountId !== null && "opacity-0")} />
                          Без рекламного кабинета
                        </CommandItem>
                        {selection.adAccounts.map((acc) => (
                          <CommandItem
                            key={acc.id}
                            value={acc.name}
                            onSelect={() => setSelectedAdAccountId(acc.id)}
                            className={cn("cursor-pointer gap-2", selectedAdAccountId === acc.id && "bg-accent")}
                          >
                            <CheckCircle2 className={cn("h-4 w-4 text-primary", selectedAdAccountId !== acc.id && "opacity-0")} />
                            {acc.name}{acc.currency ? ` (${acc.currency})` : ""}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelection(null)} disabled={finishing}>Отмена</Button>
            <Button onClick={handleConfirmSelection} disabled={!selectedPageId || finishing} className="gap-2">
              {finishing && <Loader2 className="h-4 w-4 animate-spin" />}
              Подключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
