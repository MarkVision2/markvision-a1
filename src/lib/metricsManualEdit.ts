import type { AdCabinet } from "@/types/ads";

export type MetricsEditScope =
  | { kind: "cabinet"; cabinet: AdCabinet }
  | { kind: "project" };

/** Куда сохранять ручной факт: кабинет CDI или проектный rnp_daily. */
export function resolveMetricsEditScope(
  cabinetId: string,
  cabinets: AdCabinet[],
): MetricsEditScope | null {
  if (cabinetId !== "all") {
    const cab = cabinets.find((c) => c.id === cabinetId);
    return cab?.externalId ? { kind: "cabinet", cabinet: cab } : null;
  }
  const withExt = cabinets.filter((c) => Boolean(c.externalId));
  if (withExt.length === 1) return { kind: "cabinet", cabinet: withExt[0] };
  if (withExt.length > 1) return { kind: "project" };
  return { kind: "project" };
}

export function metricsEditHint(scope: MetricsEditScope | null, cabinetsCount: number): string {
  if (!scope) return "Подключи рекламный кабинет с Ad Account ID, чтобы вносить факты.";
  if (scope.kind === "cabinet") {
    return `Ручной ввод → кабинет «${scope.cabinet.name}». Пустое поле + «Сбросить» = снова авто из Meta/CRM.`;
  }
  return cabinetsCount > 1
    ? "Несколько кабинетов: правки сохраняются на уровне проекта (перезаписывают сумму за день)."
    : "Ручной ввод на уровне проекта. Пустое поле + «Сбросить» = снова авто из Meta/CRM.";
}
