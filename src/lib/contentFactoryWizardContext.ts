/**
 * Сборка полного контекста мастера: sessionStorage + File из памяти + URL после upload.
 */
import type { WizardInputState } from "@/lib/contentFactoryBrief";
import { readWizardFiles } from "@/lib/wizardFilesStore";

export interface WizardFilesContext {
  logoFile: File | null;
  photos: File[];
  peoplePhotos: File[];
}

export function resolveWizardFiles(
  state: WizardInputState,
  ref?: WizardFilesContext | null,
): WizardFilesContext {
  const stashed = readWizardFiles();
  return {
    logoFile: ref?.logoFile ?? state.logoFile ?? stashed.logoFile ?? null,
    photos: ref?.photos?.length ? ref.photos : state.photos?.length ? state.photos : stashed.photos,
    peoplePhotos: ref?.peoplePhotos?.length
      ? ref.peoplePhotos
      : state.peoplePhotos?.length
        ? state.peoplePhotos
        : stashed.peoplePhotos,
  };
}

/** Объединяет текст из sessionStorage с файлами и URL логотипа после Storage. */
export function enrichWizardState(
  state: WizardInputState,
  files: WizardFilesContext,
  logoUrl?: string | null,
): WizardInputState {
  return {
    ...state,
    logoFile: files.logoFile,
    hasLogo: Boolean(files.logoFile || state.hasLogo),
    logoUrl: logoUrl ?? state.logoUrl ?? null,
    photos: files.photos,
    peoplePhotos: files.peoplePhotos,
    photosCount: files.photos.length,
    peoplePhotosCount: files.peoplePhotos.length,
  };
}
