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

export type MetaAdAccountsFetchResult = {
  rows: AdAccountRow[];
  sources: string[];
  token_identity?: { id: string; name: string };
  meta_hint?: string;
};

const ACCOUNT_FIELDS =
  "id,account_id,name,currency,account_status,timezone_name,business{name}";

async function graphGet(token: string, path: string): Promise<Record<string, unknown>> {
  const sep = path.includes("?") ? "&" : "?";
  const url =
    `https://graph.facebook.com/${META_API_VERSION}${path}` +
    `${sep}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j as { error?: { message?: string } })?.error) {
    const msg = (j as { error?: { message?: string } })?.error?.message ?? `Meta API ${r.status}`;
    throw new Error(msg);
  }
  return j as Record<string, unknown>;
}

async function paginateAccountList(token: string, firstPath: string): Promise<AdAccountRow[]> {
  const out: AdAccountRow[] = [];
  let url: string | null =
    `https://graph.facebook.com/${META_API_VERSION}${firstPath}` +
    (firstPath.includes("?") ? "&" : "?") +
    `access_token=${encodeURIComponent(token)}`;

  for (let guard = 0; guard < 20 && url; guard++) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j as { error?: { message?: string } })?.error) {
      const msg = (j as { error?: { message?: string } })?.error?.message ?? `Meta API ${r.status}`;
      throw new Error(msg);
    }
    if (Array.isArray((j as { data?: unknown }).data)) {
      out.push(...((j as { data: AdAccountRow[] }).data));
    }
    url = (j as { paging?: { next?: string } }).paging?.next ?? null;
  }
  return out;
}

function dedupeRows(rows: AdAccountRow[]): AdAccountRow[] {
  const seen = new Set<string>();
  const out: AdAccountRow[] = [];
  for (const a of rows) {
    const id = normalizeActId(String(a.id ?? a.account_id ?? ""));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(a);
  }
  return out;
}

/** Загружает ad accounts: /me/adaccounts, затем Business Manager (owned + client). */
export async function fetchAllMetaAdAccounts(
  token: string,
): Promise<MetaAdAccountsFetchResult> {
  const sources: string[] = [];
  let rows: AdAccountRow[] = [];
  let token_identity: { id: string; name: string } | undefined;

  try {
    const me = await graphGet(token, "/me?fields=id,name");
    if (me.id) {
      token_identity = {
        id: String(me.id),
        name: String(me.name ?? me.id),
      };
    }
  } catch {
    /* me недоступен — токен может быть особого типа */
  }

  try {
    const meAccounts = await paginateAccountList(
      token,
      `/me/adaccounts?fields=${ACCOUNT_FIELDS}&limit=100`,
    );
    sources.push("me/adaccounts");
    rows = dedupeRows([...rows, ...meAccounts]);
  } catch (e) {
    sources.push(`me/adaccounts:error:${(e as Error).message}`);
  }

  if (rows.length === 0) {
    try {
      const bizRes = await graphGet(token, "/me/businesses?fields=id,name&limit=50");
      const businesses = (bizRes.data ?? []) as Array<{ id: string; name?: string }>;
      sources.push(`businesses:${businesses.length}`);
      for (const b of businesses) {
        if (!b?.id) continue;
        for (const edge of ["owned_ad_accounts", "client_ad_accounts"] as const) {
          try {
            const list = await paginateAccountList(
              token,
              `/${b.id}/${edge}?fields=${ACCOUNT_FIELDS}&limit=100`,
            );
            if (list.length > 0) {
              sources.push(`${b.id}/${edge}:${list.length}`);
              rows = dedupeRows([...rows, ...list]);
            }
          } catch (e) {
            sources.push(`${b.id}/${edge}:error`);
          }
        }
      }
    } catch (e) {
      sources.push(`businesses:error:${(e as Error).message}`);
    }
  }

  let meta_hint: string | undefined;
  if (rows.length === 0) {
    const who = token_identity
      ? `Токен привязан к: ${token_identity.name} (${token_identity.id}). `
      : "";
    meta_hint =
      who +
      "Meta не вернула кабинеты ни через /me/adaccounts, ни через Business Manager. " +
      "Проверьте: (1) токен User или System User с правами ads_read и business_management; " +
      "(2) в Business Manager → Настройки → пользователи/кабинеты — доступ к рекламным аккаунтам; " +
      "(3) срок действия токена. Либо введите act_… вручную.";
  }

  return { rows, sources, token_identity, meta_hint };
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
