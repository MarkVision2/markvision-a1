import type { ReportData } from "@/hooks/useReportData";
import { ReportPageWrapper } from "./ReportPageWrapper";
import { SectionTitle } from "./SectionTitle";
import { ReportCreativesList } from "./ReportCreativesList";
import { ReportChannelsList } from "./ReportChannelsList";

interface Props {
  data: ReportData;
  rangeLabel: string;
}

export function CreativesPage({ data, rangeLabel }: Props) {
  return (
    <ReportPageWrapper
      title="Креативы и каналы"
      rangeLabel={rangeLabel}
      pageNumber={2}
      pageTotal={3}
      rightLabel="Страница 2 · Эффективность"
    >
      <SectionTitle>Топ креативов по выручке CRM</SectionTitle>
      <ReportCreativesList creatives={data.creatives} />

      <div className="mt-8">
        <SectionTitle>Каналы трафика</SectionTitle>
        <ReportChannelsList channels={data.channels} />
      </div>
    </ReportPageWrapper>
  );
}

export { reportFmt } from "./reportFormat";
