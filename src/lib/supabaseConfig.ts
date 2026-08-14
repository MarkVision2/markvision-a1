/**
 * Единый бэкенд для всех окружений (preview / published) — прод-проект szfg.
 * Publishable key публичный (только для браузера + RLS).
 * Раньше preview подключался к другой базе, из-за чего в переключателе
 * проектов было видно только один проект — теперь база всегда одна.
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

/** env учитывается только если он указывает на тот же прод-проект szfg. */
function envForSzfg(name: keyof ImportMetaEnv, fallback: string): string {
  const v = env(name, fallback);
  return v.includes(SZFG.projectId) ? v : fallback;
}

export const supabaseProjectId = SZFG.projectId;
export const supabaseUrl = envForSzfg("VITE_SUPABASE_URL", SZFG.url).replace(/\/+$/, "");
export const supabasePublishableKey = envForSzfg(
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  SZFG.publishableKey,
);


export const clientSupabaseUrl = env("VITE_CLIENT_SUPABASE_URL", supabaseUrl).replace(/\/+$/, "");
export const clientSupabasePublishableKey = env(
  "VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY",
  supabasePublishableKey,
);
