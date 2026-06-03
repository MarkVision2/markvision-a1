import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  Facebook,
  Loader2,
  Megaphone,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useMetaAdAccounts,
  type AvailableMetaAdAccount,
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
  const [available, setAvailable] = useState<AvailableMetaAdAccount[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListError(null);
    const { accounts, error } = await listAvailable(
      existingActIds,
      accessToken.trim() || undefined,
    );
    setAvailable(accounts);
    if (error) setListError(error);
  }, [listAvailable, existingActIds, accessToken]);

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
              Проверьте META_ACCESS_TOKEN и права: ads_read, business_management.
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          Повторить
        </Button>
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="space-y-4 py-8 text-center">
        <Megaphone className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          Не нашли новых рекламных кабинетов для этого токена.
          {existingActIds.length > 0 ? " Возможно, все уже добавлены в проект." : ""}
        </p>
        <Button variant="outline" onClick={onManual}>
          Ввести ID кабинета вручную
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {available.map((acc) => (
          <button
            key={acc.id}
            type="button"
            onClick={() => onSelect(acc)}
            className="flex w-full items-center gap-3 rounded-xl border border-border/60 p-4 text-left transition hover:border-success/50 hover:bg-success/5"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Facebook className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{acc.name}</div>
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
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
        <Label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Shield className="h-3.5 w-3.5" />
          Свой Access Token (опционально)
        </Label>
        <Input
          type="password"
          value={accessToken}
          onChange={(e) => onAccessTokenChange(e.target.value)}
          placeholder="EAA…"
          className="h-11 rounded-xl bg-background/60"
        />
        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => void load()}>
          Обновить список
        </Button>
      </div>
    </div>
  );
}
