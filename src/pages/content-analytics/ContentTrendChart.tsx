import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { InstagramOrganicEvent } from "@/hooks/useInstagramOrganic";

interface Props {
  events: InstagramOrganicEvent[];
}

const fmtDate = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${Number(m[3])}.${m[2]}` : d;
};

export function ContentTrendChart({ events }: Props) {
  const data = useMemo(() => {
    const byDate = new Map<string, { dms: number; clicks: number; leads: number }>();
    for (const e of events) {
      const cur = byDate.get(e.date) ?? { dms: 0, clicks: 0, leads: 0 };
      if (e.eventType === "codeword_dm") cur.dms += 1;
      if (e.eventType === "link_click") cur.clicks += 1;
      if (e.eventType === "lead") cur.leads += 1;
      byDate.set(e.date, cur);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));
  }, [events]);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Нет событий за выбранный период</p>
    );
  }

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={fmtDate}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="dms"
            name="DM"
            stroke="#ec4899"
            fill="#ec489933"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="clicks"
            name="Клики"
            stroke="#f59e0b"
            fill="#f59e0b33"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="leads"
            name="Заявки"
            stroke="#22c55e"
            fill="#22c55e33"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
