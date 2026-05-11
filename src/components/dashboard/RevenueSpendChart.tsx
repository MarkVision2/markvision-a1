import { useState } from "react";
import {
  Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { cn } from "@/lib/utils";

type Mode = "money" | "leads" | "cpl";

interface Row {
  date: string;
  spend: number;
  revenue: number;
  leads: number;
  cpl: number;
}

interface Props {
  data: Row[];
}

const fmtShort = (d: string) => {
  const [, m, day] = d.split("-");
  return `${day}.${m}`;
};
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

export function RevenueSpendChart({ data }: Props) {
  const [mode, setMode] = useState<Mode>("money");
  const tabs: { id: Mode; label: string }[] = [
    { id: "money", label: "Расход и выручка" },
    { id: "leads", label: "Заявки" },
    { id: "cpl", label: "Стоимость заявки" },
  ];

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Динамика
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-card/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                mode === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtShort} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 12,
                fontSize: 12,
              }}
              labelFormatter={fmtShort}
              formatter={(value: number, name: string) => {
                if (name === "Заявки") return [Math.round(value), name];
                if (name === "Стоимость заявки") return [fmtTenge(value), name];
                return [fmtTenge(value), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {mode === "money" && (
              <>
                <Bar dataKey="spend" name="Расход" fill="hsl(var(--destructive) / 0.6)" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="revenue" name="Выручка" stroke="hsl(var(--success))" strokeWidth={2.5} dot={false} />
              </>
            )}
            {mode === "leads" && (
              <Bar dataKey="leads" name="Заявки" fill="hsl(var(--primary) / 0.7)" radius={[4, 4, 0, 0]} />
            )}
            {mode === "cpl" && (
              <Line type="monotone" dataKey="cpl" name="Стоимость заявки" stroke="hsl(var(--warning))" strokeWidth={2.5} dot={{ r: 3 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
