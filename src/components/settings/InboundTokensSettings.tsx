import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";

interface TokenRow {
  token: string;
  client_id: string | null;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

const BASE_URL = (import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined) ?? "";
const ENDPOINT = `${BASE_URL}/functions/v1/lead-intake`;

function randomToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `mvi_${hex}`;
}

function snippet(token: string): string {
  return `<form id="mv-lead-form">
  <input name="name" placeholder="Имя" required>
  <input name="phone" placeholder="Телефон" required>
  <input name="email" placeholder="Email">
  <button type="submit">Записаться</button>
</form>
<script>
(function(){
  const TOKEN = '${token}';
  const ENDPOINT = '${ENDPOINT}';
  const cookie = (k) => (document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]+)'))||[])[1];
  document.getElementById('mv-lead-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.token = TOKEN;
    body.landing_url = location.href;
    body.referrer = document.referrer;
    body.fbc = cookie('_fbc');
    body.fbp = cookie('_fbp');
    const p = new URLSearchParams(location.search);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(k => {
      if (p.get(k)) body[k] = p.get(k);
    });
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) { e.target.reset(); alert('Спасибо! Мы свяжемся с вами.'); }
  });
})();
</script>`;
}

export function InboundTokensSettings() {
  const { cabinets } = useCabinetsStore();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [label, setLabel] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [expandedToken, setExpandedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!clientConfigSupabase) return setLoading(false);
    const { data } = await clientConfigSupabase
      .from("inbound_tokens")
      .select("token, client_id, label, is_active, created_at")
      .order("created_at", { ascending: false });
    setTokens((data ?? []) as TokenRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  const create = async () => {
    if (!clientConfigSupabase) {
      toast.error("Новый Supabase не подключен");
      return;
    }
    if (!clientId) {
      toast.error("Выберите клиента");
      return;
    }
    const tok = randomToken();
    const { error } = await clientConfigSupabase.from("inbound_tokens").insert({
      token: tok,
      client_id: clientId,
      label: label.trim() || null,
      is_active: true,
    });
    if (error) {
      toast.error(`Ошибка: ${error.message}`);
      return;
    }
    setLabel("");
    setExpandedToken(tok);
    void refetch();
    toast.success("Токен создан");
  };

  const revoke = async (tok: string) => {
    if (!clientConfigSupabase) return;
    if (!confirm("Отозвать токен? Все лендинги с ним перестанут добавлять лидов.")) return;
    await clientConfigSupabase.from("inbound_tokens").update({ is_active: false }).eq("token", tok);
    void refetch();
  };

  const copy = async (text: string, msg = "Скопировано") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="text-sm font-semibold">Создать токен лендинга</div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_auto]">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Клиент / кабинет</Label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="h-10 w-full rounded-xl border border-border/60 bg-background/60 px-3 text-sm"
            >
              <option value="">— выбрать —</option>
              {cabinets.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Метка</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Например: лендинг «Диагностика», Tilda"
              className="h-10 rounded-xl bg-background/60"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={create} className="h-10 rounded-xl">
              <Plus className="h-4 w-4" />
              Создать
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="text-sm font-semibold">Активные токены</div>
        {loading ? (
          <div className="mt-4 text-sm text-muted-foreground">Загрузка…</div>
        ) : tokens.length === 0 ? (
          <div className="mt-4 text-sm text-muted-foreground">Пока нет токенов. Создайте первый — над таблицей.</div>
        ) : (
          <div className="mt-4 space-y-2">
            {tokens.map((t) => {
              const client = cabinets.find((c) => c.id === t.client_id);
              const expanded = expandedToken === t.token;
              return (
                <div
                  key={t.token}
                  className={`rounded-xl border border-border/60 ${t.is_active ? "bg-background/40" : "bg-muted/20 opacity-60"}`}
                >
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-foreground">{t.token}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {client?.name ?? "—"} · {t.label ?? "без метки"} · {new Date(t.created_at).toLocaleDateString("ru-RU")}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => copy(t.token, "Токен скопирован")}>
                      <Copy className="h-3.5 w-3.5" /> токен
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => copy(ENDPOINT, "URL скопирован")}>
                      <Copy className="h-3.5 w-3.5" /> URL
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedToken(expanded ? null : t.token)}
                    >
                      {expanded ? "Свернуть" : "HTML-сниппет"}
                    </Button>
                    {t.is_active && (
                      <Button variant="ghost" size="sm" onClick={() => revoke(t.token)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                  {expanded && (
                    <div className="border-t border-border/60 bg-background/30 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Сниппет для лендинга</div>
                        <Button size="sm" variant="outline" onClick={() => copy(snippet(t.token))}>
                          <Copy className="h-3.5 w-3.5" /> Скопировать всё
                        </Button>
                      </div>
                      <pre className="max-h-72 overflow-auto rounded-md bg-background/80 p-3 text-[11px] leading-relaxed">
                        {snippet(t.token)}
                      </pre>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        Подходит для Tilda / Webflow / любого HTML-сайта. Если CMS не пускает свой JS — используй URL и поле <code>token</code> в форме.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
