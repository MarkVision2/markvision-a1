const META_API_VERSION = "v21.0";

export const AD_ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: "active",
  2: "disabled",
  3: "unsettled",
  7: "pending_risk_review",
  8: "pending_settlement",
  9: "in_grace_period",
  100: "pending_closure",
  101: "closed",
};

export function normalizeActId(id: string): string {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

type AdAccountRow = {
  id: string;
  account_id?: string;
  name?: string;
  currency?: string;
  account_status?: number;
  timezone_name?: string;
  business?: { name?: string };
};

export type ListedAdAccount = {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  account_status: number;
  status_label: string;
  timezone_name: string | null;
  business_name: string | null;
};

export async function fetchAllMetaAdAccounts(token: string): Promise<AdAccountRow[]> {
  const out: AdAccountRow[] = [];
  let url =
    `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts` +
    `?fields=id,account_id,name,currency,account_status,timezone_name,business{name}` +
    `&limit=100&access_token=${encodeURIComponent(token)}`;

  for (let guard = 0; guard < 20 && url; guard++) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.error) {
      throw new Error(j?.error?.message ?? `Meta API ${r.status}`);
    }
    if (Array.isArray(j.data)) out.push(...j.data);
    url = j.paging?.next ?? null;
  }
  return out;
}

export function mapAdAccounts(
  rows: AdAccountRow[],
  excludeActIds: string[] = [],
): ListedAdAccount[] {
  const exclude = new Set(excludeActIds.map((x) => normalizeActId(String(x))));
  return rows
    .map((a) => {
      const id = normalizeActId(String(a.id ?? a.account_id ?? ""));
      return {
        id,
        account_id: a.account_id ?? id.replace(/^act_/, ""),
        name: a.name ?? id,
        currency: a.currency ?? "KZT",
        account_status: a.account_status ?? 0,
        status_label: AD_ACCOUNT_STATUS_LABEL[a.account_status ?? 0] ?? "unknown",
        timezone_name: a.timezone_name ?? null,
        business_name: a.business?.name ?? null,
      };
    })
    .filter((a) => a.id && !exclude.has(a.id))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
