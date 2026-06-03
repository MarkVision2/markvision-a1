import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

function normalizeActId(id: string): string {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

export function useMetaAdAccounts() {
  const [listing, setListing] = useState(false);

  const listAvailable = useCallback(
    async (
      excludeActIds: string[] = [],
      accessToken?: string,
    ): Promise<{ accounts: AvailableMetaAdAccount[]; error?: string }> => {
      setListing(true);
      try {
        const { data, error } = await supabase.functions.invoke(
          "meta-list-ad-accounts",
          {
            body: {
              exclude_act_ids: excludeActIds.map(normalizeActId),
              access_token: accessToken?.trim() || undefined,
            },
          },
        );
        if (error) {
          return { accounts: [], error: error.message };
        }
        return {
          accounts: (data?.accounts ?? []) as AvailableMetaAdAccount[],
          error: data?.error,
        };
      } finally {
        setListing(false);
      }
    },
    [],
  );

  return { listAvailable, listing };
}
