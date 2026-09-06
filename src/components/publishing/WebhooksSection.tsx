/**
 * «Вебхуки»: подписки проекта на события платформы. Секрет для проверки
 * подписи HMAC показывается один раз — при создании или ротации.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { publishingApi, WEBHOOK_EVENT_OPTIONS, type PublishWebhook, type WebhookDelivery } from "@/lib/publishingClient";
import { fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

const DELIVERY_CLS: Record<WebhookDelivery["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  retry: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  delivered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive",
};

export function WebhooksSection({ projectId }: { projectId: string | null }) {
  const [hooks, setHooks] = useState<PublishWebhook[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["*"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<PublishWebhook | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);

  const load = useCallback(async () => {
    if (!projectId) { setHooks([]); return; }
    try { setHooks((await publishingApi.webhookList(projectId)).webhooks ?? []); } catch { /* секция вторична */ }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); if (label) toast.success(label); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); }
  };

  const create = () => run("", async () => {
    if (!projectId) return;
    if (!name.trim() || !/^https:\/\/\S+$/i.test(url.trim())) throw new Error("Название и https-адрес обязательны");
    const r = await publishingApi.webhookUpsert(projectId, { name: name.trim(), url: url.trim(), events });
    setSecret(r.secret ?? null);
    setName(""); setUrl(""); setEvents(["*"]); setCreating(false);
  });

  const toggleEvent = (v: string, on: boolean) => {
    if (v === "*") { setEvents(on ? ["*"] : []); return; }
    setEvents((cur) => { const base = cur.filter((e) => e !== "*"); return on ? [...base, v] : base.filter((e) => e !== v); });
  };

  const openDeliveries = async (h: PublishWebhook) => {
    if (!projectId) return;
    setDeliveriesFor(h);
    try { setDeliveries((await publishingApi.webhookDeliveries(projectId, h.id)).deliveries ?? []); } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  };

  if (!projectId) return null;

  return (
    <section className="rounded-2xl border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Webhook className="h-4 w-4" /> Вебхуки</h3>
          <p className="text-xs text-muted-foreground">События платформы на ваш https-адрес с подписью HMAC-SHA256 (заголовок X-MarkVision-Signature), повторы 1 → 5 → 15 → 60 → 180 мин.</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" /> Добавить</Button>
      </div>

      {hooks.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9">Название</TableHead>
                <TableHead className="h-9">Адрес</TableHead>
                <TableHead className="h-9">События</TableHead>
                <TableHead className="h-9">Последняя доставка</TableHead>
                <TableHead className="h-9 w-[70px]">Вкл</TableHead>
                <TableHead className="h-9 w-[150px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {hooks.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="py-2 text-sm font-medium">{h.name}</TableCell>
                  <TableCell className="max-w-[260px] truncate py-2 text-xs" title={h.url}>{h.url}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">{h.events.includes("*") ? "все" : h.events.length}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {h.last_delivery_at ? <>{fmtRelative(h.last_delivery_at)} · <span className={cn(h.last_status && h.last_status >= 200 && h.last_status < 300 ? "text-emerald-600" : "text-destructive")}>HTTP {h.last_status ?? "—"}</span></> : "—"}
                  </TableCell>
                  <TableCell className="py-2"><Switch checked={h.enabled} disabled={busy} aria-label={`Включён ${h.name}`} onCheckedChange={(v) => void run(v ? "Вебхук включён" : "Вебхук выключен", () => publishingApi.webhookUpsert(projectId, { webhook_id: h.id, enabled: v }))} /></TableCell>
                  <TableCell className="py-2 text-right">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void openDeliveries(h)}>Доставки</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} aria-label={`Новый секрет ${h.name}`} title="Выдать новый секрет" onClick={() => void run("", async () => { const r = await publishingApi.webhookUpsert(projectId, { webhook_id: h.id, rotate_secret: true }); setSecret(r.secret ?? null); })}><RefreshCw className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={busy} aria-label={`Удалить ${h.name}`} onClick={() => void run("Вебхук удалён", () => publishingApi.webhookDelete(projectId, h.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={(o) => { if (!o) setCreating(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Новый вебхук</DialogTitle><DialogDescription>Секрет для проверки подписи покажем один раз после создания.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="wh-name">Название</Label><Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="n8n — отчёты" /></div>
            <div className="grid gap-1.5"><Label htmlFor="wh-url">Адрес (https)</Label><Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://n8n.example.com/webhook/markvision" /></div>
            <div className="grid gap-1.5">
              <Label>События</Label>
              <div className="grid gap-1.5">
                {WEBHOOK_EVENT_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={events.includes(o.value) || (o.value !== "*" && events.includes("*"))} disabled={o.value !== "*" && events.includes("*")} onCheckedChange={(v) => toggleEvent(o.value, Boolean(v))} />
                    {o.label} <code className="text-[11px] text-muted-foreground">{o.value}</code>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Отмена</Button>
            <Button disabled={busy || !events.length} onClick={() => void create()}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(secret)} onOpenChange={(o) => { if (!o) { setSecret(null); setCopied(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Секрет вебхука</DialogTitle><DialogDescription>Сохраните сейчас — повторно он не показывается. Проверка: HMAC-SHA256(secret, «timestamp.body») = v1 из X-MarkVision-Signature.</DialogDescription></DialogHeader>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-2 text-xs">{secret}</code>
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(secret ?? "").then(() => setCopied(true)); }} aria-label="Скопировать секрет">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deliveriesFor)} onOpenChange={(o) => { if (!o) setDeliveriesFor(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Доставки: {deliveriesFor?.name}</DialogTitle><DialogDescription>Последние 50 событий этого вебхука.</DialogDescription></DialogHeader>
          {!deliveries.length ? <p className="text-sm text-muted-foreground">Доставок ещё не было.</p> : (
            <div className="max-h-80 overflow-auto rounded-xl border">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="h-8">Событие</TableHead><TableHead className="h-8">Статус</TableHead><TableHead className="h-8 text-right">Попыток</TableHead><TableHead className="h-8">Ответ</TableHead><TableHead className="h-8">Когда</TableHead></TableRow></TableHeader>
                <TableBody>
                  {deliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="py-1.5 text-xs"><code>{d.event}</code></TableCell>
                      <TableCell className="py-1.5"><Badge variant="outline" className={cn("border-transparent text-[11px]", DELIVERY_CLS[d.status])}>{d.status}</Badge></TableCell>
                      <TableCell className="py-1.5 text-right text-xs tabular-nums">{d.attempts}</TableCell>
                      <TableCell className="max-w-[240px] truncate py-1.5 text-xs text-muted-foreground" title={d.last_error ?? ""}>{d.response_status ? `HTTP ${d.response_status}` : ""} {d.last_error ?? ""}</TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">{fmtRelative(d.delivered_at ?? d.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
