import { useEffect, useState } from "react";
import { AtSign, Check, Instagram, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import {
  formatCreativeUsernameDisplay,
  normalizeCreativeUsername,
} from "@/lib/projectCreativeUsername";
import { toast } from "sonner";

export function CreativeUsernamePanel() {
  const { active, activeId, creativeUsernameAvailable, updateCreativeUsername } = useProjectsStore();
  const { account } = useInstagramAccount();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(active?.creativeUsername ?? "");
    setSaved(false);
  }, [active?.creativeUsername, activeId]);

  const display = formatCreativeUsernameDisplay(active?.creativeUsername);
  const dirty = normalizeCreativeUsername(value) !== normalizeCreativeUsername(active?.creativeUsername);

  const handleSave = async () => {
    if (!activeId) {
      toast.error("Выберите проект");
      return;
    }
    setSaving(true);
    try {
      await updateCreativeUsername(activeId, value);
      setSaved(true);
      const nick = formatCreativeUsernameDisplay(normalizeCreativeUsername(value));
      toast.success(nick ? `Ник сохранён: ${nick}` : "Ник очищен — на креативах подпись не используется");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить ник");
    } finally {
      setSaving(false);
    }
  };

  const handleUseConnectedIg = () => {
    if (!account?.username) return;
    setValue(account.username);
    setSaved(false);
  };

  return (
    <section className="mb-4 rounded-2xl border border-border/60 bg-card/50 p-4 sm:mb-6 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <AtSign className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold sm:text-base">Ник на креативах</h2>
              <p className="text-xs text-muted-foreground">
                Instagram-аккаунт проекта — подпись на баннерах и каруселях
              </p>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Укажите ник, например <span className="font-mono text-foreground">@zapoinov</span>.
            Если поле пустое — в webhook поле <span className="font-mono">username</span> не отправляется
            и подпись на креативе не ставится.
          </p>

          {!creativeUsernameAvailable && (
            <p className="mt-2 text-xs text-warning">
              Сохранение ника временно недоступно — примените миграцию{" "}
              <span className="font-mono">20260609190000_projects_creative_username.sql</span> в Supabase.
              Список проектов при этом работает.
            </p>
          )}

          {display && (
            <p className="mt-2 text-xs text-success">
              Сейчас для проекта «{active?.name ?? "—"}»: <strong>{display}</strong>
            </p>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 sm:max-w-sm">
          <div className="relative">
            <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={value}
              onChange={(e) => {
                setValue(e.target.value.replace(/\s/g, ""));
                setSaved(false);
              }}
              placeholder="zapoinov"
              className="pl-9 font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {account?.username && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleUseConnectedIg}
              >
                <Instagram className="h-3.5 w-3.5" />
                @{account.username}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={!dirty || saving || !activeId || !creativeUsernameAvailable}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saved && !dirty ? (
                <Check className="h-3.5 w-3.5" />
              ) : null}
              Сохранить
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
