import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendPoint {
  week: string;
  posts: number;
  reach: number;
  views: number;
  engagement: number;
  er: number;
}

const fmtWeek = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}.${m[2]}` : d;
};

export function ContentPerformanceChart({ data }: { data: TrendPoint[] }) {
  if (!data.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Нет постов за выбранный период</p>;
  }
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={fmtWeek}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="l"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={44}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="r"
            orientation="right"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={40}
            unit="%"
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={fmtWeek}
            formatter={(v: number, name: string) => [name === "ER" ? `${v}%` : v.toLocaleString("ru-RU"), name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            yAxisId="l"
            type="monotone"
            dataKey="reach"
            name="Охват"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary) / 0.15)"
            strokeWidth={2}
          />
          <Area
            yAxisId="l"
            type="monotone"
            dataKey="views"
            name="Просмотры"
            stroke="#8b5cf6"
            fill="#8b5cf620"
            strokeWidth={2}
          />
          <Line
            yAxisId="r"
            type="monotone"
            dataKey="er"
            name="ER"
            stroke="#22c55e"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
