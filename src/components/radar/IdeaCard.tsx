/**
 * Радар идей: карточка идеи из банка — оценка, название, хук, угол, ниша,
 * исходный пост (превью + X-фактор), сценарий по клику, действия
 * «В контент-план» (с выбором группы), «Одобрить», «Отклонить».
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IDEA_STATUS_META, type Idea, type IdeaStatus, type RadarGroup, type RadarPost } from "@/lib/radarClient";
import { cn } from "@/lib/utils";
import { Chip, PlatformChip, ScoreBadge, XBadge } from "./RadarBits";

const NO_GROUP = "__none__";

interface IdeaCardProps {
  idea: Idea;
  groups: RadarGroup[];
  /** Пост, из которого родилась идея (если он в ленте). */
  sourcePost: RadarPost | null;
  busy: boolean;
  onPromote: (groupId: string | null) => Promise<void>;
  onStatus: (status: Exclude<IdeaStatus, "used">) => Promise<void>;
  onOpenPost: (post: RadarPost) => void;
}

export function IdeaCard({ idea, groups, sourcePost, busy, onPromote, onStatus, onOpenPost }: IdeaCardProps) {
  const [picking, setPicking] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [groupId, setGroupId] = useState<string>(idea.target_group_id ?? groups[0]?.id ?? NO_GROUP);
  const status = IDEA_STATUS_META[idea.status];
  const muted = idea.status === "rejected";

  return (
    <article className={cn("flex flex-col rounded-2xl border bg-card p-4", muted ? "border-border/40 opacity-70" : "border-border/60")} data-testid="idea-card">
      <div className="flex items-start gap-3">
        <ScoreBadge score={idea.score} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug">{idea.title}</h3>
          {idea.hook && (
            <blockquote className="mt-2 rounded-lg border-l-4 border-success/70 bg-success/5 px-3 py-1.5 text-sm italic">«{idea.hook}»</blockquote>
          )}
          {idea.angle && <p className="mt-2 text-sm text-muted-foreground">{idea.angle}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {idea.niche && <Chip label={idea.niche} cls="bg-muted text-muted-foreground" />}
            {idea.outcome_score != null && <Chip label={`результат ${Math.round(idea.outcome_score)}`} cls="bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30" />}
            <Chip label={status.label} cls={status.cls} />
          </div>
        </div>
        {sourcePost && (
          <button
            type="button"
            onClick={() => onOpenPost(sourcePost)}
            className="group relative hidden w-[72px] shrink-0 overflow-hidden rounded-lg bg-muted sm:block"
            title={`Исходный пост @${sourcePost.author_handle ?? ""}`}
            aria-label="Открыть исходный пост"
          >
            {sourcePost.thumbnail_url ? (
              <img src={sourcePost.thumbnail_url} alt="" className="aspect-[4/5] w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
            ) : (
              <div className="aspect-[4/5]" />
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/70 px-1 py-0.5">
              <PlatformChip platform={sourcePost.platform} short className="h-4 px-1 text-[10px]" />
              <XBadge x={sourcePost.x_factor} className="h-4 px-1 text-[10px]" />
            </div>
          </button>
        )}
      </div>

      {idea.script_draft && (
        <div className="mt-3">
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowScript((v) => !v)}>
            {showScript ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showScript ? "Скрыть план ролика" : "План ролика"}
          </button>
          {showScript && <p className="mt-2 whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">{idea.script_draft}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {idea.status === "used" && idea.content_item_id ? (
          <Button asChild size="sm" variant="outline" className="gap-1">
            <Link to={`/marketing/content-plan/${idea.content_item_id}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть тему в плане
            </Link>
          </Button>
        ) : picking ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="h-8 w-[220px]" aria-label="Группа аккаунтов"><SelectValue placeholder="Группа аккаунтов" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>Без группы</SelectItem>
                {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={busy} className="gap-1" onClick={() => void onPromote(groupId === NO_GROUP ? null : groupId).then(() => setPicking(false))}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Подтвердить
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicking(false)}>Отмена</Button>
          </div>
        ) : (
          <>
            <Button size="sm" disabled={busy || idea.status === "rejected"} onClick={() => setPicking(true)}>В контент-план</Button>
            {idea.status !== "approved" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void onStatus("approved")}>Одобрить</Button>
            )}
            {idea.status !== "rejected" ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onStatus("rejected")}>Отклонить</Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onStatus("new")}>Вернуть</Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}
