export function factValue(crm: unknown, manual: unknown): number {
  const crmValue = Number(crm) || 0;
  const manualValue = Number(manual) || 0;
  return manualValue > 0 ? manualValue : crmValue;
}
