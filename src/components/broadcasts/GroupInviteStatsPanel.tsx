import { useState } from "react";
import { Copy, ExternalLink, Link2, Loader2, RefreshCw, UserPlus, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  trackedInviteUrl,
  useGroupInviteStats,
  type GroupInviteLinkStat,
} from "@/hooks/useGroupInviteStats";

function fmtPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length >= 11) return `+${d.slice(0, 1)} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.length >= 10) return `+${d}`;
  return digits;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LinkCard({
  link,
  joins,
  clickDays,
}: {
  link: GroupInviteLinkStat;
  joins: { phoneDigits: string; firstSeenAt: string; leadId: string | null; leadName: string | null }[];
  clickDays: { date: string; clicks: number }[];
}) {
  const [showJoins, setShowJoins] = useState(false);
  const publicUrl = trackedInviteUrl(link.slug);
  const cr = link.clickCount > 0 ? Math.round((link.joinCount / link.clickCount) * 100) : 0;

  const copy = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} скопирована`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
              <Link2 className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">{link.label || link.slug}</div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">/g/{link.slug}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded-lg border border-border/50 bg-background/50 px-2.5 py-1.5 text-xs">
              {publicUrl}
            </code>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void copy(publicUrl, "Ссылка")}>
              <Copy className="h-3.5 w-3.5" />
              Копировать
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5" asChild>
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Открыть
              </a>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Раздавайте только эту ссылку — не сырой chat.whatsapp.com. Можно добавить{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => void copy(trackedInviteUrl(link.slug, "vit"), "Ссылка с utm")}
            >
              ?utm_source=vit
            </button>
            {" "}и т.п.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:min-w-[320px] sm:grid-cols-4">
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <MousePointerClick className="h-3 w-3" /> Клики
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">{link.clickCount}</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <UserPlus className="h-3 w-3" /> По ссылке
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-cyan-400">{link.joinCount}</div>
            <div className="text-[10px] text-muted-foreground">после метки</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">В группе</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{link.membersNow}</div>
            <div className="text-[10px] text-muted-foreground">сейчас всего</div>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">CR ссылки</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{link.clickCount > 0 ? `${cr}%` : "—"}</div>
            <div className="text-[10px] text-muted-foreground">вступ. / клик</div>
          </div>
        </div>
      </div>

      {clickDays.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {clickDays.slice(0, 7).map((d) => (
            <span
              key={d.date}
              className="rounded-md border border-border/40 bg-background/30 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground"
            >
              {d.date.slice(5)} · {d.clicks} клик.
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => setShowJoins((v) => !v)}
        >
          {showJoins ? "Скрыть список" : `Кто вступил по ссылке (${joins.length})`}
        </button>
        {!link.baselineTaken && (
          <span className="text-[11px] text-warning">Идёт съём baseline состава группы…</span>
        )}
      </div>

      {showJoins && (
        <div className="mt-2 overflow-hidden rounded-xl border border-border/50">
          {joins.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              Пока никто новый не вступил после старта трекинга. Обновляется каждые ~5 мин.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Когда</th>
                  <th className="px-3 py-2 text-left font-medium">Телефон</th>
                  <th className="px-3 py-2 text-left font-medium">CRM</th>
                </tr>
              </thead>
              <tbody>
                {joins.map((j) => (
                  <tr key={`${j.phoneDigits}-${j.firstSeenAt}`} className="border-t border-border/40">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtWhen(j.firstSeenAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{fmtPhone(j.phoneDigits)}</td>
                    <td className="px-3 py-2">
                      {j.leadName ? (
                        <span className="text-foreground">{j.leadName}</span>
                      ) : (
                        <span className="text-muted-foreground">нет лида</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function GroupInviteStatsPanel() {
  const { links, joinsByLink, clicksByLink, loading, error, refetch } = useGroupInviteStats();

  if (!loading && links.length === 0 && !error) return null;

  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Ссылки в WhatsApp-группу</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            «По ссылке» — новые после старта трекинга. «В группе» — весь текущий состав WA.
            Не путать с карточкой «Из рассылок» выше.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void refetch()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Обновить
        </Button>
      </div>

      {error && (
        <div className={cn("rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive")}>
          {error}
        </div>
      )}

      {loading && links.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка…
        </div>
      ) : (
        links.map((link) => (
          <LinkCard
            key={link.id}
            link={link}
            joins={joinsByLink[link.id] ?? []}
            clickDays={clicksByLink[link.id] ?? []}
          />
        ))
      )}
    </section>
  );
}
