import type { Lead } from "@/types/crm";

/** Format an amount in KZT for templates. */
function fmtAmount(n?: number) {
  if (!n || n <= 0) return "";
  return new Intl.NumberFormat("ru-RU").format(n) + " $";
}

function fmtDate(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Replace {name}, {service}, {price}, {date}, {city} tokens in a template using lead data. */
export function applyTemplateVars(template: string, lead: Lead): string {
  const firstName = lead.name?.split(" ")[0] ?? "";
  const map: Record<string, string> = {
    name: firstName,
    fullname: lead.name ?? "",
    service: lead.service ?? "услуга",
    price: fmtAmount(lead.amount),
    date: fmtDate(lead.nextVisitAt),
    city: lead.city ?? "",
    phone: lead.phone ?? "",
  };
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = map[key.toLowerCase()];
    return v && v.length > 0 ? v : `{${key}}`;
  });
}