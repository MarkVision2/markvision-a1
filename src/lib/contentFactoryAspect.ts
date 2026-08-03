/**
 * Соотношения сторон → пиксели для n8n / image models.
 * Meta feed часто дефолтит 4:5 — поэтому width/height передаём явно.
 */

export type WizardAspectId = "1:1" | "4:5" | "9:16" | "16:9" | "3:4" | "21:9" | string;

/** Канонические размеры под рекламные креативы (длинная сторона ~1080). */
export const ASPECT_PIXELS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
  "21:9": { width: 1920, height: 823 },
};

export function normalizeWizardAspect(aspect: unknown): string | null {
  if (typeof aspect !== "string") return null;
  const t = aspect.trim().replace(/\s+/g, "").replace("×", ":").replace("x", ":");
  return t || null;
}

export function resolveAspectPixels(aspect: unknown): {
  aspect: string;
  width: number;
  height: number;
} | null {
  const id = normalizeWizardAspect(aspect);
  if (!id) return null;
  const px = ASPECT_PIXELS[id];
  if (!px) return { aspect: id, width: 1080, height: 1080 };
  return { aspect: id, width: px.width, height: px.height };
}

/** Плоские поля webhook + текст для ТЗ. */
export function buildAspectWebhookFields(aspect: unknown): {
  flat: Record<string, string | number>;
  briefLine: string;
} {
  const resolved = resolveAspectPixels(aspect);
  if (!resolved) {
    return {
      flat: {
        aspect: "",
        aspect_ratio: "",
        width: "",
        height: "",
        image_width: "",
        image_height: "",
      },
      briefLine: "",
    };
  }
  const { aspect: id, width, height } = resolved;
  return {
    flat: {
      aspect: id,
      aspect_ratio: id,
      width,
      height,
      image_width: width,
      image_height: height,
    },
    briefLine:
      `ОБЯЗАТЕЛЬНОЕ соотношение сторон: ${id} (${width}×${height} px). ` +
      `Кадр строго ${id} — не подменять на 4:5, 1:1 или другой формат.`,
  };
}

/** Убрать File из state перед navigate (history state иначе может потеряться). */
export function toSerializableWizardState<T extends Record<string, unknown>>(state: T): Omit<
  T,
  "photos" | "logoFile" | "peoplePhotos"
> & {
  photosCount?: number;
  peoplePhotosCount?: number;
  hasLogo?: boolean;
} {
  const {
    photos: _p,
    logoFile: _l,
    peoplePhotos: _pp,
    ...rest
  } = state as T & {
    photos?: File[];
    logoFile?: File | null;
    peoplePhotos?: File[];
  };
  return {
    ...rest,
    photosCount:
      typeof rest.photosCount === "number"
        ? rest.photosCount
        : Array.isArray(_p)
          ? _p.length
          : 0,
    peoplePhotosCount:
      typeof rest.peoplePhotosCount === "number"
        ? rest.peoplePhotosCount
        : Array.isArray(_pp)
          ? _pp.length
          : 0,
    hasLogo: Boolean(_l || rest.hasLogo),
  };
}
