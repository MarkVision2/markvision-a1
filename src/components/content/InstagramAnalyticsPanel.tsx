import { useMemo, useState } from "react";
import {
  Instagram, Eye, Heart, MessageCircle, Share2, Bookmark, Play, Users, MousePointerClick, Loader2, ExternalLink,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid,
} from "recharts";
import { useInstagramAnalytics } from "@/hooks/useInstagramAnalytics";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useCodewordStats } from "@/hooks/useInstagramOrganic";
import { InstagramAccountConnect } from "@/components/settings/InstagramAccountConnect";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;

const KpiCard = ({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: string }) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
      <Icon className={cn("h-4 w-4", accent ?? "text-muted-foreground")} />
      {label}
    </div>
    <div className="text-2xl font-bold tabular-nums">{value}</div>
  </div>
);

const TYPE_LABEL: Record<string, string> = { FEED: "Пост", REELS: "Reel", STORY: "Stories", AD: "Реклама" };
const TYPE_COLOR: Record<string, string> = {
  FEED: "bg-blue-500/15 text-blue-500",
  REELS: "bg-pink-500/15 text-pink-500",
  STORY: "bg-purple-500/15 text-purple-500",
  AD: "bg-orange-500/15 text-orange-500",
};

interface Props {
  range: ReportPeriodRange;
}

export function InstagramAnalyticsPanel({ range }: Props) {
  const { account, sync } = useInstagramAccount();
  const { totals, media, daily, demographics, followersDelta, loading } = useInstagramAnalytics(range);
  const { stats: codewordStats } = useCodewordStats();
  const [filter, setFilter] = useState<"ALL" | "FEED" | "REELS" | "STORY">("ALL");

  const filteredMedia = useMemo(() => {
    if (filter === "ALL") return media;
    return media.filter((m) => m.mediaProductType === filter);
  }, [media, filter]);

  const codewordTotals = useMemo(() => {
    return codewordStats.reduce(
      (acc, s) => ({
        codewords: acc.codewords + (s.codewordDms > 0 ? 1 : 0),
        dms: acc.dms + s.codewordDms,
        clicks: acc.clicks + s.linkClicks,
        leads: acc.leads + s.leads,
        sales: acc.sales + s.sales,
        revenue: acc.revenue + s.revenue,
      }),
      { codewords: 0, dms: 0, clicks: 0, leads: 0, sales: 0, revenue: 0 },
    );
  }, [codewordStats]);

  if (!account) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-pink-500/30 bg-pink-500/5 px-4 py-3 text-sm text-muted-foreground">
          Подключите Instagram Business через ваш Meta-токен (отдельный пароль не нужен). После синхронизации здесь появятся охват, лайки, Reels и демография.
        </div>
        <InstagramAccountConnect />
      </div>
    );
  }

  const cityData = demographics
    .filter((d) => d.dimension === "city")
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const ageGenderData = demographics
    .filter((d) => d.dimension === "age_gender")
    .reduce((acc, d) => {
      const [gender, age] = d.key.split(".");
      const existing = acc.find((x) => x.age === age);
      if (existing) {
        if (gender === "M") existing.male += d.value;
        else if (gender === "F") existing.female += d.value;
      } else {
        acc.push({ age, male: gender === "M" ? d.value : 0, female: gender === "F" ? d.value : 0 });
      }
      return acc;
    }, [] as Array<{ age: string; male: number; female: number }>)
    .sort((a, b) => a.age.localeCompare(b.age));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
        {account.profilePictureUrl ? (
          <img src={account.profilePictureUrl} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-pink-500/40" />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-full bg-pink-500/15">
            <Instagram className="h-6 w-6 text-pink-500" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">@{account.username ?? account.name ?? "instagram"}</div>
          <div className="text-xs text-muted-foreground">
            {fmtNum(account.followersCount)} подписчиков
            {account.lastSyncAt && (
              <> · синхр. {new Date(account.lastSyncAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void sync()}
          className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold hover:bg-secondary/60"
        >
          Обновить
        </button>
      </div>
      {account.lastError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {account.lastError} — переподключите аккаунт в настройках.
        </div>
      )}

      {loading && media.length === 0 ? (
        <div className="flex items-center justify-center py-16 rounded-2xl border border-border/60 bg-card/40">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard icon={Instagram} label="Публикаций" value={fmtNum(totals.posts)} accent="text-pink-500" />
        <KpiCard icon={Eye} label="Охват" value={fmtNum(totals.reach)} />
        <KpiCard icon={Eye} label="Показы" value={fmtNum(totals.impressions)} accent="text-purple-500" />
        <KpiCard icon={Heart} label="Лайки" value={fmtNum(totals.likes)} accent="text-rose-500" />
        <KpiCard icon={MessageCircle} label="Комментарии" value={fmtNum(totals.comments)} />
        <KpiCard icon={Share2} label="Репосты" value={fmtNum(totals.shares)} accent="text-blue-500" />
        <KpiCard icon={Bookmark} label="Сохранения" value={fmtNum(totals.saved)} accent="text-amber-500" />
        <KpiCard icon={Play} label="Просмотры Reels" value={fmtNum(totals.plays)} accent="text-pink-500" />
        <KpiCard
          icon={Users}
          label="Подписчики (Δ)"
          value={`${followersDelta >= 0 ? "+" : ""}${fmtNum(followersDelta)}`}
          accent={followersDelta >= 0 ? "text-success" : "text-destructive"}
        />
        <KpiCard icon={MousePointerClick} label="Клики на сайт" value={fmtNum(totals.websiteClicks)} accent="text-emerald-500" />
      </div>

      {/* CRM linkage */}
      <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-pink-500/5 to-purple-500/5 p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider mb-3 text-pink-500">
          Связка с CRM (код-слова → продажи)
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <div className="text-[11px] text-muted-foreground">Код-слов сработало</div>
            <div className="text-xl font-bold tabular-nums">{fmtNum(codewordTotals.codewords)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">DM получено</div>
            <div className="text-xl font-bold tabular-nums">{fmtNum(codewordTotals.dms)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Переходов на сайт</div>
            <div className="text-xl font-bold tabular-nums">{fmtNum(codewordTotals.clicks)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Лидов</div>
            <div className="text-xl font-bold tabular-nums">{fmtNum(codewordTotals.leads)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Продаж</div>
            <div className="text-xl font-bold tabular-nums">{fmtNum(codewordTotals.sales)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Выручка</div>
            <div className="text-xl font-bold tabular-nums text-success">{fmtTenge(codewordTotals.revenue)}</div>
          </div>
        </div>
      </div>

      {/* Daily chart */}
      {daily.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider mb-4">Охват и показы по дням</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="igReach" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ec4899" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="igImpr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Area type="monotone" dataKey="reach" stroke="#ec4899" fill="url(#igReach)" name="Охват" />
              <Area type="monotone" dataKey="impressions" stroke="#a855f7" fill="url(#igImpr)" name="Показы" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top content table */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-xs font-bold uppercase tracking-wider">Топ контента</h3>
          <div className="flex items-center gap-1 rounded-xl bg-secondary p-1">
            {(["ALL", "FEED", "REELS", "STORY"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-lg transition",
                  filter === t ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "ALL" ? "Все" : TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        {filteredMedia.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">Нет данных за период</div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-xs text-muted-foreground">
                  <th className="px-5 py-2 text-left font-medium">Контент</th>
                  <th className="px-3 py-2 text-left font-medium">Тип</th>
                  <th className="px-3 py-2 text-right font-medium">Охват</th>
                  <th className="px-3 py-2 text-right font-medium hidden md:table-cell">Показы</th>
                  <th className="px-3 py-2 text-right font-medium">Лайки</th>
                  <th className="px-3 py-2 text-right font-medium hidden md:table-cell">Комм.</th>
                  <th className="px-3 py-2 text-right font-medium hidden lg:table-cell">Реп.</th>
                  <th className="px-3 py-2 text-right font-medium hidden lg:table-cell">Сохр.</th>
                  <th className="px-3 py-2 text-right font-medium hidden md:table-cell">ER%</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filteredMedia.slice(0, 50).map((m) => {
                  const er = m.reach > 0 ? ((m.likeCount + m.commentsCount + m.sharesCount + m.savedCount) / m.reach) * 100 : 0;
                  return (
                    <tr key={m.mediaId} className="border-b border-border/30 hover:bg-secondary/30">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 max-w-xs">
                          {m.thumbnailUrl ? (
                            <img src={m.thumbnailUrl} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0" />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-secondary grid place-items-center shrink-0">
                              <Instagram className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">
                              {m.timestamp ? new Date(m.timestamp).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : ""}
                            </div>
                            <div className="text-xs truncate">{m.caption?.slice(0, 50) ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={cn("inline-block px-2 py-0.5 rounded text-[10px] font-semibold", TYPE_COLOR[m.mediaProductType] ?? "bg-secondary")}>
                          {TYPE_LABEL[m.mediaProductType] ?? m.mediaProductType}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold">{fmtNum(m.reach)}</td>
                      <td className="px-3 py-3 text-right tabular-nums hidden md:table-cell">{fmtNum(m.impressions)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtNum(m.likeCount)}</td>
                      <td className="px-3 py-3 text-right tabular-nums hidden md:table-cell">{fmtNum(m.commentsCount)}</td>
                      <td className="px-3 py-3 text-right tabular-nums hidden lg:table-cell">{fmtNum(m.sharesCount)}</td>
                      <td className="px-3 py-3 text-right tabular-nums hidden lg:table-cell">{fmtNum(m.savedCount)}</td>
                      <td className="px-3 py-3 text-right tabular-nums hidden md:table-cell">
                        <span className={cn(er >= 5 ? "text-success font-semibold" : "")}>{er.toFixed(1)}%</span>
                      </td>
                      <td className="px-5 py-3">
                        {m.permalink && (
                          <a href={m.permalink} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Demographics */}
      {(cityData.length > 0 || ageGenderData.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {cityData.length > 0 && (
            <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider mb-4">Топ городов аудитории</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={cityData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis dataKey="key" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={120} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="value" fill="#ec4899" radius={[0, 6, 6, 0]} name="Подписчики" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {ageGenderData.length > 0 && (
            <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider mb-4">Возраст и пол аудитории</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={ageGenderData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="age" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="male" fill="#3b82f6" name="Мужчины" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="female" fill="#ec4899" name="Женщины" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}
