// Дефолты AI монтажа (аватар/голос/шаблон), которые система использует
// автоматически. Храним локально в браузере — переживает перезагрузку.
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
  return next;
}
