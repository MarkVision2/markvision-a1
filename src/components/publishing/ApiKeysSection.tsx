/**
 * «API-ключи»: выдача и отзыв ключей проекта для внешних клиентов
 * (MCP-сервер, агенты, скрипты). Ключ показывается один раз — сразу после
 * создания, вместе с готовым куском конфига MCP.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_SCOPE_META, publishingApi, type ApiKey, type ApiScope } from "@/lib/publishingClient";
import { supabaseUrl } from "@/lib/supabaseConfig";
import { cn } from "@/lib/utils";

type ScopePreset = "full" | "publish" | "read";
const PRESET_SCOPES: Record<ScopePreset, ApiScope[]> = {
  full: ["read", "publish", "manage"],
  publish: ["read", "publish"],
  read: ["read"],
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

export type ApiKeyState = "active" | "revoked" | "expired";

export function apiKeyState(k: Pick<ApiKey, "revoked_at" | "expires_at">, now: number = Date.now()): ApiKeyState {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && Date.parse(k.expires_at) <= now) return "expired";
  return "active";
}

const STATE_META: Record<ApiKeyState, { label: string; cls: string }> = {
  active: { label: "Активен", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  revoked: { label: "Отозван", cls: "bg-muted text-muted-foreground" },
  expired: { label: "Истёк", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

function errMsg(e: unknown, fallback = "Ошибка"): string {
  return e instanceof Error ? e.message : fallback;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface ApiKeysSectionProps {
  projectId: string | null;
}

export function ApiKeysSection({ projectId }: ApiKeysSectionProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<ScopePreset>("full");
  const [busy, setBusy] = useState<string | null>(null);
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

  const create = async () => {
    if (!projectId) return;
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Назовите ключ — по имени вы его потом узнаете"); return; }
    setBusy("create");
    try {
      const r = await publishingApi.apiKeyCreate(projectId, { name: trimmed, scopes: PRESET_SCOPES[preset] });
      setRevealed({ key: r.key, name: trimmed });
      setName("");
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

  if (!projectId) return null;

  return (
    <section className="max-w-xl space-y-4 rounded-2xl border bg-card p-4" aria-labelledby="api-keys-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="api-keys-title" className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" /> API-ключи и MCP</h3>
          <p className="text-xs text-muted-foreground">
            Ключ даёт внешнему клиенту (Claude через MCP, скрипту, n8n) доступ к этому проекту: загрузить видео,
            поставить его в очередь, управлять аккаунтами, группами и настройками. Показывается один раз при создании.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Название ключа"
          placeholder="Название, например «Claude MCP»"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
        />
        <Select value={preset} onValueChange={(v) => setPreset(v as ScopePreset)}>
          <SelectTrigger className="sm:w-56" aria-label="Права ключа"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Полный доступ</SelectItem>
            <SelectItem value="publish">Чтение и публикация</SelectItem>
            <SelectItem value="read">Только чтение</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => void create()} disabled={busy != null}>
          {busy === "create" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
          Создать ключ
        </Button>
      </div>

      {loading && keys.length === 0 ? (
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : keys.length === 0 ? (
        <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">Ключей пока нет.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Ключ</TableHead>
                <TableHead>Права</TableHead>
                <TableHead>Использован</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const state = apiKeyState(k);
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell><code className="text-xs">{k.key_prefix}…</code></TableCell>
                    <TableCell className="space-x-1">
                      {k.scopes.map((s) => <Badge key={s} variant="outline" title={API_SCOPE_META[s]?.hint}>{API_SCOPE_META[s]?.label ?? s}</Badge>)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(k.last_used_at)}</TableCell>
                    <TableCell><Badge className={cn("border-0", STATE_META[state].cls)}>{STATE_META[state].label}</Badge></TableCell>
                    <TableCell>
                      {state === "active" && (
                        <Button
                          variant="ghost" size="icon" aria-label={`Отозвать ${k.name}`}
                          disabled={busy != null} onClick={() => setRevoking(k)}
                        >
                          {busy === `revoke:${k.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Адрес API: <code>{apiBaseUrl()}</code> · описание — <code>docs/PUBLIC-API.md</code>
      </div>

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
            <AlertDialogAction onClick={() => { if (revoking) void revoke(revoking); }}>Отозвать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
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
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()} aria-label={label}>
      {done ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />} {done ? "Скопировано" : label}
    </Button>
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
          <div className="space-y-3">
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs" data-testid="api-key-value">{revealed.key}</pre>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={revealed.key} label="Скопировать ключ" />
              <CopyButton text={mcpConfigSnippet(revealed.key)} label="Скопировать конфиг MCP" />
            </div>
            <p className="text-xs text-muted-foreground">
              Конфиг MCP вставляется в <code>~/.claude.json</code> (Claude Code) или <code>claude_desktop_config.json</code>;
              путь к серверу замените на свой (сборка — <code>mcp/markvision/README.md</code>).
              После этого в чате достаточно сказать: «загрузи это видео в MarkVision и опубликуй в группу …».
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
