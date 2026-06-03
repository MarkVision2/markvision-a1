import { useEffect, useState } from "react";
import { ExternalLink, GitBranch, Rocket, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const LOVABLE_PROJECT_URL =
  "https://lovable.dev/projects/f271a37b-306d-4edb-aaa5-782c76cf9ae3";
const LIVE_APP_URL = "https://markvision-a1.lovable.app/";

type SyncInfo = {
  git_sha?: string;
  updated_at?: string;
  label?: string;
  publish_hint?: string;
};

export function LovablePublishGuide() {
  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/lovable-sync.json?t=${Date.now()}`);
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as SyncInfo;
        if (!cancelled) setSync(data);
      } catch {
        if (!cancelled) setSync(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatedLabel = sync?.updated_at
    ? new Date(sync.updated_at).toLocaleString("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
          <Rocket className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Публикация в Lovable</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Код обновляется через GitHub → Lovable. Кнопка{" "}
            <span className="font-medium text-foreground">Publish</span> находится в
            редакторе Lovable (не внутри этого приложения).
          </p>
        </div>
      </div>

      <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Откройте проект в Lovable:{" "}
          <a
            href={LOVABLE_PROJECT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            открыть редактор
          </a>
        </li>
        <li>
          <span className="font-medium text-foreground">Project settings → Git → GitHub</span>
          {" "}
          — репозиторий <code className="text-xs">MarkVision2/markvision-a1</code>, ветка{" "}
          <code className="text-xs">main</code>. Дождитесь синхронизации.
        </li>
        <li>
          Справа вверху нажмите <span className="font-medium text-foreground">Publish</span>
          {" "}
          (первый раз) или <span className="font-medium text-foreground">Update</span> (обновить
          уже опубликованный сайт).
        </li>
        <li>
          Откройте живой сайт и обновите страницу с очисткой кэша (Ctrl+Shift+R).
        </li>
      </ol>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button asChild variant="default" className="gap-2">
          <a href={LOVABLE_PROJECT_URL} target="_blank" rel="noopener noreferrer">
            <Rocket className="h-4 w-4" />
            Открыть Lovable (Publish)
          </a>
        </Button>
        <Button asChild variant="outline" className="gap-2">
          <a href={LIVE_APP_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Живой сайт
          </a>
        </Button>
      </div>

      <div className="rounded-xl border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          Версия из GitHub (main)
        </div>
        {loading ? (
          <p className="mt-2 flex items-center gap-2">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Проверяем…
          </p>
        ) : sync ? (
          <ul className="mt-2 space-y-1">
            <li>
              Коммит: <code>{sync.git_sha ?? "—"}</code>
              {updatedLabel ? ` · ${updatedLabel}` : ""}
            </li>
            {sync.label && <li>{sync.label}</li>}
            {sync.publish_hint && <li className="text-primary/90">{sync.publish_hint}</li>}
          </ul>
        ) : (
          <p className="mt-2">
            Файл lovable-sync.json не найден — после синхронизации Git в Lovable появится
            метка версии.
          </p>
        )}
        <p className="mt-2">
          Если в Preview нет кнопки «Быстро из Meta» — Git в Lovable не подключён или не
          подтянулась ветка main.
        </p>
      </div>
    </section>
  );
}
