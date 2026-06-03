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

type ListBody = {
  exclude_act_ids: string[];
  access_token?: string;
};

function shouldFallbackToValidateCabinet(err?: string | null): boolean {
  if (!err) return false;
  const msg = err.toLowerCase();
  return (
    msg.includes("failed to send a request to the edge function")
    || msg.includes("failed to fetch")
    || msg.includes("functionsfetcherror")
    || msg.includes("404")
    || msg.includes("not found")
    || msg.includes("function not found")
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
  functionName: "meta-daily-sync" | "meta-validate-cabinet" | "meta-list-ad-accounts",
  body: ListBody,
): Promise<{ accounts: AvailableMetaAdAccount[]; error?: string }> {
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

  return {
    accounts: (data?.accounts ?? []) as AvailableMetaAdAccount[],
    error: data?.error ? String(data.error) : undefined,
  };
}

export function useMetaAdAccounts() {
  const [listing, setListing] = useState(false);

  const listAvailable = useCallback(
    async (
      accessToken?: string,
    ): Promise<{ accounts: AvailableMetaAdAccount[]; error?: string }> => {
      setListing(true);
      try {
        const body: ListBody = {
          exclude_act_ids: [],
          access_token: accessToken?.trim() || undefined,
        };

        const fns = [
          "meta-daily-sync",
          "meta-validate-cabinet",
          "meta-list-ad-accounts",
        ] as const;

        let result: { accounts: AvailableMetaAdAccount[]; error?: string } = {
          accounts: [],
          error: "Не удалось вызвать Edge Function",
        };

        for (const fn of fns) {
          result = await invokeListAdAccounts(fn, body);
          if (!shouldFallbackToValidateCabinet(result.error)) break;
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
