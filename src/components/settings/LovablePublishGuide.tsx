import { useEffect, useState } from "react";
import { ExternalLink, GitBranch, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const LOVABLE_PROJECT_URL =
  "https://lovable.dev/projects/f271a37b-306d-4edb-aaa5-782c76cf9ae3";
const LIVE_APP_URL = "https://markvision-a1.lovable.app/";
const GITHUB_MAIN = "https://github.com/MarkVision2/markvision-a1/tree/main";

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
          <Zap className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Обновления на живом сайте</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Проект подключён к GitHub. Кнопки <span className="font-medium text-foreground">Publish</span> в
            Lovable может не быть — это нормально. Фронт выкатывается автоматически из ветки{" "}
            <code className="text-xs">main</code> после мержа в GitHub.
          </p>
        </div>
      </div>

      <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Смержите изменения в GitHub → ветка{" "}
          <a
            href={GITHUB_MAIN}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            main
          </a>
          .
        </li>
        <li>
          В Lovable:{" "}
          <span className="font-medium text-foreground">Project settings → Git</span>
          {" "}
          — статус <span className="font-medium text-foreground">Connected</span>, репозиторий{" "}
          <code className="text-xs">MarkVision2/markvision-a1</code>. Подождите 2–5 минут.
        </li>
        <li>
          Откройте{" "}
          <a
            href={LIVE_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            markvision-a1.lovable.app
          </a>
          {" "}
          и нажмите <span className="font-medium text-foreground">Ctrl+Shift+R</span> (жёсткое обновление).
        </li>
        <li>
          Проверьте коммит ниже — он должен совпасть с последним в{" "}
          <code className="text-xs">main</code> на GitHub.
        </li>
      </ol>

      <div className="mb-4 rounded-xl border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Если Publish всё же есть</p>
        <p className="mt-1">
          Иногда кнопка в правом верхнем углу редактора Lovable или в меню Share. Если Git
          подключён — она не обязательна.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button asChild variant="default" className="gap-2">
          <a href={LIVE_APP_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Открыть живой сайт
          </a>
        </Button>
        <Button asChild variant="outline" className="gap-2">
          <a href={LOVABLE_PROJECT_URL} target="_blank" rel="noopener noreferrer">
            <GitBranch className="h-4 w-4" />
            Настройки Git в Lovable
          </a>
        </Button>
      </div>

      <div className="rounded-xl border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          Версия на живом сайте (из GitHub main)
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
          </ul>
        ) : (
          <p className="mt-2">
            Файл lovable-sync.json не найден — подождите синхронизацию после push в main.
          </p>
        )}
        <p className="mt-2">
          Edge Functions (Meta, превью креативов) — отдельно в Supabase, не через Lovable.
        </p>
      </div>
    </section>
  );
}
