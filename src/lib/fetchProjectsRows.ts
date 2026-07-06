import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  isMissingCreativeUsernameColumn,
  PROJECTS_BASE_COLUMNS,
  PROJECTS_LIST_COLUMNS,
} from "@/lib/projectColumns";

export type ProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  initials: string;
  is_primary: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  creative_username?: string | null;
  intake_token?: string | null;
};


export async function fetchProjectsRows(): Promise<{
  rows: ProjectRow[];
  creativeUsernameAvailable: boolean;
  error: PostgrestError | null;
}> {
  const full = await supabase.from("projects").select(PROJECTS_LIST_COLUMNS).order("created_at");
  if (!full.error) {
    return {
      rows: (full.data ?? []) as ProjectRow[],
      creativeUsernameAvailable: true,
      error: null,
    };
  }

  if (isMissingCreativeUsernameColumn(full.error.message ?? "")) {
    const base = await supabase.from("projects").select(PROJECTS_BASE_COLUMNS).order("created_at");
    if (base.error) {
      return { rows: [], creativeUsernameAvailable: false, error: base.error };
    }
    return {
      rows: ((base.data ?? []) as ProjectRow[]).map((r) => ({ ...r, creative_username: null })),
      creativeUsernameAvailable: false,
      error: null,
    };
  }

  return { rows: [], creativeUsernameAvailable: false, error: full.error };
}
