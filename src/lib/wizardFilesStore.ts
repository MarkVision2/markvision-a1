/**
 * In-memory хранилище File[] между шагами мастера.
 * File нельзя положить в sessionStorage — location.state иногда теряется
 * при back/forward или ре-рендере, поэтому дублируем в модуле.
 */

export interface WizardFilesStash {
  logoFile: File | null;
  photos: File[];
  peoplePhotos: File[];
}

const empty = (): WizardFilesStash => ({
  logoFile: null,
  photos: [],
  peoplePhotos: [],
});

let stash: WizardFilesStash = empty();

export function stashWizardFiles(patch: Partial<WizardFilesStash>): void {
  if (patch.logoFile !== undefined) stash.logoFile = patch.logoFile;
  if (patch.photos !== undefined) stash.photos = patch.photos;
  if (patch.peoplePhotos !== undefined) stash.peoplePhotos = patch.peoplePhotos;
}

export function readWizardFiles(): WizardFilesStash {
  return {
    logoFile: stash.logoFile,
    photos: [...stash.photos],
    peoplePhotos: [...stash.peoplePhotos],
  };
}

export function clearWizardFiles(): void {
  stash = empty();
}
