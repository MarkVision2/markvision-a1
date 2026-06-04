import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Facebook,
  Loader2,
  Megaphone,
  Save,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useMetaAdAccounts,
  type AvailableMetaAdAccount,
  type MetaListDiagnostics,
} from "@/hooks/useMetaAdAccounts";

const STATUS_RU: Record<string, string> = {
  active: "Активен",
  disabled: "Отключён",
  unsettled: "Не урегулирован",
  pending_risk_review: "Проверка риска",
  pending_settlement: "Ожидает расчёта",
  in_grace_period: "Грейс-период",
  pending_closure: "Закрывается",
  closed: "Закрыт",
  unknown: "Неизвестно",
};

function normalizeActId(id: string): string {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

function AccountRow({
  acc,
  disabled,
  badge,
  onSelect,
}: {
  acc: AvailableMetaAdAccount;
  disabled?: boolean;
  badge?: string;
  onSelect?: () => void;
}) {
  const inner = (
    <>
      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
          disabled ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
        )}
      >
        <Facebook className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-semibold">{acc.name}</div>
          {badge && (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {acc.id}
          {acc.business_name ? ` · ${acc.business_name}` : ""}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {acc.currency}
          {" · "}
          {STATUS_RU[acc.status_label] ?? acc.status_label}
          {acc.timezone_name ? ` · ${acc.timezone_name}` : ""}
        </div>
      </div>
      {disabled ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  if (disabled) {
    return (
      <div
        className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 text-left opacity-80"
        aria-disabled
      >
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-xl border border-border/60 p-4 text-left transition hover:border-success/50 hover:bg-success/5"
    >
      {inner}
    </button>
  );
}

interface Props {
  active: boolean;
  existingActIds: string[];
  accessToken: string;
  onAccessTokenChange: (v: string) => void;
  onSelect: (acc: AvailableMetaAdAccount) => void;
  onManual: () => void;
}

export function AddCabinetPickStep({
  active,
  existingActIds,
  accessToken,
  onAccessTokenChange,
  onSelect,
  onManual,
}: Props) {
  const { listAvailable, listing } = useMetaAdAccounts();
  const [allAccounts, setAllAccounts] = useState<AvailableMetaAdAccount[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<MetaListDiagnostics | null>(null);

  const existingSet = useMemo(
    () => new Set(existingActIds.map(normalizeActId).filter(Boolean)),
    [existingActIds],
  );

  const { newAccounts, linkedAccounts } = useMemo(() => {
    const linked: AvailableMetaAdAccount[] = [];
    const fresh: AvailableMetaAdAccount[] = [];
    for (const acc of allAccounts) {
      if (existingSet.has(normalizeActId(acc.id))) linked.push(acc);
      else fresh.push(acc);
    }
    return { newAccounts: fresh, linkedAccounts: linked };
  }, [allAccounts, existingSet]);

  const load = useCallback(async () => {
    setListError(null);
    setDiagnostics(null);
    const { accounts, error, diagnostics: diag } = await listAvailable(accessToken.trim() || undefined);
    setAllAccounts(accounts);
    setDiagnostics(diag ?? null);
    if (error) setListError(error);
  }, [listAvailable, accessToken]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  if (listing) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Загружаем рекламные кабинеты, привязанные к Meta-токену…
        </p>
      </div>
    );
  }

  if (listError) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Не удалось получить список</div>
            <div className="mt-1">{listError}</div>
            <div className="mt-2 text-[11px] opacity-80">
              Проверьте Meta-токен в Настройках → Автоматизация (или введите ниже).
              Нужны права ads_read и business_management. Если ошибка «Edge Function» —
              задеплойте функции meta-list-ad-accounts и meta-daily-sync на Supabase.
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          Повторить
        </Button>
      </div>
    );
  }

  if (allAccounts.length === 0) {
    return (
      <div className="space-y-4">
        <div className="py-4 text-center">
          <Megaphone className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            {diagnostics?.meta_hint ??
              "Meta не вернула рекламных кабинетов. Укажите Access Token ниже или ID вручную."}
          </p>
          {diagnostics?.token_identity && (
            <p className="mt-2 text-xs text-muted-foreground">
              Токен: {diagnostics.token_identity.name} ({diagnostics.token_identity.id})
            </p>
          )}
          {diagnostics?.sources && diagnostics.sources.length > 0 && (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
              Запросы: {diagnostics.sources.join(", ")}
            </p>
          )}
        </div>
        <TokenRefreshBlock
          accessToken={accessToken}
          onAccessTokenChange={onAccessTokenChange}
          onRefresh={() => void load()}
        />
        <Button variant="outline" className="w-full" onClick={onManual}>
          Ввести ID кабинета вручную
        </Button>
      </div>
    );
  }

  if (newAccounts.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-center text-sm text-muted-foreground">
          Все кабинеты с этого токена уже добавлены в проект ({linkedAccounts.length}).
          Выберите другой токен или добавьте кабинет по ID вручную.
        </p>
        <div className="space-y-2">
          {linkedAccounts.map((acc) => (
            <AccountRow key={acc.id} acc={acc} disabled badge="Уже в проекте" />
          ))}
        </div>
        <Button variant="outline" className="w-full" onClick={onManual}>
          Ввести ID кабинета вручную
        </Button>
        <TokenRefreshBlock
          accessToken={accessToken}
          onAccessTokenChange={onAccessTokenChange}
          onRefresh={() => void load()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {newAccounts.map((acc) => (
          <AccountRow key={acc.id} acc={acc} onSelect={() => onSelect(acc)} />
        ))}
      </div>

      {linkedAccounts.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Уже в проекте
          </p>
          {linkedAccounts.map((acc) => (
            <AccountRow key={acc.id} acc={acc} disabled badge="Добавлен" />
          ))}
        </div>
      )}

      <TokenRefreshBlock
        accessToken={accessToken}
        onAccessTokenChange={onAccessTokenChange}
        onRefresh={() => void load()}
      />
    </div>
  );
}

function TokenRefreshBlock({
  accessToken,
  onAccessTokenChange,
  onRefresh,
}: {
  accessToken: string;
  onAccessTokenChange: (v: string) => void;
  onRefresh: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const saveToken = async () => {
    const t = accessToken.trim();
    if (!t) {
      toast.error("Сначала вставьте токен");
      return;
    }
    setSaving(true);
    const { error } = await (supabase.from("automation_settings" as never) as unknown as {
      update: (v: Record<string, unknown>) => { eq: (col: string, val: unknown) => Promise<{ error: { message: string } | null }> };
    })
      .update({ meta_access_token: t })
      .eq("id", true);
    setSaving(false);
    if (error) {
      toast.error("Не сохранено: " + error.message);
      return;
    }
    toast.success("Токен сохранён в Настройки → Автоматизация");
    onRefresh();
  };

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-background/40 p-3">
      <Label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Shield className="h-3.5 w-3.5" />
        Свой Access Token
      </Label>
      <Input
        type="password"
        value={accessToken}
        onChange={(e) => onAccessTokenChange(e.target.value)}
        placeholder="EAA…"
        className="h-11 rounded-xl bg-background/60"
      />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={onRefresh}>
          Обновить список
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 gap-1"
          onClick={saveToken}
          disabled={saving || !accessToken.trim()}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Сохранить в настройки
        </Button>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">
        После сохранения список будет загружаться автоматически без повторного ввода.
        Требуются права <b>ads_read</b> и <b>business_management</b>.
      </p>
    </div>
  );
}
