import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";

interface Row {
  token: string;
  client_id: string;
  label: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

function randomToken(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return "mvd_" + Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function ClientDashTokensSettings() {
  const { cabinets } = useCabinetsStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [label, setLabel] = useState("");
  const [clientId, setClientId] = useState("");
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!clientConfigSupabase) return setLoading(false);
    const { data } = await clientConfigSupabase
      .from("client_dashboard_tokens")
      .select("token, client_id, label, is_active, expires_at, created_at")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  const create = async () => {
    if (!clientConfigSupabase) return;
    if (!clientId) return toast.error("Выберите клиента");
    const tok = randomToken();
    const expiresAt = days
      ? new Date(Date.now() + Number(days) * 24 * 3600 * 1000).toISOString()
      : null;
    const { error } = await clientConfigSupabase.from("client_dashboard_tokens").insert({
      token: tok, client_id: clientId, label: label.trim() || null,
      expires_at: expiresAt, is_active: true,
    });
    if (error) return toast.error(error.message);
    setLabel("");
    void refetch();
    toast.success("Ссылка создана");
  };

  const revoke = async (tok: string) => {
    if (!clientConfigSupabase) return;
    if (!confirm("Отозвать доступ? Клиент потеряет возможность открывать дашборд по этой ссылке.")) return;
    await clientConfigSupabase.from("client_dashboard_tokens").update({ is_active: false }).eq("token", tok);
    void refetch();
  };

  const linkFor = (tok: string) => `${window.location.origin}/client/${tok}`;

  const copy = async (text: string, msg = "Скопировано") => {
    try { await navigator.clipboard.writeText(text); toast.success(msg); }
    catch { toast.error("Не удалось скопировать"); }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="text-sm font-semibold">Создать ссылку клиенту</div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1.5fr_2fr_1fr_auto]">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Клиент</Label>
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
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Метка (для себя)</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Например: владелец, для отчёта"
              className="h-10 rounded-xl bg-background/60"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Действует, дней</Label>
            <Input
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
              placeholder="30"
              className="h-10 rounded-xl bg-background/60"
              inputMode="numeric"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={create} className="h-10 rounded-xl"><Plus className="h-4 w-4" /> Создать</Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="text-sm font-semibold">Активные ссылки</div>
        {loading ? (
          <div className="mt-4 text-sm text-muted-foreground">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="mt-4 text-sm text-muted-foreground">Пока нет ссылок. Создайте первую — над таблицей.</div>
        ) : (
          <div className="mt-4 space-y-2">
            {rows.map((r) => {
              const client = cabinets.find((c) => c.id === r.client_id);
              const expired = r.expires_at && new Date(r.expires_at) < new Date();
              const link = linkFor(r.token);
              const status = !r.is_active ? "отозвана" : expired ? "истекла" : "активна";
              return (
                <div
                  key={r.token}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border border-border/60 p-3 ${(!r.is_active || expired) ? "bg-muted/20 opacity-60" : "bg-background/40"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-foreground">{link}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {client?.name ?? "—"} · {r.label ?? "без метки"} · {status}
                      {r.expires_at && <> · до {new Date(r.expires_at).toLocaleDateString("ru-RU")}</>}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => copy(link, "Ссылка скопирована")}>
                    <Copy className="h-3.5 w-3.5" /> ссылку
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" /> открыть
                    </a>
                  </Button>
                  {r.is_active && !expired && (
                    <Button variant="ghost" size="sm" onClick={() => revoke(r.token)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs text-foreground">
        <div className="font-semibold">Что увидит клиент</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>KPI: лиды, записавшиеся на диагностику, оплатившие, выручка.</li>
          <li>Качество лидов: счётчики Горячих/Тёплых/Холодных/Оплативших + 8-недельная гистограмма.</li>
          <li>Воронка «Лид → Записан → Оплатил» с конверсиями.</li>
          <li>Read-only. Нет кнопок, нет доступа к контактам и переписке, нет к админке.</li>
        </ul>
      </div>
    </div>
  );
}
