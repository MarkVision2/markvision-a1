import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, Wallet, Search } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PendingAccount = { id: string; name: string };
type PendingSelection = { selectionId: string; accounts: PendingAccount[] };
type ConnectedCabinet = { name: string; external_id: string | null; currency: string | null };
type GoogleConfig = {
  connected: boolean;
  google_email: string | null;
  conversion_action_sale: string | null;
  conversion_action_lead: string | null;
};

type OAuthMessage = {
  source?: string;
  success?: boolean;
  error?: string;
  summary?: string;
  needsSelection?: boolean;
  selectionId?: string;
  accounts?: PendingAccount[];
};

const OAUTH_MESSAGE_SOURCE = "google-oauth";

// Подключение Google Ads по образцу Facebook: попап открывает согласие Google,
// google-oauth-callback редиректит попап обратно с результатом в query
// (?google_connected / ?google_error / ?google_select). Если под Google-логином
// несколько рекламных аккаунтов — просим выбрать явно (google-oauth-finish).
export function GoogleAdsConnect() {
  const { activeId: projectId } = useProjectsStore();
  const [connecting, setConnecting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [cabinets, setCabinets] = useState<ConnectedCabinet[]>([]);
  const [config, setConfig] = useState<GoogleConfig | null>(null);
  const [saleAction, setSaleAction] = useState("");
  const [leadAction, setLeadAction] = useState("");
  const [savingCfg, setSavingCfg] = useState(false);
  const [params, setParams] = useSearchParams();
  const pollRef = useRef<number | null>(null);

  const refreshConnected = useCallback(async () => {
    if (!projectId) {
      setCabinets([]);
      setConfig(null);
      return;
    }
    const { data } = await supabase
      .from("ad_cabinets_safe" as never)
      .select("name, external_id, currency")
      .eq("project_id", projectId)
      .eq("provider", "google")
      .order("updated_at", { ascending: false });
    setCabinets((data as ConnectedCabinet[] | null) ?? []);

    // Статус подключения + конверсионные действия (через edge-функцию, т.к.
    // google_ads_connections закрыта RLS).
    try {
      const { data: cfg } = await supabase.functions.invoke<GoogleConfig>("google-ads-config", {
        body: { project_id: projectId },
      });
      if (cfg) {
        setConfig(cfg);
        setSaleAction(cfg.conversion_action_sale ?? "");
        setLeadAction(cfg.conversion_action_lead ?? "");
      }
    } catch {
      /* подключения ещё нет — не критично */
    }
  }, [projectId]);

  const saveConversionActions = async () => {
    if (!projectId) return;
    setSavingCfg(true);
    try {
      const { data, error } = await supabase.functions.invoke<GoogleConfig>("google-ads-config", {
        body: {
          project_id: projectId,
          action: "save",
          conversion_action_sale: saleAction.trim() || null,
          conversion_action_lead: leadAction.trim() || null,
        },
      });
      if (error) throw new Error(error.message);
      if (data) setConfig(data);
      toast.success("Конверсионные действия сохранены");
    } catch (e) {
      toast.error("Не удалось сохранить", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSavingCfg(false);
    }
  };

  useEffect(() => { refreshConnected(); }, [refreshConnected]);

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const openSelection = (sel: PendingSelection) => {
    setSelection(sel);
    setSelectedAccountId(sel.accounts.length === 1 ? sel.accounts[0].id : null);
  };

  // google-oauth-callback всегда редиректит сюда с результатом в query. Если это
  // окно — попап (есть opener), форвардим результат родителю и закрываемся;
  // иначе обрабатываем на месте (попап был заблокирован).
  useEffect(() => {
    const connectedSummary = params.get("google_connected");
    const error = params.get("google_error");
    const select = params.get("google_select");
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
        /* fall through to local handling */
      }
      return;
    }

    if (connectedSummary) {
      toast.success("Google Ads подключён", { description: connectedSummary });
      refreshConnected();
      setParams((p) => { p.delete("google_connected"); return p; }, { replace: true });
    } else if (error) {
      toast.error("Не удалось подключить Google Ads", { description: error });
      setParams((p) => { p.delete("google_error"); return p; }, { replace: true });
    } else if (select) {
      try { openSelection(JSON.parse(select) as PendingSelection); } catch { /* ignore */ }
      setParams((p) => { p.delete("google_select"); return p; }, { replace: true });
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
        toast.error("Не удалось подключить Google Ads", { description: payload.error });
      } else if (payload.needsSelection && payload.selectionId && payload.accounts) {
        openSelection({ selectionId: payload.selectionId, accounts: payload.accounts });
      } else {
        toast.success("Google Ads подключён", { description: payload.summary });
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
      const { data, error } = await supabase.functions.invoke("google-oauth-start", {
        body: { project_id: projectId, return_url: window.location.href },
      });
      if (error) {
        // Вытаскиваем реальную причину/подсказку из тела ответа (напр. 503
        // «не задан GOOGLE_OAUTH_CLIENT_ID»), иначе supabase-js отдаёт общее
        // «Edge Function returned a non-2xx status code».
        let message = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.hint || body?.error) message = String(body.hint || body.error);
          }
        } catch { /* ignore */ }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.hint || data.error);
      if (!data?.url) throw new Error("Не удалось получить ссылку авторизации");

      const popup = window.open(data.url as string, "google-oauth", "width=560,height=680");
      if (!popup) {
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
    if (!selection || !selectedAccountId) return;
    setFinishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-oauth-finish", {
        body: { selection_id: selection.selectionId, customer_id: selectedAccountId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success("Google Ads подключён", { description: data?.summary });
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
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#FBBC05]/15 text-[#EA4335]">
            <Search className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Подключить Google Ads</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Вход через Google — выберите рекламный аккаунт, и система будет тянуть расходы, клики и
              конверсии в сквозную аналитику этого проекта. Платный трафик Google встанет рядом с Meta.
            </p>
          </div>
        </div>
        <Button
          onClick={handleConnect}
          disabled={connecting || !projectId}
          className="gap-2 bg-[#1A73E8] hover:bg-[#1A73E8]/90"
        >
          {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {cabinets.length > 0 ? "Переподключить Google" : "Войти через Google"}
        </Button>

        {config?.google_email && (
          <div className="mt-3 text-xs text-muted-foreground">
            Google-аккаунт: <span className="font-medium text-foreground">{config.google_email}</span>
          </div>
        )}

        {cabinets.length > 0 && (
          <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-secondary/40 p-3">
            {cabinets.map((c) => (
              <div key={c.external_id ?? c.name} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                  <Wallet className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    <span className="truncate">{c.name}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.external_id}{c.currency ? ` · ${c.currency}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {config?.connected && (
          <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-background p-3">
            <div>
              <h4 className="text-sm font-semibold">Конверсионные действия (офлайн-конверсии)</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Resource name действия из Google Ads («customers/&#123;cid&#125;/conversionActions/&#123;id&#125;»).
                Продажи из CRM с gclid будут отгружаться в это действие, чтобы Google оптимизировался на деньги.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Продажа</label>
              <Input
                value={saleAction}
                onChange={(e) => setSaleAction(e.target.value)}
                placeholder="customers/1234567890/conversionActions/111"
                className="h-9 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Заявка (необязательно)</label>
              <Input
                value={leadAction}
                onChange={(e) => setLeadAction(e.target.value)}
                placeholder="customers/1234567890/conversionActions/222"
                className="h-9 font-mono text-xs"
              />
            </div>
            <Button size="sm" variant="outline" onClick={saveConversionActions} disabled={savingCfg} className="gap-2">
              {savingCfg && <Loader2 className="h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </div>
        )}
      </div>

      <Dialog open={!!selection} onOpenChange={(open) => { if (!open) setSelection(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Выберите рекламный аккаунт</DialogTitle>
            <DialogDescription>
              У этого Google-аккаунта несколько рекламных кабинетов. Выберите тот, который относится к
              проекту — его расходы и конверсии будут попадать в сквозную аналитику.
            </DialogDescription>
          </DialogHeader>

          {selection && (
            <Command className="rounded-lg border">
              <CommandInput placeholder="Поиск аккаунта…" />
              <CommandList className="max-h-64">
                <CommandEmpty>Ничего не найдено</CommandEmpty>
                <CommandGroup>
                  {selection.accounts.map((acc) => (
                    <CommandItem
                      key={acc.id}
                      value={`${acc.name} ${acc.id}`}
                      onSelect={() => setSelectedAccountId(acc.id)}
                      className={cn("cursor-pointer gap-2", selectedAccountId === acc.id && "bg-accent")}
                    >
                      <CheckCircle2 className={cn("h-4 w-4 shrink-0 text-primary", selectedAccountId !== acc.id && "opacity-0")} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{acc.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{acc.id}</div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelection(null)} disabled={finishing}>Отмена</Button>
            <Button onClick={handleConfirmSelection} disabled={!selectedAccountId || finishing} className="gap-2">
              {finishing && <Loader2 className="h-4 w-4 animate-spin" />}
              Подключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
