/**
 * Supabase env с fallback на прод-проект szfg.
 * Publishable key публичный (только для браузера + RLS).
 * Lovable не всегда прокидывает VITE_* — без fallback Контент-центр падает.
 */
const SZFG = {
  projectId: "szfgdruhlebfvcmlvxdk",
  url: "https://szfgdruhlebfvcmlvxdk.supabase.co",
  publishableKey: "sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-",
} as const;

function env(name: keyof ImportMetaEnv, fallback: string): string {
  const v = import.meta.env[name];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

export const supabaseProjectId = env("VITE_SUPABASE_PROJECT_ID", SZFG.projectId);
export const supabaseUrl = env("VITE_SUPABASE_URL", SZFG.url).replace(/\/+$/, "");
export const supabasePublishableKey = env("VITE_SUPABASE_PUBLISHABLE_KEY", SZFG.publishableKey);

export const clientSupabaseUrl = env("VITE_CLIENT_SUPABASE_URL", supabaseUrl).replace(/\/+$/, "");
export const clientSupabasePublishableKey = env(
  "VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY",
  supabasePublishableKey,
);
