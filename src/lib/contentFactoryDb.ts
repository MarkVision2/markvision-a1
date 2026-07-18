/**
 * Supabase-клиент контент-завода (Clony / szfgdruhlebfvcmlvxdk).
 * Галерея, шаблоны бренда, uploads, content_factory_results — всё здесь.
 *
 * Используем основной supabase-клиент с сессией пользователя: RLS на
 * content_factory_gallery / content_factory_gallery_hidden требует auth.uid().
 * Отдельный clientConfig с persistSession:false не может удалять строки.
 */
import { supabase } from "@/integrations/supabase/client";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { clientSupabaseUrl, supabaseUrl } from "@/lib/supabaseConfig";

export function getContentFactoryDb() {
  // Один и тот же проект — берём авторизованный клиент.
  if (clientSupabaseUrl === supabaseUrl) return supabase;
  // Редкий случай раздельных URL: fallback на clientConfig (без auth).
  return clientConfigSupabase ?? supabase;
}

export function isContentFactoryDbConfigured(): boolean {
  return getContentFactoryDb() !== null;
}
