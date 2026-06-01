import { useMemo, useState } from "react";
import {
  AlertCircle,
  AtSign,
  CheckCircle2,
  Copy,
  ExternalLink,
  Instagram,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useInstagramAccounts, type IgAccountStatus, type InstagramAccount } from "@/hooks/useInstagramAccounts";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { cn } from "@/lib/utils";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const INTAKE_URL = `${SUPABASE_URL}/functions/v1/instagram-organic-intake`;

const STATUS_LABEL: Record<IgAccountStatus, { label: string; tone: "muted" | "success" | "danger" | "warning" }> = {
  pending: { label: "Ожидает событий", tone: "muted" },
  connected: { label: "Подключён", tone: "success" },
  error: { label: "Ошибка", tone: "danger" },
  expired: { label: "Токен просрочен", tone: "warning" },
  disconnected: { label: "Отключён", tone: "muted" },
};

const StatusBadge = ({ status }: { status: IgAccountStatus }) => {
  const s = STATUS_LABEL[status];
  const cls =
    s.tone === "success" ? "bg-success/15 text-success border-success/40" :
    s.tone === "danger"  ? "bg-destructive/15 text-destructive border-destructive/40" :
    s.tone === "warning" ? "bg-warning/15 text-warning border-warning/40" :
    "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={cls}>{s.label}</Badge>;
};

interface AddDialogProps {
  onAdd: (input: { handle: string; displayName?: string | null; notes?: string | null }) => Promise<void>;
}

const AddAccountDialog = ({ onAdd }: AddDialogProps) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    if (!handle.trim()) { toast.error("Введите @username"); return; }
    setBusy(true);
    try {
      await onAdd({
        handle: handle.trim(),
        displayName: displayName.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success(`Аккаунт @${handle.replace(/^@/, "").toLowerCase()} добавлен`);
      setHandle(""); setDisplayName(""); setNotes("");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />Подключить Instagram</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Подключить Instagram аккаунт</DialogTitle>
          <DialogDescription>
            Привяжите @username — вся аналитика органического контента будет группироваться по этому аккаунту.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>@username Instagram *</Label>
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="brandname" className="pl-9" autoFocus />
            </div>
            <p className="text-[11px] text-muted-foreground">Без @, приведём к нижнему регистру.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Название (опционально)</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Основной аккаунт бренда" />
          </div>
          <div className="space-y-1.5">
            <Label>Заметка (опционально)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Аккаунт для клиники в Алматы" />
          </div>
          <div className="rounded-xl border border-success/30 bg-success/5 p-3 text-[12px]">
            <div className="flex items-center gap-1.5 font-semibold text-success">
              <ShieldCheck className="h-3.5 w-3.5" /> Безопасно
            </div>
            <p className="mt-1 text-muted-foreground">
              Мы не запрашиваем пароль Instagram. Подключение работает через webhook от вашего IG-бота (ManyChat, SaleBot, n8n + IG Graph API). На следующем шаге увидите webhook URL и токен.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Подключить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const AccountCard = ({
  account,
  intakeToken,
  onRemove,
}: {
  account: InstagramAccount;
  intakeToken: string | null;
  onRemove: (a: InstagramAccount) => void;
}) => {
  const samplePayload = useMemo(
    () => JSON.stringify(
      {
        token: intakeToken ?? "<PROJECT_TOKEN>",
        event_type: "codeword_dm",
        ig_handle: account.handle,
        codeword: "smile",
        username: "@viewer_handle",
        external_event_id: "<message_id_from_ig>",
      },
      null,
      2,
    ),
    [account.handle, intakeToken],
  );

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {account.avatarUrl ? (
            <img src={account.avatarUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-pink-500/15 text-pink-500">
              <Instagram className="h-6 w-6" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <a
                href={`https://instagram.com/${account.handle}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold hover:underline"
              >
                @{account.handle} <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
              <StatusBadge status={account.status} />
            </div>
            {account.displayName && <div className="text-sm text-muted-foreground">{account.displayName}</div>}
            <div className="mt-1 text-[11px] text-muted-foreground">
              {account.lastEventAt
                ? `Последнее событие: ${new Date(account.lastEventAt).toLocaleString("ru-RU")}`
                : "События пока не приходили"}
            </div>
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={() => onRemove(account)} title="Удалить">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {account.lastError && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">{account.lastError}</div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Webhook URL для бота</div>
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => {
            void navigator.clipboard.writeText(INTAKE_URL);
            toast.success("URL скопирован");
          }}>
            <Copy className="h-3 w-3" /> URL
          </Button>
        </div>
        <code className="mt-1.5 block break-all rounded bg-background px-2 py-1 text-[11px]">{INTAKE_URL}</code>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Пример payload для DM</div>
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => {
            void navigator.clipboard.writeText(samplePayload);
            toast.success("Payload скопирован");
          }}>
            <Copy className="h-3 w-3" /> JSON
          </Button>
        </div>
        <pre className="mt-1.5 overflow-x-auto rounded bg-background px-2 py-1 text-[11px]">{samplePayload}</pre>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Бот должен передавать <code>ig_handle: &quot;{account.handle}&quot;</code> и <code>external_event_id</code> — мы автоматически привяжем событие к этому аккаунту и не задвоим при ретраях.
        </p>
      </div>
    </div>
  );
};

const SafetyNote = () => (
  <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 text-sm">
    <div className="flex items-center gap-2 font-semibold text-warning">
      <ShieldCheck className="h-4 w-4" /> Не используем логин и пароль Instagram
    </div>
    <p className="mt-2 text-muted-foreground">
      Прямая авторизация через логин/пароль нарушает условия Meta и приводит к блокировке. Поэтому мы работаем через webhook от вашего IG-бота — он получает события официальным путём (Meta Graph API через ManyChat / SaleBot / n8n IG Cloud API).
    </p>
    <ul className="mt-3 space-y-1.5 text-[12px] text-muted-foreground">
      <li>1. Подключите аккаунт здесь — мы создадим запись и выдадим webhook URL.</li>
      <li>2. В вашем IG-боте настройте трригер «получен DM с код-словом» и отправьте POST на webhook.</li>
      <li>3. Статус автоматически перейдёт в «Подключён» как только придёт первое событие.</li>
    </ul>
  </div>
);

export function InstagramAccountsSettings() {
  const { items, loading, add, remove } = useInstagramAccounts();
  const { activeId: projectId, projects } = useProjectsStore();
  const intakeToken = projects.find((p) => p.id === projectId)?.intakeToken ?? null;
  const [toDelete, setToDelete] = useState<InstagramAccount | null>(null);

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await remove(toDelete.id);
      toast.success(`@${toDelete.handle} отвязан`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-pink-500/15 text-pink-500">
              <Instagram className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold">Instagram аккаунты</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Подключите аккаунты, по которым ведётся органический контент. Все код-слова и события (DM → клик → лид → продажа) будут группироваться по аккаунту.
              </p>
            </div>
          </div>
          <AddAccountDialog onAdd={add} />
        </div>

        <div className="mt-5"><SafetyNote /></div>

        <div className="mt-5 space-y-3">
          {loading ? (
            <>
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
              Пока ни одного подключённого аккаунта. Нажмите «Подключить Instagram» — это займёт минуту.
            </div>
          ) : (
            items.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                intakeToken={intakeToken}
                onRemove={setToDelete}
              />
            ))
          )}
        </div>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать @{toDelete?.handle}?</AlertDialogTitle>
            <AlertDialogDescription>
              История событий и код-слов сохранится. Аккаунт перестанет получать новые события до повторного подключения.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Отвязать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
