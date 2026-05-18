import { MonthSwitcher, monthRange, normalizeMonth } from "@/components/ui/month-switcher";
import type { PeriodPreset } from "@/hooks/useDashboardData";
import type { ReportPeriodRange } from "@/hooks/useReportData";

interface Props {
  preset?: PeriodPreset;
  range: ReportPeriodRange;
  onChange: (preset: PeriodPreset, range: ReportPeriodRange) => void;
}

export function PeriodPicker({ range, onChange }: Props) {
  const month = normalizeMonth(range.from);

  return (
    <MonthSwitcher
      value={month}
      onChange={(nextMonth) => onChange("month", monthRange(nextMonth))}
      size="lg"
    />
  );
}
