// Узнаваемые цветные логотипы брендов для карточек форматов Контент-завода.
export const BRAND_LOGO_IDS = new Set<string>([
  "facebook-ads", "google-ads", "youtube-thumb",
  "insta-carousel", "reels-cover", "stories", "marketplace",
]);

export function hasBrandIcon(id: string): boolean {
  return BRAND_LOGO_IDS.has(id);
}

const IG_STOPS = (
  <>
    <stop offset="0" stopColor="#FED576" />
    <stop offset="0.26" stopColor="#F47133" />
    <stop offset="0.61" stopColor="#BC3081" />
    <stop offset="1" stopColor="#4C63D2" />
  </>
);

export function BrandIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case "facebook-ads":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <path
            fill="#1877F2"
            d="M24 12a12 12 0 1 0-13.875 11.854v-8.385H7.078V12h3.047V9.356c0-3.007 1.79-4.669 4.533-4.669 1.313 0 2.686.235 2.686.235v2.953H15.83c-1.49 0-1.955.925-1.955 1.874V12h3.328l-.532 3.469h-2.796v8.385A12 12 0 0 0 24 12Z"
          />
        </svg>
      );
    case "google-ads":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z" />
          <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09Z" />
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
        </svg>
      );
    case "youtube-thumb":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <rect x="1" y="5" width="22" height="14" rx="4.2" fill="#FF0000" />
          <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="#fff" />
        </svg>
      );
    case "insta-carousel":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <defs><radialGradient id="igCarousel" cx="0.3" cy="1" r="1.1">{IG_STOPS}</radialGradient></defs>
          <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#igCarousel)" />
          <circle cx="12" cy="12" r="4.4" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="17.2" cy="6.8" r="1.15" fill="#fff" />
        </svg>
      );
    case "reels-cover":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <defs><radialGradient id="igReels" cx="0.3" cy="1" r="1.1">{IG_STOPS}</radialGradient></defs>
          <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#igReels)" />
          <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="#fff" />
        </svg>
      );
    case "stories":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <defs><linearGradient id="igStories" x1="0" y1="1" x2="1" y2="0">{IG_STOPS}</linearGradient></defs>
          <circle cx="12" cy="12" r="9.2" fill="none" stroke="url(#igStories)" strokeWidth="2.3" />
          <circle cx="12" cy="12" r="3.8" fill="url(#igStories)" />
        </svg>
      );
    case "marketplace":
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden>
          <defs><linearGradient id="wbGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5B1FA6" /><stop offset="1" stopColor="#E6127D" /></linearGradient></defs>
          <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#wbGrad)" />
          <text x="12" y="16.2" textAnchor="middle" fontSize="8.6" fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff">WB</text>
        </svg>
      );
    default:
      return null;
  }
}
