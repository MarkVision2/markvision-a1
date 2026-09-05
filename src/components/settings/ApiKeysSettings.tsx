/**
 * «API и MCP» в Настройках: ключи проекта для внешних клиентов (Claude через
 * MCP, скрипты, n8n) и инструкция подключения. Ключ показывается один раз —
 * сразу после создания, вместе с готовым конфигом MCP.
 */
import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, ExternalLink, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { API_SCOPE_META, publishingApi, type ApiKey, type ApiScope } from "@/lib/publishingClient";
import { supabaseUrl } from "@/lib/supabaseConfig";
import { cn } from "@/lib/utils";

/* ───────────────────────── чистые помощники (покрыты тестами) ───────────────────────── */

export type ScopePreset = "full" | "publish" | "read";

export const PRESET_META: Record<ScopePreset, { label: string; hint: string; scopes: ApiScope[] }> = {
  full: { label: "Полный доступ", hint: "публикации, аккаунты, группы, настройки проекта", scopes: ["read", "publish", "manage"] },
  publish: { label: "Чтение и публикация", hint: "загрузка видео и постановка в очередь, без правки аккаунтов", scopes: ["read", "publish"] },
  read: { label: "Только чтение", hint: "аккаунты, группы, статусы и метрики", scopes: ["read"] },
};

export type ExpiryPreset = "never" | "30" | "90" | "365";
export const EXPIRY_META: Record<ExpiryPreset, { label: string; days?: number }> = {
  never: { label: "Бессрочно" },
  "30": { label: "30 дней", days: 30 },
  "90": { label: "90 дней", days: 90 },
  "365": { label: "1 год", days: 365 },
};

export function apiBaseUrl(base: string = supabaseUrl): string {
  return `${base.replace(/\/+$/, "")}/functions/v1/api/v1`;
}

/** Путь к собранному серверу в репозитории — заменить на свой. */
export const MCP_SERVER_PATH_PLACEHOLDER = "/путь/к/markvision-a1/mcp/markvision/dist/index.js";

/** Готовый фрагмент для ~/.claude.json / claude_desktop_config.json (см. mcp/markvision/README.md). */
export function mcpConfigSnippet(key: string, base: string = supabaseUrl): string {
  return JSON.stringify({
    mcpServers: {
      markvision: {
        command: "node",
        args: [MCP_SERVER_PATH_PLACEHOLDER],
        env: { MARKVISION_API_KEY: key, MARKVISION_API_URL: apiBaseUrl(base) },
      },
    },
  }, null, 2);
}

/** Команда для терминала — тот же конфиг одной строкой. */
export function mcpAddCommand(key: string, base: string = supabaseUrl): string {
  return `claude mcp add markvision -e MARKVISION_API_KEY=${key} -e MARKVISION_API_URL=${apiBaseUrl(base)} -- node ${MCP_SERVER_PATH_PLACEHOLDER}`;
}

export function curlExample(base: string = supabaseUrl): string {
  return `curl "${apiBaseUrl(base)}/me" -H "Authorization: Bearer mv_live_…"`;
}

export type ApiKeyState = "active" | "revoked" | "expired";

export function apiKeyState(k: Pick<ApiKey, "revoked_at" | "expires_at">, now: number = Date.now()): ApiKeyState {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && Date.parse(k.expires_at) <= now) return "expired";
  return "active";
}

const STATE_META: Record<ApiKeyState, { label: string; cls: string }> = {
  active: { label: "Активен", cls: "bg-success/15 text-success border-success/30" },
  revoked: { label: "Отозван", cls: "bg-muted text-muted-foreground border-border" },
  expired: { label: "Истёк", cls: "bg-warning/15 text-warning border-warning/30" },
};

function errMsg(e: unknown, fallback = "Ошибка"): string {
  return e instanceof Error ? e.message : fallback;
}

function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/* ───────────────────────── компонент ───────────────────────── */

export function ApiKeysSettings() {
  const { activeId: projectId, active } = useProjectsStore();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealed, setRevealed] = useState<{ key: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setKeys([]); return; }
    setLoading(true);
    try {
      const r = await publishingApi.apiKeyList(projectId);
      setKeys(r.keys ?? []);
    } catch (e) {
      toast.error(errMsg(e, "Не удалось загрузить ключи"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const create = async (input: { name: string; preset: ScopePreset; expiry: ExpiryPreset }) => {
    if (!projectId) return;
    setBusy("create");
    try {
      const days = EXPIRY_META[input.expiry].days;
      const r = await publishingApi.apiKeyCreate(projectId, {
        name: input.name, scopes: PRESET_META[input.preset].scopes, ...(days ? { expires_days: days } : {}),
      });
      setCreateOpen(false);
      setRevealed({ key: r.key, name: input.name });
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (k: ApiKey) => {
    if (!projectId) return;
    setBusy(`revoke:${k.id}`);
    try {
      await publishingApi.apiKeyRevoke(projectId, k.id);
      toast.success(`Ключ «${k.name}» отозван`);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
      setRevoking(null);
    }
  };

  if (!projectId) {
    return (
      <section className="rounded-2xl border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        Выберите проект — ключи выдаются на проект.
      </section>
    );
  }

  const activeKeys = keys.filter((k) => apiKeyState(k) === "active");

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
              <KeyRound className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold">API-ключи проекта</h2>
              <p className="text-xs text-muted-foreground">
                {active?.name ? `${active.name} · ` : ""}{activeKeys.length} активных
              </p>
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)} disabled={busy != null} className="gap-2">
            <Plus className="h-4 w-4" /> Создать ключ
          </Button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          Ключ даёт внешнему клиенту доступ к этому проекту: Claude через MCP, скрипт, n8n. Через него можно
          загрузить видео и поставить его в очередь публикаций, управлять аккаунтами, группами и настройками.
          Ключ показывается один раз при создании, в базе хранится только отпечаток.
        </p>

        {loading && keys.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка…</div>
        ) : keys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            Ключей пока нет. Создайте первый — и подключите Claude за минуту.
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Ключи проекта">
            {keys.map((k) => {
              const state = apiKeyState(k);
              return (
                <li
                  key={k.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border border-border/60 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between",
                    state !== "active" && "opacity-70",
                  )}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{k.name}</span>
                      <Badge variant="outline" className={cn("text-[11px]", STATE_META[state].cls)}>{STATE_META[state].label}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{k.key_prefix}…</code>
                      <span>создан {fmtDate(k.created_at)}</span>
                      <span>использован {fmtDate(k.last_used_at, true)}</span>
                      {k.expires_at && <span>до {fmtDate(k.expires_at)}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="secondary" className="text-[11px] font-normal" title={API_SCOPE_META[s]?.hint}>
                          {API_SCOPE_META[s]?.label ?? s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {state === "active" && (
                    <Button
                      variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Отозвать ${k.name}`} disabled={busy != null} onClick={() => setRevoking(k)}
                    >
                      {busy === `revoke:${k.id}` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
                      Отозвать
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-success/15 text-success"><Bot className="h-4 w-4" /></span>
            <div>
              <h2 className="text-base font-semibold">Подключить Claude через MCP</h2>
              <p className="text-xs text-muted-foreground">Claude Code, Claude Desktop, Cursor</p>
            </div>
          </div>
          <ol className="space-y-2 text-sm">
            <Step n={1}>Создайте ключ кнопкой выше и нажмите «Скопировать конфиг MCP».</Step>
            <Step n={2}>Вставьте конфиг в <code className="rounded bg-muted px-1">~/.claude.json</code> (Claude Code) или <code className="rounded bg-muted px-1">claude_desktop_config.json</code>. Путь к серверу замените на свой: сборка описана в <code className="rounded bg-muted px-1">mcp/markvision/README.md</code>.</Step>
            <Step n={3}>В чате: «загрузи это видео в MarkVision и опубликуй в группу …». Claude сам заливает файл, выбирает аккаунты и ставит очередь.</Step>
          </ol>
        </section>

        <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-warning/15 text-warning"><ShieldCheck className="h-4 w-4" /></span>
            <div>
              <h2 className="text-base font-semibold">Прямой доступ к API</h2>
              <p className="text-xs text-muted-foreground">для скриптов, n8n и своих интеграций</p>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Адрес</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2 py-1.5 font-mono text-xs">{apiBaseUrl()}</code>
                <CopyButton text={apiBaseUrl()} label="Скопировать адрес API" compact />
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Проверка ключа</div>
              <pre className="overflow-x-auto rounded-lg bg-muted p-2 font-mono text-xs">{curlExample()}</pre>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>Заголовок <code>Authorization: Bearer mv_live_…</code> или <code>x-api-key</code>.</li>
              <li>Проект берётся из ключа, чужие объекты недоступны. Лимит 120 запросов в минуту.</li>
              <li>Права: чтение, публикация, управление. Отзыв ключа действует сразу.</li>
              <li>Видео: mp4/mov, 3–900 секунд, до 2 ГБ при загрузке через API и до 1 ГБ по внешней ссылке.</li>
            </ul>
            <a
              href="https://github.com/MarkVision2/markvision-a1/blob/main/docs/PUBLIC-API.md"
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Полное описание маршрутов <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </section>
      </div>

      <CreateKeyDialog open={createOpen} busy={busy === "create"} onOpenChange={setCreateOpen} onCreate={create} />
      <RevealDialog revealed={revealed} onClose={() => setRevealed(null)} />

      <AlertDialog open={revoking != null} onOpenChange={(o) => { if (!o) setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отозвать ключ «{revoking?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Клиенты с этим ключом сразу перестанут получать доступ. Вернуть ключ нельзя — только создать новый.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Оставить</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (revoking) void revoke(revoking); }}
            >
              Отозвать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────────────────────── части ───────────────────────── */

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">{n}</span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}

function CopyButton({ text, label, compact = false }: { text: string; label: string; compact?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error("Не удалось скопировать — выделите текст вручную");
    }
  };
  if (compact) {
    return (
      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => void copy()} aria-label={label} title={label}>
        {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()} aria-label={label}>
      {done ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />} {done ? "Скопировано" : label}
    </Button>
  );
}

interface CreateKeyDialogProps {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; preset: ScopePreset; expiry: ExpiryPreset }) => Promise<void>;
}

function CreateKeyDialog({ open, busy, onOpenChange, onCreate }: CreateKeyDialogProps) {
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<ScopePreset>("full");
  const [expiry, setExpiry] = useState<ExpiryPreset>("never");

  useEffect(() => {
    if (open) { setName(""); setPreset("full"); setExpiry("never"); }
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Назовите ключ — по имени вы его потом узнаете"); return; }
    void onCreate({ name: trimmed, preset, expiry });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новый API-ключ</DialogTitle>
          <DialogDescription>Назовите клиента и выберите, что ему разрешено.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="api-key-name">Название</Label>
            <Input
              id="api-key-name" autoFocus placeholder="Например, «Claude MCP» или «n8n»"
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Права</Label>
            <RadioGroup value={preset} onValueChange={(v) => setPreset(v as ScopePreset)} className="gap-2">
              {(Object.keys(PRESET_META) as ScopePreset[]).map((p) => (
                <label
                  key={p}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors",
                    preset === p ? "border-primary bg-primary/5" : "border-border/60 hover:bg-secondary/40",
                  )}
                >
                  <RadioGroupItem value={p} id={`scope-${p}`} className="mt-0.5" aria-label={PRESET_META[p].label} />
                  <span>
                    <span className="font-medium">{PRESET_META[p].label}</span>
                    <span className="block text-xs text-muted-foreground">{PRESET_META[p].hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label>Срок действия</Label>
            <Select value={expiry} onValueChange={(v) => setExpiry(v as ExpiryPreset)}>
              <SelectTrigger aria-label="Срок действия"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(EXPIRY_META) as ExpiryPreset[]).map((e) => (
                  <SelectItem key={e} value={e}>{EXPIRY_META[e].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Создать ключ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevealDialog({ revealed, onClose }: { revealed: { key: string; name: string } | null; onClose: () => void }) {
  return (
    <Dialog open={revealed != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ключ «{revealed?.name}» создан</DialogTitle>
          <DialogDescription>
            Сохраните его сейчас: после закрытия окна ключ больше нигде не показывается.
          </DialogDescription>
        </DialogHeader>
        {revealed && (
          <div className="space-y-4">
            <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted p-3 font-mono text-xs" data-testid="api-key-value">{revealed.key}</pre>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={revealed.key} label="Скопировать ключ" />
              <CopyButton text={mcpConfigSnippet(revealed.key)} label="Скопировать конфиг MCP" />
              <CopyButton text={mcpAddCommand(revealed.key)} label="Скопировать команду claude mcp add" />
            </div>
            <div className="rounded-lg border border-border/60 bg-background/60 p-3 text-xs text-muted-foreground">
              Конфиг MCP вставляется в <code>~/.claude.json</code> или <code>claude_desktop_config.json</code>;
              команда <code>claude mcp add</code> делает то же из терминала. Путь к серверу замените на свой.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
