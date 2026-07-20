/** Общие классы для диалогов на мобилке: полноэкранный sheet вместо центрированного popup. */
export const mobileDialogSheet =
  "max-sm:fixed max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:z-50 " +
  "max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-full max-sm:max-w-none " +
  "max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none " +
  "max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom,0px)]";

/** Паддинг футера диалога с учётом safe-area (кнопки не под home indicator). */
export const mobileDialogFooterPad =
  "max-sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]";
