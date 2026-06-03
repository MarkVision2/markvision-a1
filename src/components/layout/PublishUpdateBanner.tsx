import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const LOVABLE_EDITOR =
  "https://lovable.dev/projects/f271a37b-306d-4edb-aaa5-782c76cf9ae3";
const DISMISS_KEY = "mv_publish_banner_dismissed";

type SyncInfo = { git_sha?: string; label?: string };

export function PublishUpdateBanner() {
  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setHidden(false);
    fetch(`/lovable-sync.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSync(d as SyncInfo | null))
      .catch(() => setSync(null));
  }, []);

  if (hidden) return null;

  return (
    <div className="border-b border-primary/30 bg-primary/10 px-3 py-2 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2 text-xs sm:text-sm">
          <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-foreground/90">
            <span className="font-medium">Обновления в GitHub</span>
            {sync?.git_sha ? ` (${sync.git_sha})` : ""}
            {" — "}
            подтяните в Lovable через Git sync, затем{" "}
            <span className="font-medium">Publish → Update</span> в редакторе.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild size="sm" variant="default" className="h-8 rounded-lg">
            <a href={LOVABLE_EDITOR} target="_blank" rel="noopener noreferrer">
              Publish в Lovable
            </a>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8 rounded-lg">
            <Link to="/settings?tab=publish">Инструкция</Link>
          </Button>
          <button
            type="button"
            aria-label="Скрыть"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-background/80"
            onClick={() => {
              try {
                localStorage.setItem(DISMISS_KEY, "1");
              } catch {
                /* ignore */
              }
              setHidden(true);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
