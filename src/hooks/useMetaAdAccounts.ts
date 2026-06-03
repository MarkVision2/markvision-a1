import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

export interface AvailableMetaAdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  account_status: number;
  status_label: string;
  timezone_name: string | null;
  business_name: string | null;
}

export type MetaListDiagnostics = {
  meta_hint?: string;
  token_identity?: { id: string; name: string };
  sources?: string[];
  raw_count?: number;
  used_function?: string;
};

type ListBody = {
  exclude_act_ids: string[];
  access_token?: string;
};

function shouldFallbackToNextFunction(err?: string | null): boolean {
  if (!err) return false;
  const msg = err.toLowerCase();
  return (
    msg.includes("failed to send a request to the edge function")
    || msg.includes("failed to fetch")
    || msg.includes("functionsfetcherror")
    || msg.includes("404")
    || msg.includes("not found")
    || msg.includes("function not found")
    || msg.includes("forbidden")
    || msg.includes("unauthorized")
  );
}

async function parseFunctionError(error: FunctionsHttpError): Promise<string> {
  try {
    const ctx = error.context as Response | undefined;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body && typeof body === "object" && "error" in body) {
        return String((body as { error: unknown }).error);
      }
    }
  } catch {
    /* ignore */
  }
  return error.message;
}

async function invokeListAdAccounts(
  functionName: "meta-daily-sync" | "meta-list-ad-accounts",
  body: ListBody,
): Promise<{
  accounts: AvailableMetaAdAccount[];
  error?: string;
  diagnostics?: MetaListDiagnostics;
}> {
  const payload =
    functionName === "meta-list-ad-accounts"
      ? body
      : { list_ad_accounts: true, ...body };

  const { data, error } = await supabase.functions.invoke(functionName, { body: payload });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      return { accounts: [], error: await parseFunctionError(error) };
    }
    if (error instanceof FunctionsRelayError) {
      return { accounts: [], error: error.message };
    }
    return { accounts: [], error: error.message };
  }

  const diagnostics: MetaListDiagnostics = {
    meta_hint: data?.meta_hint ? String(data.meta_hint) : undefined,
    token_identity: data?.token_identity as MetaListDiagnostics["token_identity"],
    sources: Array.isArray(data?.sources) ? (data.sources as string[]) : undefined,
    raw_count: typeof data?.raw_count === "number" ? data.raw_count : undefined,
    used_function: functionName,
  };

  return {
    accounts: (data?.accounts ?? []) as AvailableMetaAdAccount[],
    error: data?.error ? String(data.error) : undefined,
    diagnostics,
  };
}

export function useMetaAdAccounts() {
  const [listing, setListing] = useState(false);

  const listAvailable = useCallback(
    async (
      accessToken?: string,
    ): Promise<{
      accounts: AvailableMetaAdAccount[];
      error?: string;
      diagnostics?: MetaListDiagnostics;
    }> => {
      setListing(true);
      try {
        const body: ListBody = {
          exclude_act_ids: [],
          access_token: accessToken?.trim() || undefined,
        };

        const fns = [
          "meta-list-ad-accounts",
          "meta-daily-sync",
        ] as const;

        let result: {
          accounts: AvailableMetaAdAccount[];
          error?: string;
          diagnostics?: MetaListDiagnostics;
        } = {
          accounts: [],
          error: "Не удалось вызвать Edge Function",
        };

        for (const fn of fns) {
          result = await invokeListAdAccounts(fn, body);
          if (!shouldFallbackToNextFunction(result.error)) break;
        }

        return result;
      } finally {
        setListing(false);
      }
    },
    [],
  );

  return { listAvailable, listing };
}
