import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Search, Sparkles, Tag } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lead, LeadStage } from "@/types/crm";

interface ClientsViewProps {
  leads: Lead[];
  stages: LeadStage[];
  onOpenLead: (lead: Lead) => void;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return `${d} д назад`;
}

export function ClientsView({ leads, stages, onOpenLead }: ClientsViewProps) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const sources = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.source && set.add(l.source));
    return Array.from(set).sort();
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      const okSrc = sourceFilter === "all" || l.source === sourceFilter;
      if (!okSrc) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q) ||
        (l.email ?? "").toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        (l.utm?.campaign ?? "").toLowerCase().includes(q) ||
        (l.utm?.source ?? "").toLowerCase().includes(q)
      );
    });
  }, [leads, search, sourceFilter]);

  const exportCsv = () => {
    const rows = [
      [
        "Имя",
        "Телефон",
        "Email",
        "Источник",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
        "Landing",
        "Referrer",
        "LTV ($)",
        "AI-рейтинг",
        "Этап",
        "Активность",
      ],
      ...filtered.map((l) => [
        l.name,
        l.phone,
        l.email ?? "",
        l.source,
        l.utm?.source ?? "",
        l.utm?.medium ?? "",
        l.utm?.campaign ?? "",
        l.utm?.content ?? "",
        l.utm?.term ?? "",
        l.landingUrl ?? "",
        l.referrer ?? "",
        String(l.amount || 0),
        `${l.aiScore}%`,
        stages.find((s) => s.id === l.stageId)?.title ?? "—",
        new Date(l.lastActivityAt).toLocaleString("ru-RU"),
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((c) => {
            const s = String(c).replace(/"/g, '""');
            return /[";\n]/.test(s) ? `"${s}"` : s;
          })
          .join(";"),
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clients_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: имя, телефон, email, кампания..."
            className="pl-10"
          />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Источник" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все источники</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" />
          Экспорт CSV
        </Button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 text-left">Имя</th>
              <th className="px-4 py-3 text-left">Контакты</th>
              <th className="px-4 py-3 text-left">Источник</th>
              <th className="px-4 py-3 text-left">UTM</th>
              <th className="px-4 py-3 text-right">LTV</th>
              <th className="px-4 py-3 text-left">AI-рейтинг</th>
              <th className="px-4 py-3 text-left">Посл. активность</th>
              <th className="px-4 py-3 text-left">Сделки</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  Нет клиентов
                </td>
              </tr>
            ) : (
              filtered.map((l) => {
                const stage = stages.find((s) => s.id === l.stageId);
                return (
                  <tr
                    key={l.id}
                    onClick={() => onOpenLead(l)}
                    className="cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/40"
                  >
                    <td className="px-4 py-3 font-semibold">{l.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <div>{l.phone}</div>
                      {l.email && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {l.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-secondary/60 px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                        {l.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {l.utm?.source || l.utm?.campaign ? (
                        <div
                          className="flex max-w-[200px] flex-col gap-0.5"
                          title={[
                            l.utm?.source && `source: ${l.utm.source}`,
                            l.utm?.medium && `medium: ${l.utm.medium}`,
                            l.utm?.campaign && `campaign: ${l.utm.campaign}`,
                            l.utm?.content && `content: ${l.utm.content}`,
                            l.utm?.term && `term: ${l.utm.term}`,
                          ]
                            .filter(Boolean)
                            .join("\n")}
                        >
                          <span className="inline-flex items-center gap-1 truncate text-primary">
                            <Tag className="h-3 w-3 shrink-0" />
                            <span className="truncate font-semibold">
                              {l.utm?.campaign ?? l.utm?.source}
                            </span>
                          </span>
                          {l.utm?.medium && (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {l.utm.source ?? "—"} / {l.utm.medium}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {l.amount > 0 ? `${l.amount.toLocaleString("ru-RU")} $` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold",
                          l.aiScore >= 75
                            ? "bg-success/15 text-success"
                            : l.aiScore >= 50
                              ? "bg-warning/15 text-warning"
                              : "bg-secondary/60 text-muted-foreground",
                        )}
                      >
                        <Sparkles className="h-3 w-3" />
                        {l.aiScore}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {timeAgo(l.lastActivityAt)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-primary">
                        {stage?.title ?? "—"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}