import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { clientSupabasePublishableKey, clientSupabaseUrl, supabaseUrl } from '@/lib/supabaseConfig';

const URL = clientSupabaseUrl;
const KEY = clientSupabasePublishableKey;

if (!URL || !KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[clientConfig] VITE_CLIENT_SUPABASE_URL / VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY не заданы — запись в client_configs будет пропущена.',
  );
}

export const clientConfigSupabase: SupabaseClient | null =
  URL && KEY
    ? createClient(URL, KEY, {
        // Отдельный storageKey обязателен: клиентский URL сейчас совпадает с
        // основным, и два GoTrue-клиента на одном ключе хранилища — это
        // предупреждение «Multiple GoTrueClient instances» и риск затереть
        // сессию пользователя.
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'mv-client-config-anon' },
      })
    : null;

/**
 * Клиент для таблиц «клиентского» проекта.
 *
 * clientConfigSupabase создан с persistSession:false и НЕ несёт JWT пользователя —
 * все его запросы уходят как anon. Сейчас клиентский URL совпадает с основным
 * проектом, где RLS выдана роли `authenticated`, поэтому anon-клиент упирался в
 * deny-all: списки приходили пустыми, а запись падала. Если проект тот же —
 * работаем авторизованным клиентом.
 */
export function getClientConfigDb(): SupabaseClient | null {
  if (clientSupabaseUrl === supabaseUrl) return supabase;
  return clientConfigSupabase;
}

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

// Запись в client_configs — src/lib/cabinetSync.ts (через основной supabase + JWT).
