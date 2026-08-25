// Bundled fonts (no external fetch at render — installed via npm @fontsource,
// which the proxy allowlists). Cyrillic subsets included.
// Manrope Variable — clean grotesque for captions/body.
// Montserrat 800/900 — heavy display for headlines/accents.
import "@fontsource-variable/manrope/index.css";
import "@fontsource/montserrat/cyrillic-800.css";
import "@fontsource/montserrat/cyrillic-900.css";
// Cyrillic-ext subset covers Kazakh letters (ә ғ қ ң ө ұ ү һ і).
import "@fontsource/montserrat/cyrillic-ext-800.css";
import "@fontsource/montserrat/cyrillic-ext-900.css";
import "@fontsource/montserrat/latin-800.css";
import "@fontsource/montserrat/latin-900.css";

// Captions / karaoke — bold grotesque.
export const brandFontFamily = "'Manrope Variable', 'Montserrat', sans-serif";
// Headlines / accents / motion overlays — heavy display.
export const displayFontFamily = "'Montserrat', 'Manrope Variable', sans-serif";
