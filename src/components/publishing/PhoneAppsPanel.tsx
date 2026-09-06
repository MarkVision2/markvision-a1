/**
 * Приложения площадок на телефоне: что стоит, что поставить и как привести в чувство.
 *
 * Версия здесь не косметика: шаблон прогрева требует ровно свою (Instagram — 412.0.0.35.87)
 * и падает на сервере PhoneGrid, не доходя до телефона, если стоит другая. Поверх чужой
 * версии нужная не встанет — только снести и поставить, поэтому переустановка вынесена
 * отдельной кнопкой и честно предупреждает, что вход в аккаунт слетит.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  installApp, phoneAppClear, phoneAppRestart, phoneAppStop, uninstallApp, PHONE_APPS,
  type PhoneApps,
} from "@/lib/accountDevices";

export function PhoneAppsPanel({
  projectId, phoneId, apps, busy, onAct, onReload,
}: {
  projectId: string;
  phoneId: string;
  apps: PhoneApps | null;
  busy: boolean;
  /** Действие на телефоне + свежий кадр после него — общий обработчик окна. */
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
  onReload: () => void;
}) {
  // Стирание данных подтверждаем вторым нажатием: отменить его нельзя, вход слетает.
  const [confirmClear, setConfirmClear] = useState<string | null>(null);

  if (!apps) return <p className="text-sm text-muted-foreground">Читаем список приложений…</p>;

  const installedOf = (pkg: string) => apps.installed.find((a) => a.packageName === pkg);

  return (
    <div className="space-y-3">
      {apps.catalog.map((c) => {
        const inst = installedOf(c.packageName);
        const label = PHONE_APPS[c.packageName === PHONE_APPS.tiktok.packageName ? "tiktok" : "instagram"].label;
        const mismatch = Boolean(inst && c.warmupVersion && inst.version !== c.warmupVersion);
        return (
          <div key={c.packageName} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{label}</span>
                {inst
                  ? <Badge variant={mismatch ? "destructive" : "outline"}>{inst.version}</Badge>
                  : <Badge variant="secondary">не установлен</Badge>}
              </div>
              {inst && !mismatch && c.warmupVersion && (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <Check className="h-3 w-3" /> версия под прогрев
                </span>
              )}
            </div>

            {mismatch && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Прогрев требует ровно {c.warmupVersion} и не запустится на этой версии.
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              {!inst && (
                <Button
                  size="sm" variant="outline" disabled={busy || !c.installVersionId}
                  onClick={() => void onAct(async () => {
                    await installApp(projectId, phoneId, c.installVersionId!);
                    toast.success(`${label} ставится — займёт до минуты`);
                    setTimeout(onReload, 30_000);
                  })}
                >
                  Поставить {c.installVersion ?? ""}
                </Button>
              )}

              {mismatch && (
                <Button
                  size="sm" variant="outline" disabled={busy || !c.installVersionId}
                  title="Снесём и поставим версию под прогрев. Вход в аккаунт при этом слетит."
                  onClick={() => void onAct(async () => {
                    await uninstallApp(projectId, phoneId, c.packageName);
                    await installApp(projectId, phoneId, c.installVersionId!);
                    toast.success(`${label} переставляется на ${c.warmupVersion} — до минуты`);
                    setTimeout(onReload, 30_000);
                  })}
                >
                  Переустановить под прогрев
                </Button>
              )}

              {inst && (
                <Button
                  size="sm" variant="outline" disabled={busy}
                  title="Закрыть и открыть заново — помогает, когда приложение подвисло"
                  onClick={() => void onAct(() => phoneAppRestart(projectId, phoneId, c.packageName))}
                >
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Перезапустить
                </Button>
              )}

              {inst && (
                <Button
                  size="sm" variant="outline" disabled={busy}
                  title="Закрыть приложение — следующий вход начнётся с чистого экрана"
                  onClick={() => void onAct(() => phoneAppStop(projectId, phoneId, c.packageName))}
                >
                  Закрыть
                </Button>
              )}

              {inst && (
                <Button
                  size="sm" variant={confirmClear === c.packageName ? "destructive" : "outline"}
                  disabled={busy}
                  title="Стереть данные: приложение станет как только что установленное, вход в аккаунт слетит. Версия останется прежней."
                  onClick={() => {
                    if (confirmClear !== c.packageName) {
                      setConfirmClear(c.packageName);
                      return;
                    }
                    setConfirmClear(null);
                    void onAct(async () => {
                      await phoneAppClear(projectId, phoneId, c.packageName);
                      toast.success(`${label} очищен — можно заводить другой аккаунт`);
                    });
                  }}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {confirmClear === c.packageName ? "Точно стереть вход?" : "Выйти из аккаунта"}
                </Button>
              )}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground">
        «Выйти из аккаунта» стирает данные приложения, но оставляет версию — так на том же
        телефоне заводят следующий аккаунт. Переустановка версию меняет, поэтому её жмут
        только когда прогрев ругается на несовпадение.
      </p>
    </div>
  );
}
