import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

interface MetaTokenRow {
  id: string;
  label: string;
  token_last4: string | null;
  is_active: boolean;
  last_validated_at: string | null;
  last_validation_status: string | null;
  created_at: string;
}

export function MetaTokensSettings() {
  const { isAdmin } = useAuth();
  const { activeId } = useProjectsStore();
  const [rows, setRows] = useState<MetaTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<MetaTokenRow | null>(null);

  const refetch = useCallback(async () => {
    if (!activeId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("meta_tokens" as never)
      .select("id,label,token_last4,is_active,last_validated_at,last_validation_status,created_at")
      .eq("project_id", activeId)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("[meta_tokens] fetch:", error.message);
    }
    setRows((data as MetaTokenRow[] | null) ?? []);
    setLoading(false);
  }, [activeId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const handleAdd = async () => {
    if (!activeId) return toast.error("Выберите проект");
    if (!label.trim()) return toast.error("Укажите название токена");
    if (token.trim().length < 20) return toast.error("Похоже, токен неполный");
    setSaving(true);
    const { error } = await supabase.from("meta_tokens" as never).insert({
      project_id: activeId,
      label: label.trim(),
      access_token: token.trim(),
    } as never);
    setSaving(false);
    if (error) {
      toast.error(error.message || "Не удалось сохранить токен");
      return;
    }
    setLabel("");
    setToken("");
    setShowToken(false);
    toast.success("Токен добавлен");
    void refetch();
  };

  const handleToggle = async (row: MetaTokenRow, next: boolean) => {
    const { error } = await supabase
      .from("meta_tokens" as never)
      .update({ is_active: next } as never)
      .eq("id", row.id);
    if (error) return toast.error(error.message);
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: next } : r)));
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    const { error } = await supabase.from("meta_tokens" as never).delete().eq("id", confirmDel.id);
    if (error) return toast.error(error.message);
    toast.success("Токен удалён");
    setConfirmDel(null);
    void refetch();
  };

  const handleValidate = async (row: MetaTokenRow) => {
    setValidatingId(row.id);
    const { data, error } = await supabase.functions.invoke("meta-list-ad-accounts", {
      body: { token_id: row.id },
    });
    setValidatingId(null);
    if (error) {
      await supabase
        .from("meta_tokens" as never)
        .update({
          last_validated_at: new Date().toISOString(),
          last_validation_status: `error: ${error.message}`,
        } as never)
        .eq("id", row.id);
      toast.error("Проверка не удалась");
      void refetch();
      return;
    }
    const count = Array.isArray((data as { accounts?: unknown[] })?.accounts)
      ? (data as { accounts: unknown[] }).accounts.length
      : 0;
    await supabase
      .from("meta_tokens" as never)
      .update({
        last_validated_at: new Date().toISOString(),
        last_validation_status: `ok: ${count} кабинет(ов)`,
      } as never)
      .eq("id", row.id);
    toast.success(`Токен работает: доступно ${count} кабинет(ов)`);
    void refetch();
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-primary">
            <KeyRound className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Meta-токены</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Добавьте один или несколько System User токенов Meta. По ним будут подключаться рекламные
              кабинеты в разделе Ads → «Быстрое подключение Meta». Значение токена скрыто и доступно
              только backend-функциям.
            </p>
          </div>
        </div>

        {isAdmin ? (
          <div className="grid gap-3 rounded-xl border border-dashed border-border/60 bg-background/40 p-4 md:grid-cols-[220px_1fr_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs">Название</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Основной токен"
                maxLength={64}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Meta Access Token</Label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="EAAG…"
                  className="pr-10 font-mono text-xs"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
                  aria-label={showToken ? "Скрыть" : "Показать"}
                >
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex items-end">
              <Button onClick={handleAdd} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Добавить
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-sm text-muted-foreground">
            Только администратор проекта может добавлять и удалять токены.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="mb-3 text-sm font-semibold">
          Сохранённые токены {rows.length > 0 && <span className="text-muted-foreground">· {rows.length}</span>}
        </div>

        {loading ? (
          <div className="grid place-items-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mb-2 h-5 w-5 animate-spin" />
            Загрузка…
          </div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            <KeyRound className="mb-2 h-6 w-6 opacity-60" />
            Ни одного токена ещё не добавлено
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-3.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{row.label}</span>
                    <Badge
                      variant="outline"
                      className={
                        row.is_active
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-border bg-muted text-muted-foreground"
                      }
                    >
                      {row.is_active ? "активен" : "выключен"}
                    </Badge>
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      ••••{row.token_last4 ?? "????"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.last_validated_at
                      ? `Проверен ${new Date(row.last_validated_at).toLocaleString("ru-RU")} · ${row.last_validation_status ?? "—"}`
                      : "Ещё не проверялся"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <>
                      <Switch
                        checked={row.is_active}
                        onCheckedChange={(v) => handleToggle(row, v)}
                        aria-label="Активен"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleValidate(row)}
                        disabled={validatingId === row.id}
                        className="gap-2"
                      >
                        {validatingId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Проверить
                      </Button>
                      <button
                        onClick={() => setConfirmDel(row)}
                        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить токен?</AlertDialogTitle>
            <AlertDialogDescription>
              Токен «{confirmDel?.label}» больше нельзя будет использовать для подключения кабинетов Meta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
