import { MonthSwitcher, monthRange, normalizeMonth } from "@/components/ui/month-switcher";

interface Props {
  range: { from: Date; to: Date };
  onChange: (r: { from: Date; to: Date }) => void;
}

export function DateRangeButton({ range, onChange }: Props) {
  return (
    <MonthSwitcher
      value={normalizeMonth(range.from)}
      onChange={(month) => onChange(monthRange(month))}
      size="lg"
    />
  );
}
