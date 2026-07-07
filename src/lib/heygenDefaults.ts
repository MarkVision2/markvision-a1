// Дефолты AI монтажа (аватар/голос/шаблон) — НА ПРОЕКТ (клиента).
// localStorage — быстрый кэш; источник истины — Supabase (heygen_defaults),
// чтобы Telegram-бот брал те же дефолты для нужного проекта.
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

const keyFor = (projectId: string) => `markvision.heygen.defaults.${projectId || "none"}`;

export function loadDefaults(projectId: string): HeygenDefaults {
  try {
    return JSON.parse(localStorage.getItem(keyFor(projectId)) || "{}") as HeygenDefaults;
  } catch {
    return {};
  }
}

/** Записать дефолты в localStorage-кэш проекта (без обращения к серверу). */
export function cacheDefaults(projectId: string, d: HeygenDefaults): void {
  try {
    localStorage.setItem(keyFor(projectId), JSON.stringify(d));
  } catch {
    /* не критично */
  }
}

export function patchDefaults(projectId: string, patch: Partial<HeygenDefaults>): HeygenDefaults {
  const next = { ...loadDefaults(projectId), ...patch };
  (Object.keys(next) as (keyof HeygenDefaults)[]).forEach((k) => {
    if (next[k] === undefined) delete next[k];
  });
  cacheDefaults(projectId, next);
  void saveServerDefaults(projectId, next);
  return next;
}

// Таблицы heygen_defaults пока нет в сгенерированных типах — нетипизированный клиент.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Прочитать дефолты проекта с сервера. null, если нет проекта/строки. */
export async function fetchServerDefaults(projectId: string): Promise<HeygenDefaults | null> {
  if (!projectId) return null;
  try {
    const { data, error } = await db
      .from("heygen_defaults")
      .select("data")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error || !data) return null;
    return (data.data ?? {}) as HeygenDefaults;
  } catch {
    return null;
  }
}

/** Сохранить дефолты проекта на сервер (upsert по project_id). */
export async function saveServerDefaults(projectId: string, d: HeygenDefaults): Promise<void> {
  if (!projectId) return;
  try {
    await db.from("heygen_defaults").upsert({ project_id: projectId, data: d });
  } catch {
    /* оффлайн/ошибка — кэш остаётся */
  }
}
