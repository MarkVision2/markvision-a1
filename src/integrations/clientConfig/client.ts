import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!URL || !KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[clientConfig] VITE_CLIENT_SUPABASE_URL / VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY не заданы — запись в clients_config будет пропущена.',
  );
}

export const clientConfigSupabase: SupabaseClient | null =
  URL && KEY
    ? createClient(URL, KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export interface ClientsConfigRow {
  id: string;
  client_name: string;
  is_active: boolean;
  type: 'Личный' | 'Агентский';
  daily_budget: number | null;
  city: string | null;
  ad_account_id: string | null;
  page_id: string | null;
  page_name: string | null;
  instagram_id: string | null;
  whatsapp_number: string | null;
  waba_phone_number_id: string | null;
  telegram_group_id: string | null;
  pixel_id: string | null;
  pixel_event: string | null;
  website_url: string | null;
  brief: string | null;
}

export interface ClientsSecretsRow {
  client_id: string;
  fb_token: string | null;
}

export async function upsertClientsConfig(
  row: ClientsConfigRow,
  secrets?: Partial<ClientsSecretsRow>,
): Promise<void> {
  if (!clientConfigSupabase) return;

  const { error: cfgErr } = await clientConfigSupabase
    .from('clients_config')
    .upsert(row, { onConflict: 'id' });
  if (cfgErr) throw new Error(`clients_config upsert: ${cfgErr.message}`);

  if (secrets && (secrets.fb_token ?? null) !== null) {
    const { error: secErr } = await clientConfigSupabase
      .from('clients_secrets')
      .upsert(
        { client_id: row.id, fb_token: secrets.fb_token ?? null },
        { onConflict: 'client_id' },
      );
    if (secErr) throw new Error(`clients_secrets upsert: ${secErr.message}`);
  }
}
