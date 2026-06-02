import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import type { ReportPeriodRange } from "@/hooks/useReportData";

export interface IgMediaRow {
  mediaId: string;
  mediaType: string | null;
  mediaProductType: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string | null;
  likeCount: number;
  commentsCount: number;
  sharesCount: number;
  savedCount: number;
  reach: number;
  impressions: number;
  plays: number;
  totalInteractions: number;
}

export interface IgDailyRow {
  date: string;
  followers: number;
  reach: number;
  impressions: number;
  profileViews: number;
  websiteClicks: number;
}

export interface IgDemographic {
  dimension: string;
  key: string;
  value: number;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useInstagramAnalytics(range: ReportPeriodRange) {
  const { activeId: projectId } = useProjectsStore();
  const [media, setMedia] = useState<IgMediaRow[]>([]);
  const [daily, setDaily] = useState<IgDailyRow[]>([]);
  const [demographics, setDemographics] = useState<IgDemographic[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useRealtimeTable("instagram_media", () => setTick((n) => n + 1), !!projectId, 1200);
  useRealtimeTable("instagram_account_daily", () => setTick((n) => n + 1), !!projectId, 1200);

  useEffect(() => {
    if (!projectId) {
      setMedia([]); setDaily([]); setDemographics([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const fromIso = range.from.toISOString();
      const toIso = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).toISOString();
      const since = ymd(range.from);
      const until = ymd(range.to);

      const [mRes, dRes, demRes] = await Promise.all([
        supabase.from("instagram_media")
          .select("media_id, media_type, media_product_type, caption, permalink, thumbnail_url, timestamp, like_count, comments_count, shares_count, saved_count, reach, impressions, plays, total_interactions")
          .eq("project_id", projectId)
          .gte("timestamp", fromIso)
          .lt("timestamp", toIso)
          .order("timestamp", { ascending: false })
          .limit(500),
        supabase.from("instagram_account_daily")
          .select("date, followers, reach, impressions, profile_views, website_clicks")
          .eq("project_id", projectId)
          .gte("date", since)
          .lte("date", until)
          .order("date"),
        supabase.from("instagram_demographics")
          .select("dimension, key, value")
          .eq("project_id", projectId),
      ]);
      if (cancelled) return;
      setMedia((mRes.data ?? []).map((r: any) => ({
        mediaId: r.media_id,
        mediaType: r.media_type,
        mediaProductType: r.media_product_type ?? "FEED",
        caption: r.caption,
        permalink: r.permalink,
        thumbnailUrl: r.thumbnail_url,
        timestamp: r.timestamp,
        likeCount: r.like_count ?? 0,
        commentsCount: r.comments_count ?? 0,
        sharesCount: r.shares_count ?? 0,
        savedCount: r.saved_count ?? 0,
        reach: r.reach ?? 0,
        impressions: r.impressions ?? 0,
        plays: r.plays ?? 0,
        totalInteractions: r.total_interactions ?? 0,
      })));
      setDaily((dRes.data ?? []).map((r: any) => ({
        date: r.date,
        followers: r.followers ?? 0,
        reach: r.reach ?? 0,
        impressions: r.impressions ?? 0,
        profileViews: r.profile_views ?? 0,
        websiteClicks: r.website_clicks ?? 0,
      })));
      setDemographics((demRes.data ?? []) as IgDemographic[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, range.from, range.to, tick]);

  const totals = useMemo(() => {
    const t = { posts: media.length, reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0, saved: 0, plays: 0, websiteClicks: 0, profileViews: 0 };
    for (const m of media) {
      t.reach += m.reach;
      t.impressions += m.impressions;
      t.likes += m.likeCount;
      t.comments += m.commentsCount;
      t.shares += m.sharesCount;
      t.saved += m.savedCount;
      t.plays += m.plays;
    }
    for (const d of daily) {
      t.websiteClicks += d.websiteClicks;
      t.profileViews += d.profileViews;
    }
    return t;
  }, [media, daily]);

  const followersDelta = useMemo(() => {
    if (daily.length < 2) return 0;
    return daily[daily.length - 1].followers - daily[0].followers;
  }, [daily]);

  return { media, daily, demographics, totals, followersDelta, loading };
}
