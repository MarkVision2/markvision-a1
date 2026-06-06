/**
 * Supabase-клиент контент-завода (Clony / szfgdruhlebfvcmlvxdk).
 * Галерея, шаблоны бренда, uploads, content_factory_results — всё здесь.
 */
import { clientConfigSupabase } from "@/integrations/clientConfig/client";

export function getContentFactoryDb() {
  return clientConfigSupabase;
}

export function isContentFactoryDbConfigured(): boolean {
  return clientConfigSupabase !== null;
}
