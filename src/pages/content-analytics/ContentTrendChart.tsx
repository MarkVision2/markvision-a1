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

export interface ContentTrendPoint {
  date: string;
  dms: number;
  clicks: number;
  leads: number;
}

const fmtDate = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${Number(m[3])}.${m[2]}` : d;
};

const ContentTrendChart = ({ data }: { data: ContentTrendPoint[] }) => (
  <div className="h-[260px] w-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="grDms" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grClicks" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grOrgLeads" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
          labelFormatter={(l) => `Дата: ${fmtDate(String(l))}`}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
        <Area type="monotone" dataKey="dms" name="DM в директ" stroke="hsl(var(--primary))" fill="url(#grDms)" strokeWidth={2} />
        <Area type="monotone" dataKey="clicks" name="Клики" stroke="hsl(var(--warning))" fill="url(#grClicks)" strokeWidth={2} />
        <Area type="monotone" dataKey="leads" name="Лиды" stroke="hsl(var(--success))" fill="url(#grOrgLeads)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

export default ContentTrendChart;
