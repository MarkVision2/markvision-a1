import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!URL || !KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[clientConfig] VITE_CLIENT_SUPABASE_URL / VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY не заданы — запись в client_configs будет пропущена.',
  );
}

export const clientConfigSupabase: SupabaseClient | null =
  URL && KEY
    ? createClient(URL, KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export interface PendingAdvance {
  id: string;
  phone: string | null;
  fb_ad_account_id: string | null;
  auto_advance_stage: string | null;
  auto_advance_at: string | null;
}

/** Лиды, для которых WA-анализ просит автоматически передвинуть этап в CRM. */
export async function fetchPendingAdvances(): Promise<PendingAdvance[]> {
  if (!clientConfigSupabase) return [];
  const { data, error } = await clientConfigSupabase
    .from('leads_crm')
    .select('id, phone, fb_ad_account_id, auto_advance_stage, auto_advance_at')
    .eq('auto_advance_done', false)
    .not('auto_advance_stage', 'is', null)
    .order('auto_advance_at', { ascending: false })
    .limit(50);
  if (error) {
    console.warn('[clientConfig] fetchPendingAdvances:', error.message);
    return [];
  }
  return (data ?? []) as PendingAdvance[];
}

export async function markAdvanceDone(leadCrmId: string): Promise<void> {
  if (!clientConfigSupabase) return;
  await clientConfigSupabase
    .from('leads_crm')
    .update({ auto_advance_done: true })
    .eq('id', leadCrmId);
}

// Запись в client_configs делается через src/lib/cabinetSync.ts — единая точка
// для всех мест, где меняется кабинет (useCabinetsStore + ProjectOnboardingDialog).
