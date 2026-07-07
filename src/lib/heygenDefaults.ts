// Дефолты AI монтажа (аватар/голос/шаблон), которые система использует
// автоматически. localStorage — быстрый кэш; источник истины — Supabase
// (таблица heygen_defaults), чтобы Telegram-бот брал те же дефолты.
import { supabase } from "@/integrations/supabase/client";

export interface HeygenDefaults {
  avatar?: {
    id: string;
    kind: "avatar" | "talking_photo";
    name: string;
    mine?: boolean;
    preview_image_url?: string;
    preview_video_url?: string;
  };
  voice?: { id: string; name: string; language?: string; gender?: string };
  templateId?: string;
  templateName?: string;
}

const KEY = "markvision.heygen.defaults";

export function loadDefaults(): HeygenDefaults {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as HeygenDefaults;
  } catch {
    return {};
  }
}

export function patchDefaults(patch: Partial<HeygenDefaults>): HeygenDefaults {
  const next = { ...loadDefaults(), ...patch };
  // Убираем ключи со значением undefined, чтобы «сбросить дефолт».
  (Object.keys(next) as (keyof HeygenDefaults)[]).forEach((k) => {
    if (next[k] === undefined) delete next[k];
  });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage может быть недоступен — не критично */
  }
  // Синхронизируем с сервером (не блокируем UI).
  void saveServerDefaults(next);
  return next;
}

// Таблицы heygen_defaults пока нет в сгенерированных типах — обращаемся
// через нетипизированный клиент.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Прочитать дефолты с сервера (источник истины). null, если нет сессии/строки. */
export async function fetchServerDefaults(): Promise<HeygenDefaults | null> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return null;
  try {
    const { data, error } = await db
      .from("heygen_defaults")
      .select("data")
      .eq("user_id", uid)
      .maybeSingle();
    if (error || !data) return null;
    return (data.data ?? {}) as HeygenDefaults;
  } catch {
    return null;
  }
}

/** Сохранить дефолты на сервер (upsert по user_id). */
export async function saveServerDefaults(d: HeygenDefaults): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return;
  try {
    await db.from("heygen_defaults").upsert({ user_id: uid, data: d });
  } catch {
    /* оффлайн/ошибка сети — кэш в localStorage остаётся */
  }
}

/** Записать дефолты в localStorage-кэш (без обращения к серверу). */
export function cacheDefaults(d: HeygenDefaults): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* не критично */
  }
}
