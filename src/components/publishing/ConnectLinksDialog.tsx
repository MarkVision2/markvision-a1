/**
 * Ссылки-приглашения: «клиент подключает свой аккаунт сам».
 *
 * Менеджер создаёт ссылку (кому, какие площадки, срок, сколько аккаунтов),
 * копирует и отправляет в мессенджер. Клиент открывает /connect/<token>,
 * входит на площадке — аккаунт появляется в сетке проекта, и здесь же видно,
 * кто именно приехал по какой ссылке.
 *
 * Одно окно на весь цикл: создать → скопировать → следить → отозвать. Отзыв
 * обратим (кнопка «Вернуть»), удаление — нет, но подключённые аккаунты после
 * него остаются: рвётся только связь со ссылкой.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { UsePublishing } from "@/hooks/usePublishing";
import {
  CONNECT_LINK_STATE_META,
  PLATFORM_META,
  connectLinkHref,
  createConnectLink,
  deleteConnectLink,
  listConnectLinks,
  revokeConnectLink,
  type ConnectLink,
  type PublishPlatform,
} from "@/lib/publishingClient";
import { fmtExact, fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

const NONE = "__none";
const ALL_PLATFORMS: PublishPlatform[] = ["instagram", "tiktok", "youtube", "threads"];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Ошибка";
}

/** Срок жизни ссылки: клиент редко открывает её позже недели, но бывает всякое. */
const EXPIRY_OPTIONS = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: NONE, label: "Без срока" },
];

function CopyButton({ link }: { link: ConnectLink }) {
  const [copied, setCopied] = useState(false);
  const href = connectLinkHref(link);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Буфер закрыт политикой браузера — показываем адрес, чтобы скопировать руками.
      toast.info(href);
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()} disabled={link.state !== "active"}>
      {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
      {copied ? "Скопировано" : "Копировать"}
    </Button>
  );
}

function LinkRow({ link, onChanged, pub }: { link: ConnectLink; onChanged: () => void; pub: UsePublishing }) {
  const [busy, setBusy] = useState(false);
  const state = CONNECT_LINK_STATE_META[link.state];
  const platforms = link.platforms?.length ? link.platforms : ALL_PLATFORMS;
  const group = pub.groups.find((g) => g.id === link.group_id);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (!pub.projectId) return;
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{link.label}</span>
        <Badge variant="outline" className={cn("border-transparent text-[10px]", state.cls)}>{state.label}</Badge>
        {platforms.map((p) => (
          <Badge key={p} variant="outline" className={cn("border-transparent text-[10px]", PLATFORM_META[p].cls)}>
            {PLATFORM_META[p].label}
          </Badge>
        ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>Подключено {link.used_count}{link.max_uses != null && ` из ${link.max_uses}`}</span>
        {group && <span>→ группа «{group.name}»</span>}
        {link.expires_at && <span title={fmtExact(link.expires_at)}>действует до {fmtRelative(link.expires_at)}</span>}
        {link.last_used_at && <span>последний раз {fmtRelative(link.last_used_at)}</span>}
      </div>

      {link.accounts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          {link.accounts.map((a) => (
            <Badge key={`${a.platform}-${a.account_name}`} variant="secondary" className="text-[10px] font-normal">
              {a.account_name}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2 py-1 text-xs">{connectLinkHref(link)}</code>
        <CopyButton link={link} />
        {link.revoked_at ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(() => revokeConnectLink(pub.projectId!, link.id, false), "Ссылка снова активна")}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Вернуть
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(() => revokeConnectLink(pub.projectId!, link.id), "Ссылка отозвана")}>
            Отозвать
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          disabled={busy}
          aria-label="Удалить ссылку"
          onClick={() => {
            if (!confirm(`Удалить ссылку «${link.label}»? Подключённые по ней аккаунты останутся в проекте.`)) return;
            void act(() => deleteConnectLink(pub.projectId!, link.id), "Ссылка удалена");
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export function ConnectLinksDialog({ open, onClose, pub }: { open: boolean; onClose: () => void; pub: UsePublishing }) {
  const projectId = pub.projectId;
  const [links, setLinks] = useState<ConnectLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [platforms, setPlatforms] = useState<Set<PublishPlatform>>(new Set(ALL_PLATFORMS));
  const [groupId, setGroupId] = useState<string>(NONE);
  const [expiry, setExpiry] = useState<string>("30");
  const [maxUses, setMaxUses] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setLinks(await listConnectLinks(projectId));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const create = async () => {
    if (!projectId) return;
    if (!label.trim()) { toast.error("Напишите, кому выдаёте ссылку — иначе в списке не разобраться"); return; }
    setCreating(true);
    try {
      const link = await createConnectLink(projectId, {
        label: label.trim(),
        note: note.trim() || null,
        platforms: [...platforms],
        group_id: groupId === NONE ? null : groupId,
        expires_days: expiry === NONE ? null : Number(expiry),
        max_uses: maxUses.trim() ? Number(maxUses) : null,
      });
      setLinks((prev) => [link, ...prev]);
      setLabel("");
      setNote("");
      setMaxUses("");
      // Ссылку сразу в буфер: за созданием всегда следует «отправить клиенту».
      try {
        await navigator.clipboard.writeText(connectLinkHref(link));
        toast.success("Ссылка создана и скопирована — отправьте её клиенту");
      } catch {
        toast.success("Ссылка создана");
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Подключение по ссылке</DialogTitle>
          <DialogDescription>
            Клиенту не нужен доступ в MarkVision: он открывает ссылку в своём браузере, входит на площадке — и аккаунт
            появляется в сетке со статусом, статистикой и здоровьем.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-xl border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cl-label">Кому выдаём</Label>
              <Input id="cl-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Блогер Асель" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-group">В какую группу класть</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger id="cl-group"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Без группы</SelectItem>
                  {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Какие площадки предложить</Label>
            <div className="flex flex-wrap gap-3">
              {ALL_PLATFORMS.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={platforms.has(p)}
                    onCheckedChange={(v) => setPlatforms((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(p); else next.delete(p);
                      // Пустой набор бессмысленен — держим хотя бы одну площадку.
                      return next.size ? next : prev;
                    })}
                  />
                  {PLATFORM_META[p].label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cl-expiry">Срок действия</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="cl-expiry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-max">Сколько аккаунтов можно подключить</Label>
              <Input id="cl-max" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} placeholder="без ограничения" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cl-note">Записка клиенту (необязательно)</Label>
            <Textarea id="cl-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Асель, подключите, пожалуйста, рабочий Instagram — публиковать будем по графику." />
          </div>

          <Button className="w-full" disabled={creating} onClick={() => void create()}>
            {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            Создать ссылку
          </Button>
        </div>

        <div className="min-h-0">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Выданные ссылки</h3>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {links.length === 0 && !loading ? (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              Пока ни одной ссылки. Создайте первую — и отправьте клиенту.
            </p>
          ) : (
            <ScrollArea className="max-h-[38vh] pr-2">
              <div className="space-y-2">
                {links.map((l) => <LinkRow key={l.id} link={l} pub={pub} onChanged={() => void load()} />)}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
