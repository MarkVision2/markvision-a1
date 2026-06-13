# Дизайн-интеллект UI/UX Pro Max — обязательный справочник для сборки лендингов

Источник: база UI/UX Pro Max (67 стилей, 161 палитра, 57 шрифтовых пар, 99 UX-правил). Эти данные превращают обычную верстку в профессиональный дизайн. **Перед сборкой ВСЕГДА выбери дизайн-систему по 4 шагам ниже, затем верстай строго по ней.** Это не опционально — лендинг без осознанного выбора стиля/палитры/шрифтов считается недоделанным.

## Как выбрать дизайн-систему за 4 шага

1. **Определи нишу** из ТЗ (поля: ниша, продукт, тип продукта, тон). Найди ближайшую строку в разделе «1. Палитры».
2. **Возьми палитру** — это готовый блок CSS-переменных. Вставь его в :root. Меняй цвета только если в ТЗ заданы фирменные.
3. **Выбери стиль** из раздела «2. Каталог стилей» под тон бренда (премиум / дружелюбный / техно / строгий / смелый).
4. **Выбери шрифтовую пару** из раздела «3. Шрифты» под нишу и подключи Google Fonts в <head>.
Если точной ниши нет — бери ближайшую по смыслу: барбершоп→Beauty/Spa; стоматология→Dental; автосервис→Automotive; юрист→Legal; репетитор/курсы→Online Course; кофейня→Bakery/Cafe; застройщик→Real Estate; клиника→Medical.
Готовую связку для популярных ниш смотри в разделе «5. Быстрый выбор».

Раздел «4. UX и конверсия» — обязательные правила, их нарушать нельзя независимо от выбранного стиля.

---

## 1. Палитры по нишам (готовые CSS-токены)

Каждая палитра — вставляемый блок :root. Токены совместимы с Tailwind (используй var(--primary) в style или произвольные классы). On-* = цвет текста поверх соответствующего фона (контраст уже подобран).

### SaaS (General)
_Trust blue + orange CTA contrast [Accent adjusted from #F97316 for WCAG 3:1]_

    :root {
      --primary: #2563EB;
      --primary-foreground: #FFFFFF;
      --secondary: #3B82F6;
      --secondary-foreground: #FFFFFF;
      --accent: #EA580C;
      --accent-foreground: #FFFFFF;
      --background: #F8FAFC;
      --foreground: #1E293B;
      --card: #FFFFFF;
      --card-foreground: #1E293B;
      --muted: #E9EFF8;
      --muted-foreground: #64748B;
      --border: #E2E8F0;
      --destructive: #DC2626;
      --ring: #2563EB;
    }

### B2B Service
_Professional navy + blue CTA_

    :root {
      --primary: #0F172A;
      --primary-foreground: #FFFFFF;
      --secondary: #334155;
      --secondary-foreground: #FFFFFF;
      --accent: #0369A1;
      --accent-foreground: #FFFFFF;
      --background: #F8FAFC;
      --foreground: #020617;
      --card: #FFFFFF;
      --card-foreground: #020617;
      --muted: #E8ECF1;
      --muted-foreground: #64748B;
      --border: #E2E8F0;
      --destructive: #DC2626;
      --ring: #0F172A;
    }

### E-commerce
_Success green + urgency orange [Accent adjusted from #F97316 for WCAG 3:1]_

    :root {
      --primary: #059669;
      --primary-foreground: #FFFFFF;
      --secondary: #10B981;
      --secondary-foreground: #0F172A;
      --accent: #EA580C;
      --accent-foreground: #FFFFFF;
      --background: #ECFDF5;
      --foreground: #064E3B;
      --card: #FFFFFF;
      --card-foreground: #064E3B;
      --muted: #E8F1F3;
      --muted-foreground: #64748B;
      --border: #A7F3D0;
      --destructive: #DC2626;
      --ring: #059669;
    }

### Marketing Agency
_Bold pink + creative cyan [Accent adjusted from #06B6D4 for WCAG 3:1]_

    :root {
      --primary: #EC4899;
      --primary-foreground: #FFFFFF;
      --secondary: #F472B6;
      --secondary-foreground: #0F172A;
      --accent: #0891B2;
      --accent-foreground: #FFFFFF;
      --background: #FDF2F8;
      --foreground: #831843;
      --card: #FFFFFF;
      --card-foreground: #831843;
      --muted: #F1EEF5;
      --muted-foreground: #64748B;
      --border: #FBCFE8;
      --destructive: #DC2626;
      --ring: #EC4899;
    }

### Creative Agency
_Bold pink + cyan accent [Accent adjusted from #06B6D4 for WCAG 3:1]_

    :root {
      --primary: #EC4899;
      --primary-foreground: #FFFFFF;
      --secondary: #F472B6;
      --secondary-foreground: #0F172A;
      --accent: #0891B2;
      --accent-foreground: #FFFFFF;
      --background: #FDF2F8;
      --foreground: #831843;
      --card: #FFFFFF;
      --card-foreground: #831843;
      --muted: #F1EEF5;
      --muted-foreground: #64748B;
      --border: #FBCFE8;
      --destructive: #DC2626;
      --ring: #EC4899;
    }

### Beauty/Spa/Wellness Service
_Soft pink + lavender luxury_

    :root {
      --primary: #EC4899;
      --primary-foreground: #FFFFFF;
      --secondary: #F9A8D4;
      --secondary-foreground: #0F172A;
      --accent: #8B5CF6;
      --accent-foreground: #FFFFFF;
      --background: #FDF2F8;
      --foreground: #831843;
      --card: #FFFFFF;
      --card-foreground: #831843;
      --muted: #F1EEF5;
      --muted-foreground: #64748B;
      --border: #FBCFE8;
      --destructive: #DC2626;
      --ring: #EC4899;
    }

### Restaurant/Food Service
_Appetizing red + warm gold [Accent adjusted from #CA8A04 for WCAG 3:1]_

    :root {
      --primary: #DC2626;
      --primary-foreground: #FFFFFF;
      --secondary: #F87171;
      --secondary-foreground: #0F172A;
      --accent: #A16207;
      --accent-foreground: #FFFFFF;
      --background: #FEF2F2;
      --foreground: #450A0A;
      --card: #FFFFFF;
      --card-foreground: #450A0A;
      --muted: #F0EDF1;
      --muted-foreground: #64748B;
      --border: #FECACA;
      --destructive: #DC2626;
      --ring: #DC2626;
    }

### Bakery/Cafe
_Warm brown + cream white [Accent adjusted from #F8FAFC for WCAG 3:1]_

    :root {
      --primary: #92400E;
      --primary-foreground: #FFFFFF;
      --secondary: #B45309;
      --secondary-foreground: #FFFFFF;
      --accent: #92400E;
      --accent-foreground: #FFFFFF;
      --background: #FEF3C7;
      --foreground: #78350F;
      --card: #FFFFFF;
      --card-foreground: #78350F;
      --muted: #EDEEF0;
      --muted-foreground: #64748B;
      --border: #FDE68A;
      --destructive: #DC2626;
      --ring: #92400E;
    }

### Fitness/Gym App
_Energy orange + success green_

    :root {
      --primary: #F97316;
      --primary-foreground: #0F172A;
      --secondary: #FB923C;
      --secondary-foreground: #0F172A;
      --accent: #22C55E;
      --accent-foreground: #0F172A;
      --background: #1F2937;
      --foreground: #F8FAFC;
      --card: #313742;
      --card-foreground: #F8FAFC;
      --muted: #37414F;
      --muted-foreground: #94A3B8;
      --border: #374151;
      --destructive: #EF4444;
      --ring: #F97316;
    }

### Real Estate/Property
_Trust teal + professional blue_

    :root {
      --primary: #0F766E;
      --primary-foreground: #FFFFFF;
      --secondary: #14B8A6;
      --secondary-foreground: #0F172A;
      --accent: #0369A1;
      --accent-foreground: #FFFFFF;
      --background: #F0FDFA;
      --foreground: #134E4A;
      --card: #FFFFFF;
      --card-foreground: #134E4A;
      --muted: #E8F0F3;
      --muted-foreground: #64748B;
      --border: #99F6E4;
      --destructive: #DC2626;
      --ring: #0F766E;
    }

### Medical Clinic
_Medical teal + health green [Accent adjusted from #22C55E for WCAG 3:1]_

    :root {
      --primary: #0891B2;
      --primary-foreground: #FFFFFF;
      --secondary: #22D3EE;
      --secondary-foreground: #0F172A;
      --accent: #16A34A;
      --accent-foreground: #FFFFFF;
      --background: #F0FDFA;
      --foreground: #134E4A;
      --card: #FFFFFF;
      --card-foreground: #134E4A;
      --muted: #E8F1F6;
      --muted-foreground: #64748B;
      --border: #CCFBF1;
      --destructive: #DC2626;
      --ring: #0891B2;
    }

### Dental Practice
_Fresh blue + smile yellow [Accent adjusted from #FBBF24 for WCAG 3:1]_

    :root {
      --primary: #0EA5E9;
      --primary-foreground: #0F172A;
      --secondary: #38BDF8;
      --secondary-foreground: #0F172A;
      --accent: #0EA5E9;
      --accent-foreground: #0F172A;
      --background: #F0F9FF;
      --foreground: #0C4A6E;
      --card: #FFFFFF;
      --card-foreground: #0C4A6E;
      --muted: #E8F2F8;
      --muted-foreground: #64748B;
      --border: #BAE6FD;
      --destructive: #DC2626;
      --ring: #0EA5E9;
    }

### Online Course/E-learning
_Progress teal + achievement orange [Accent adjusted from #F97316 for WCAG 3:1]_

    :root {
      --primary: #0D9488;
      --primary-foreground: #FFFFFF;
      --secondary: #2DD4BF;
      --secondary-foreground: #0F172A;
      --accent: #EA580C;
      --accent-foreground: #FFFFFF;
      --background: #F0FDFA;
      --foreground: #134E4A;
      --card: #FFFFFF;
      --card-foreground: #134E4A;
      --muted: #E8F1F4;
      --muted-foreground: #64748B;
      --border: #5EEAD4;
      --destructive: #DC2626;
      --ring: #0D9488;
    }

### Educational App
_Playful indigo + energetic orange [Accent adjusted from #F97316 for WCAG 3:1]_

    :root {
      --primary: #4F46E5;
      --primary-foreground: #FFFFFF;
      --secondary: #818CF8;
      --secondary-foreground: #0F172A;
      --accent: #EA580C;
      --accent-foreground: #FFFFFF;
      --background: #EEF2FF;
      --foreground: #1E1B4B;
      --card: #FFFFFF;
      --card-foreground: #1E1B4B;
      --muted: #EBEEF8;
      --muted-foreground: #64748B;
      --border: #C7D2FE;
      --destructive: #DC2626;
      --ring: #4F46E5;
    }

### Legal Services
_Authority navy + trust gold_

    :root {
      --primary: #1E3A8A;
      --primary-foreground: #FFFFFF;
      --secondary: #1E40AF;
      --secondary-foreground: #FFFFFF;
      --accent: #B45309;
      --accent-foreground: #FFFFFF;
      --background: #F8FAFC;
      --foreground: #0F172A;
      --card: #FFFFFF;
      --card-foreground: #0F172A;
      --muted: #E9EEF5;
      --muted-foreground: #64748B;
      --border: #CBD5E1;
      --destructive: #DC2626;
      --ring: #1E3A8A;
    }

### Construction/Architecture
_Industrial grey + safety orange [Accent adjusted from #F97316 for WCAG 3:1]_

    :root {
      --primary: #64748B;
      --primary-foreground: #FFFFFF;
      --secondary: #94A3B8;
      --secondary-foreground: #0F172A;
      --accent: #EA580C;
      --accent-foreground: #FFFFFF;
      --background: #F8FAFC;
      --foreground: #334155;
      --card: #FFFFFF;
      --card-foreground: #334155;
      --muted: #EBF0F5;
      --muted-foreground: #64748B;
      --border: #E2E8F0;
      --destructive: #DC2626;
      --ring: #64748B;
    }

### Automotive/Car Dealership
_Premium dark + action red_

    :root {
      --primary: #1E293B;
      --primary-foreground: #FFFFFF;
      --secondary: #334155;
      --secondary-foreground: #FFFFFF;
      --accent: #DC2626;
      --accent-foreground: #FFFFFF;
      --background: #F8FAFC;
      --foreground: #0F172A;
      --card: #FFFFFF;
      --card-foreground: #0F172A;
      --muted: #E9EDF1;
      --muted-foreground: #64748B;
      --border: #E2E8F0;
      --destructive: #DC2626;
      --ring: #1E293B;
    }

### Travel/Tourism Agency
_Sky blue + adventure orange [Accent adjusted from #F97316 for WCAG 3:1]_

    :root {
      --primary: #0EA5E9;
      --primary-foreground: #0F172A;
      --secondary: #38BDF8;
      --secondary-foreground: #0F172A;
      --accent: #EA580C;
      --accent-foreground: #FFFFFF;
      --background: #F0F9FF;
      --foreground: #0C4A6E;
      --card: #FFFFFF;
      --card-foreground: #0C4A6E;
      --muted: #E8F2F8;
      --muted-foreground: #64748B;
      --border: #BAE6FD;
      --destructive: #DC2626;
      --ring: #0EA5E9;
    }

### Hotel/Hospitality
_Luxury navy + gold service [Accent adjusted from #CA8A04 for WCAG 3:1]_

    :root {
      --primary: #1E3A8A;
      --primary-foreground: #FFFFFF;
      --secondary: #3B82F6;
      --secondary-foreground: #FFFFFF;
      --accent: #A16207;
      --accent-foreground: #FFFFFF;
      --background: #F8FAFC;
      --foreground: #1E40AF;
      --card: #FFFFFF;
      --card-foreground: #1E40AF;
      --muted: #E9EEF5;
      --muted-foreground: #64748B;
      --border: #BFDBFE;
      --destructive: #DC2626;
      --ring: #1E3A8A;
    }

### Luxury/Premium Brand
_Premium black + gold accent [Accent adjusted from #CA8A04 for WCAG 3:1]_

    :root {
      --primary: #1C1917;
      --primary-foreground: #FFFFFF;
      --secondary: #44403C;
      --secondary-foreground: #FFFFFF;
      --accent: #A16207;
      --accent-foreground: #FFFFFF;
      --background: #FAFAF9;
      --foreground: #0C0A09;
      --card: #FFFFFF;
      --card-foreground: #0C0A09;
      --muted: #E8ECF0;
      --muted-foreground: #64748B;
      --border: #D6D3D1;
      --destructive: #DC2626;
      --ring: #1C1917;
    }

### Fintech/Crypto
_Gold trust + purple tech_

    :root {
      --primary: #F59E0B;
      --primary-foreground: #0F172A;
      --secondary: #FBBF24;
      --secondary-foreground: #0F172A;
      --accent: #8B5CF6;
      --accent-foreground: #FFFFFF;
      --background: #0F172A;
      --foreground: #F8FAFC;
      --card: #222735;
      --card-foreground: #F8FAFC;
      --muted: #272F42;
      --muted-foreground: #94A3B8;
      --border: #334155;
      --destructive: #EF4444;
      --ring: #F59E0B;
    }

### Banking/Traditional Finance
_Trust navy + premium gold [Accent adjusted from #CA8A04 for WCAG 3:1]_

    :root {
      --primary: #0F172A;
      --primary-foreground: #FFFFFF;
      --secondary: #1E3A8A;
      --secondary-foreground: #FFFFFF;
      --accent: #A16207;
      --accent-foreground: #FFFFFF;
      --background: #F8FAFC;
      --foreground: #020617;
      --card: #FFFFFF;
      --card-foreground: #020617;
      --muted: #E8ECF1;
      --muted-foreground: #64748B;
      --border: #E2E8F0;
      --destructive: #DC2626;
      --ring: #0F172A;
    }

### Home Services (Plumber/Electrician)
_Professional blue + urgent orange [Accent adjusted from #F97316 for WCAG 3:1]_

    :root {
      --primary: #1E40AF;
      --primary-foreground: #FFFFFF;
      --secondary: #3B82F6;
      --secondary-foreground: #FFFFFF;
      --accent: #EA580C;
      --accent-foreground: #FFFFFF;
      --background: #EFF6FF;
      --foreground: #1E3A8A;
      --card: #FFFFFF;
      --card-foreground: #1E3A8A;
      --muted: #E9EEF6;
      --muted-foreground: #64748B;
      --border: #BFDBFE;
      --destructive: #DC2626;
      --ring: #1E40AF;
    }

### Coworking Space
_Energetic amber + booking blue_

    :root {
      --primary: #F59E0B;
      --primary-foreground: #0F172A;
      --secondary: #FBBF24;
      --secondary-foreground: #0F172A;
      --accent: #2563EB;
      --accent-foreground: #FFFFFF;
      --background: #FFFBEB;
      --foreground: #78350F;
      --card: #FFFFFF;
      --card-foreground: #78350F;
      --muted: #F1F2EF;
      --muted-foreground: #64748B;
      --border: #FDE68A;
      --destructive: #DC2626;
      --ring: #F59E0B;
    }

### Wedding/Event Planning
_Romantic pink + elegant gold [Accent adjusted from #CA8A04 for WCAG 3:1]_

    :root {
      --primary: #DB2777;
      --primary-foreground: #FFFFFF;
      --secondary: #F472B6;
      --secondary-foreground: #0F172A;
      --accent: #A16207;
      --accent-foreground: #FFFFFF;
      --background: #FDF2F8;
      --foreground: #831843;
      --card: #FFFFFF;
      --card-foreground: #831843;
      --muted: #F0EDF4;
      --muted-foreground: #64748B;
      --border: #FBCFE8;
      --destructive: #DC2626;
      --ring: #DB2777;
    }

### Childcare/Daycare
_Soft pink + safe green [Accent adjusted from #22C55E for WCAG 3:1]_

    :root {
      --primary: #F472B6;
      --primary-foreground: #0F172A;
      --secondary: #FBCFE8;
      --secondary-foreground: #0F172A;
      --accent: #16A34A;
      --accent-foreground: #FFFFFF;
      --background: #FDF2F8;
      --foreground: #9D174D;
      --card: #FFFFFF;
      --card-foreground: #9D174D;
      --muted: #F1F0F6;
      --muted-foreground: #64748B;
      --border: #FCE7F3;
      --destructive: #DC2626;
      --ring: #F472B6;
    }

### Photography Studio
_Pure black + white contrast_

    :root {
      --primary: #18181B;
      --primary-foreground: #FFFFFF;
      --secondary: #27272A;
      --secondary-foreground: #FFFFFF;
      --accent: #F8FAFC;
      --accent-foreground: #0F172A;
      --background: #000000;
      --foreground: #FAFAFA;
      --card: #0C0C0C;
      --card-foreground: #FAFAFA;
      --muted: #181818;
      --muted-foreground: #94A3B8;
      --border: #3F3F46;
      --destructive: #EF4444;
      --ring: #18181B;
    }

---

## 2. Каталог стилей

Под каждый стиль: когда применять, ключевые признаки и эффекты, поддержка светлой/тёмной темы, заточен ли под конверсию.

### Minimalism & Swiss Style
- Ключевые слова: Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential
- Когда применять: Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools
- Эффекты/анимация: Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading
- CSS-признаки: display: grid, gap: 2rem, font-family: sans-serif, color: #000 or #FFF, max-width: 1200px, clean borders, no box-shadow unless necessary
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ◐ Medium | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AAA
- Токены-подсказки: --spacing: 2rem, --border-radius: 0px, --font-weight: 400-700, --shadow: none, --accent-color: single primary only

### Exaggerated Minimalism
- Ключевые слова: Bold minimalism, oversized typography, high contrast, negative space, loud minimal, statement design
- Когда применять: Fashion, architecture, portfolios, agency landing pages, luxury brands, editorial
- Эффекты/анимация: font-size: clamp(3rem 10vw 12rem), font-weight: 900, letter-spacing: -0.05em, massive whitespace
- CSS-признаки: font-size: clamp(3rem, 10vw, 12rem), font-weight: 900, letter-spacing: -0.05em, color: #000 or #FFF, padding: 8rem+, single accent, no decorations
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AA
- Токены-подсказки: --type-giant: clamp(3rem, 10vw, 12rem), --type-weight: 900, --spacing-huge: 8rem, --color-primary: #000000, --color-bg: #FFFFFF, --accent: single color only

### Glassmorphism
- Ключевые слова: Frosted glass, transparent, blurred background, layered, vibrant background, light source, depth, multi-layer
- Когда применять: Modern SaaS, financial dashboards, high-end corporate, lifestyle apps, modal overlays, navigation
- Эффекты/анимация: Backdrop blur (10-20px), subtle border (1px solid rgba white 0.2), light reflection, Z-depth
- CSS-признаки: backdrop-filter: blur(15px), background: rgba(255, 255, 255, 0.15), border: 1px solid rgba(255,255,255,0.2), -webkit-backdrop-filter: blur(15px), z-i…
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚠ Good | Доступность: ⚠ Ensure 4.5:1
- Токены-подсказки: --blur-amount: 15px, --glass-opacity: 0.15, --border-color: rgba(255,255,255,0.2), --background: vibrant color, --text-color: light/dark based on BG

### Gradient Mesh / Aurora Evolved
- Ключевые слова: Complex gradients, mesh gradients, multi-color blend, aurora effect, flowing colors, iridescent, holographic, prismatic
- Когда применять: Hero sections, backgrounds, creative brands, music platforms, fashion, lifestyle, premium products
- Эффекты/анимация: CSS mesh-gradient (experimental), SVG gradients, canvas gradients, smooth color morphing, flowing animation
- CSS-признаки: background: conic-gradient or mesh (SVG), animation: gradient flow (background-position), filter: hue-rotate for shimmer, mix-blend-mode: screen, can…
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚠ Good | Доступность: ⚠ Text contrast
- Токены-подсказки: --mesh-color-1: #00FFFF, --mesh-color-2: #FF00FF, --mesh-color-3: #FFFF00, --mesh-color-4: #00FF66, --flow-duration: 10s, --shimmer-intensity: 0.3

### Bento Grids
- Ключевые слова: Apple-style, modular, cards, organized, clean, hierarchy, grid, rounded, soft
- Когда применять: Product features, dashboards, personal sites, marketing summaries, galleries
- Эффекты/анимация: Hover scale (1.02), soft shadow expansion, smooth layout shifts, content reveal
- CSS-признаки: display: grid, grid-template-columns: repeat(auto-fit, minmax(...)), gap: 1rem, border-radius: 20px, background: #FFF, box-shadow: subtle
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AA
- Токены-подсказки: --grid-gap: 20px, --card-radius: 24px, --card-bg: #FFFFFF, --page-bg: #F5F5F7, --shadow: soft

### Dark Mode (OLED)
- Ключевые слова: Dark theme, low light, high contrast, deep black, midnight blue, eye-friendly, OLED, night mode, power efficient
- Когда применять: Night-mode apps, coding platforms, entertainment, eye-strain prevention, OLED devices, low-light
- Эффекты/анимация: Minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, low white emission, high readability, visible focus
- CSS-признаки: background: #000000 or #121212, color: #FFFFFF or #E0E0E0, text-shadow: 0 0 10px neon-color (sparingly), filter: brightness(0.8) if needed, color-sch…
- Светлая: ✗ No | Тёмная: ✓ Only | Конверсия: ◐ Low | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AAA
- Токены-подсказки: --bg-black: #000000, --bg-dark-grey: #121212, --text-primary: #FFFFFF, --accent-neon: neon colors, --glow-effect: minimal, --oled-optimized: true

### Claymorphism
- Ключевые слова: Soft 3D, chunky, playful, toy-like, bubbly, thick borders (3-4px), double shadows, rounded (16-24px)
- Когда применять: Educational apps, children's apps, SaaS platforms, creative tools, fun-focused, onboarding, casual games
- Эффекты/анимация: Inner+outer shadows (subtle, no hard lines), soft press (200ms ease-out), fluffy elements, smooth transitions
- CSS-признаки: border-radius: 16-24px, border: 3-4px solid, box-shadow: inset -2px -2px 8px, 4px 4px 8px, background: pastel-gradient, animation: soft bounce (cubic…
- Светлая: ✓ Full | Тёмная: ◐ Partial | Конверсия: ✓ High | Производит.: ⚡ Good | Доступность: ⚠ Ensure 4.5:1
- Токены-подсказки: --border-radius: 20px, --border-width: 3-4px, --shadow-inner: inset -2px -2px 8px, --shadow-outer: 4px 4px 8px, --color-palette: pastels, --animation: bounce

### Neubrutalism
- Ключевые слова: Bold borders, black outlines, primary colors, thick shadows, no gradients, flat colors, 45° shadows, playful, Gen Z
- Когда применять: Gen Z brands, startups, creative agencies, Figma-style apps, Notion-style interfaces, tech blogs
- Эффекты/анимация: box-shadow: 4px 4px 0 #000, border: 3px solid #000, no gradients, sharp corners (0px), bold typography
- CSS-признаки: border: 3px solid black, box-shadow: 5px 5px 0px black, colors: #FFDB58 #FF6B6B #4ECDC4, font-weight: 700, no gradients
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AAA
- Токены-подсказки: --border-width: 3px, --shadow-offset: 4px, --shadow-color: #000, --colors: high saturation, --font: bold sans

### Hero-Centric Design
- Ключевые слова: Large hero section, compelling headline, high-contrast CTA, product showcase, value proposition, hero image/video, dram…
- Когда применять: SaaS landing pages, product launches, service landing pages, B2B platforms, tech companies
- Эффекты/анимация: Smooth scroll reveal, fade-in animations on hero, subtle background parallax, CTA glow/pulse effect
- CSS-признаки: min-height: 100vh, display: flex, align-items: center, background: linear-gradient or image, text-shadow for readability, max-width: 800px for text, …
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ Very High | Производит.: ⚡ Good | Доступность: ✓ WCAG AA
- Токены-подсказки: --hero-min-height: 100vh, --headline-size: clamp(2rem, 5vw, 4rem), --cta-padding: 1rem 2rem, --overlay-opacity: 0.5, --text-shadow: 0 2px 4px rgba(0,0,0,0.3)

### Conversion-Optimized
- Ключевые слова: Form-focused, minimalist design, single CTA focus, high contrast, urgency elements, trust signals, social proof, clear …
- Когда применять: E-commerce product pages, free trial signups, lead generation, SaaS pricing pages, limited-time offers
- Эффекты/анимация: Hover states on CTA (color shift, slight scale), form field focus animations, loading spinner, success feedback
- CSS-признаки: form with focus states, input:focus ring, button: primary color high contrast, position: sticky for CTA, max-width: 600px for form, loading spinner, …
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ Very High | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AA
- Токены-подсказки: --cta-color: high contrast primary, --form-max-width: 600px, --input-height: 48px, --focus-ring: 3px solid accent, --success-color: #22C55E, --error-color: #EF…

### Trust & Authority
- Ключевые слова: Certificates/badges displayed, expert credentials, case studies with metrics, before/after comparisons, industry recogn…
- Когда применять: Healthcare/medical landing pages, financial services, enterprise software, premium/luxury products, legal services
- Эффекты/анимация: Badge hover effects, metric pulse animations, certificate carousel, smooth stat reveal
- CSS-признаки: badge grid layout, shield icons, lock icons for security, certificate styling, metric cards with icons, professional color scheme (blue/grey), subtle…
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AAA
- Токены-подсказки: --badge-height: 48px, --trust-color: #1E40AF, --security-green: #059669, --card-shadow: 0 4px 6px rgba(0,0,0,0.1), --metric-highlight: #F59E0B

### Editorial Grid / Magazine
- Ключевые слова: Magazine layout, asymmetric grid, editorial typography, pull quotes, drop caps, column layout, print-inspired
- Когда применять: News sites, blogs, magazines, editorial content, long-form articles, journalism, publishing
- Эффекты/анимация: Smooth scroll, reveal on scroll, parallax images, text animations, page-flip transitions
- CSS-признаки: display: grid with named areas, column-count for text, ::first-letter for drop caps, blockquote styling, figure/figcaption, gap variations, font: ser…
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ Medium | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AAA
- Токены-подсказки: --grid-cols: asymmetric, --body-font: Georgia/Merriweather, --heading-font: bold sans, --drop-cap-size: 4em, --pull-quote-size: 1.5em, --column-gap: 2rem

### Soft UI Evolution
- Ключевые слова: Evolved soft UI, better contrast, modern aesthetics, subtle depth, accessibility-focused, improved shadows, hybrid
- Когда применять: Modern enterprise apps, SaaS platforms, health/wellness, modern business tools, professional, hybrid
- Эффекты/анимация: Improved shadows (softer than flat, clearer than neumorphism), modern (200-300ms), focus visible, WCAG AA/AAA
- CSS-признаки: box-shadow: softer multi-layer (0 2px 4px), background: improved contrast pastels, border-radius: 8-12px, animation: 200-300ms smooth, outline: 2-3px…
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AA+
- Токены-подсказки: --shadow-soft: modern blend, --border-radius: 10px, --animation-duration: 200-300ms, --contrast-ratio: 4.5:1+, --color-hierarchy: improved, --wcag-level: AA+

### Flat Design
- Ключевые слова: 2D, minimalist, bold colors, no shadows, clean lines, simple shapes, typography-focused, modern, icon-heavy
- Когда применять: Web apps, mobile apps, cross-platform, startup MVPs, user-friendly, SaaS, dashboards, corporate
- Эффекты/анимация: No gradients/shadows, simple hover (color/opacity shift), fast loading, clean transitions (150-200ms ease), minimal icons
- CSS-признаки: box-shadow: none, background: solid color, border-radius: 0-4px, color: solid (no gradients), fill: solid, stroke: 1-2px, font: bold sans-serif, icon…
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚡ Excellent | Доступность: ✓ WCAG AAA
- Токены-подсказки: --shadow: none, --color-palette: 4-6 solid, --border-radius: 2px, --gradient: none, --icons: simplified SVG, --animation: minimal 150-200ms

### 3D Product Preview
- Ключевые слова: 360 product view, rotatable, zoomable, touch-to-spin, AR preview, product configurator, interactive 3D model
- Когда применять: E-commerce, furniture, fashion, automotive, electronics, jewelry, product configurators
- Эффекты/анимация: Drag-to-rotate, pinch-to-zoom, spin animation, AR placement, material switching, smooth orbit controls
- CSS-признаки: Three.js or model-viewer, OrbitControls, touch events for rotation, WebXR for AR, canvas with WebGL, loading placeholder, LOD for performance, enviro…
- Светлая: ◐ Partial | Тёмная: ◐ Partial | Конверсия: ✓ Very High | Производит.: ❌ Poor (3D rendering) | Доступность: ⚠ Alt content needed
- Токены-подсказки: --canvas-bg: #F5F5F5, --hotspot-color: #3B82F6, --loading-spinner: primary, --rotation-speed: 0.5, --zoom-min: 0.5, --zoom-max: 2

### Vibrant & Block-based
- Ключевые слова: Bold, energetic, playful, block layout, geometric shapes, high color contrast, duotone, modern, energetic
- Когда применять: Startups, creative agencies, gaming, social media, youth-focused, entertainment, consumer
- Эффекты/анимация: Large sections (48px+ gaps), animated patterns, bold hover (color shift), scroll-snap, large type (32px+), 200-300ms
- CSS-признаки: display: flex/grid with large gaps (48px+), font-size: 32px+, background: animated patterns (CSS), color: neon/vibrant colors, animation: continuous …
- Светлая: ✓ Full | Тёмная: ✓ Full | Конверсия: ✓ High | Производит.: ⚡ Good | Доступность: ◐ Ensure WCAG
- Токены-подсказки: --block-gap: 48px, --typography-size: 32px+, --color-palette: 4-6 vibrant colors, --animation: continuous pattern, --contrast-ratio: 7:1+

---

## 3. Шрифтовые пары (Google Fonts)

Подключай через <link> в <head> (или @import в <style>). Заголовки — Heading-шрифт, основной текст — Body-шрифт.

### Modern Professional
- Заголовки: Poppins · Текст: Open Sans
- Настроение: modern, professional, clean, corporate, friendly, approachable
- Для: SaaS, corporate sites, business apps, startups, professional services
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Poppins'; body → font-family:'Open Sans'.

### Tech Startup
- Заголовки: Space Grotesk · Текст: DM Sans
- Настроение: tech, startup, modern, innovative, bold, futuristic
- Для: Tech companies, startups, SaaS, developer tools, AI products
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Space Grotesk'; body → font-family:'DM Sans'.

### Friendly SaaS
- Заголовки: Plus Jakarta Sans · Текст: Plus Jakarta Sans
- Настроение: friendly, modern, saas, clean, approachable, professional
- Для: SaaS products, web apps, dashboards, B2B, productivity tools
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Plus Jakarta Sans'; body → font-family:'Plus Jakarta Sans'.

### Premium Sans
- Заголовки: Satoshi · Текст: General Sans
- Настроение: premium, modern, clean, sophisticated, versatile, balanced
- Для: Premium brands, modern agencies, SaaS, portfolios, startups
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Satoshi'; body → font-family:'General Sans'.

### Geometric Modern
- Заголовки: Outfit · Текст: Work Sans
- Настроение: geometric, modern, clean, balanced, contemporary, versatile
- Для: General purpose, portfolios, agencies, modern brands, landing pages
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Work+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Outfit'; body → font-family:'Work Sans'.

### Bold Statement
- Заголовки: Bebas Neue · Текст: Source Sans 3
- Настроение: bold, impactful, strong, dramatic, modern, headlines
- Для: Marketing sites, portfolios, agencies, event pages, sports
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Bebas Neue'; body → font-family:'Source Sans 3'.

### Startup Bold
- Заголовки: Clash Display · Текст: Satoshi
- Настроение: startup, bold, modern, innovative, confident, dynamic
- Для: Startups, pitch decks, product launches, bold brands
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Rubik:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Clash Display'; body → font-family:'Satoshi'.

### Corporate Trust
- Заголовки: Lexend · Текст: Source Sans 3
- Настроение: corporate, trustworthy, accessible, readable, professional, clean
- Для: Enterprise, government, healthcare, finance, accessibility-focused
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Lexend'; body → font-family:'Source Sans 3'.

### Financial Trust
- Заголовки: IBM Plex Sans · Текст: IBM Plex Sans
- Настроение: financial, trustworthy, professional, corporate, banking, serious
- Для: Banks, finance, insurance, investment, fintech, enterprise
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'IBM Plex Sans'; body → font-family:'IBM Plex Sans'.

### Wellness Calm
- Заголовки: Lora · Текст: Raleway
- Настроение: calm, wellness, health, relaxing, natural, organic
- Для: Health apps, wellness, spa, meditation, yoga, organic brands
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&family=Raleway:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Lora'; body → font-family:'Raleway'.

### Luxury Serif
- Заголовки: Cormorant · Текст: Montserrat
- Настроение: luxury, high-end, fashion, elegant, refined, premium
- Для: Fashion brands, luxury e-commerce, jewelry, high-end services
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500;600;700&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Cormorant'; body → font-family:'Montserrat'.

### Classic Elegant
- Заголовки: Playfair Display · Текст: Inter
- Настроение: elegant, luxury, sophisticated, timeless, premium, editorial
- Для: Luxury brands, fashion, spa, beauty, editorial, magazines, high-end e-commerce
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Playfair Display'; body → font-family:'Inter'.

### Restaurant Menu
- Заголовки: Playfair Display SC · Текст: Karla
- Настроение: restaurant, menu, culinary, elegant, foodie, hospitality
- Для: Restaurants, cafes, food blogs, culinary, hospitality
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Karla:wght@300;400;500;600;700&family=Playfair+Display+SC:wght@400;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Playfair Display SC'; body → font-family:'Karla'.

### Real Estate Luxury
- Заголовки: Cinzel · Текст: Josefin Sans
- Настроение: real estate, luxury, elegant, sophisticated, property, premium
- Для: Real estate, luxury properties, architecture, interior design
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Josefin+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Cinzel'; body → font-family:'Josefin Sans'.

### Medical Clean
- Заголовки: Figtree · Текст: Noto Sans
- Настроение: medical, clean, accessible, professional, healthcare, trustworthy
- Для: Healthcare, medical clinics, pharma, health apps, accessibility
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700&family=Noto+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Figtree'; body → font-family:'Noto Sans'.

### Legal Professional
- Заголовки: EB Garamond · Текст: Lato
- Настроение: legal, professional, traditional, trustworthy, formal, authoritative
- Для: Law firms, legal services, contracts, formal documents, government
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=Lato:wght@300;400;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'EB Garamond'; body → font-family:'Lato'.

### Sports/Fitness
- Заголовки: Barlow Condensed · Текст: Barlow
- Настроение: sports, fitness, athletic, energetic, condensed, action
- Для: Sports, fitness, gyms, athletic brands, competition
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Barlow Condensed'; body → font-family:'Barlow'.

### E-commerce Clean
- Заголовки: Rubik · Текст: Nunito Sans
- Настроение: ecommerce, clean, shopping, product, retail, conversion
- Для: E-commerce, online stores, product pages, retail, shopping
- Подключение (в <head>):
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600;700&family=Rubik:wght@300;400;500;600;700&display=swap" rel="stylesheet">
- CSS: H1–H6 → font-family:'Rubik'; body → font-family:'Nunito Sans'.

---

## 4. UX и конверсия — обязательные правила (must-have)

Применяй ВСЕ правила High-severity. Для каждого: что делать (Do) и чего избегать (Don't).

- **[AI Interaction · High] Disclaimer**
  - Делай: Clearly label AI generated content
  - Не делай: Present AI as human
- **[Accessibility · High] Color Contrast**
  - Делай: Minimum 4.5:1 ratio for normal text
  - Не делай: Low contrast text
- **[Accessibility · High] Color Only**
  - Делай: Use icons/text in addition to color
  - Не делай: Red/green only for error/success
- **[Accessibility · High] Alt Text**
  - Делай: Descriptive alt text for meaningful images
  - Не делай: Empty or missing alt attributes
- **[Accessibility · High] ARIA Labels**
  - Делай: Add aria-label for icon-only buttons
  - Не делай: Icon buttons without labels
- **[Accessibility · High] Keyboard Navigation**
  - Делай: Tab order matches visual order
  - Не делай: Keyboard traps or illogical tab order
- **[Accessibility · High] Form Labels**
  - Делай: Use label with for attribute or wrap input
  - Не делай: Placeholder-only inputs
- **[Accessibility · High] Error Messages**
  - Делай: Use aria-live or role=alert for errors
  - Не делай: Visual-only error indication
- **[Accessibility · High] Motion Sensitivity**
  - Делай: Respect prefers-reduced-motion
  - Не делай: Force scroll effects
- **[Animation · High] Excessive Motion**
  - Делай: Animate 1-2 key elements per view maximum
  - Не делай: Animate everything that moves
- **[Animation · High] Reduced Motion**
  - Делай: Check prefers-reduced-motion media query
  - Не делай: Ignore accessibility motion settings
- **[Animation · High] Loading States**
  - Делай: Use skeleton screens or spinners
  - Не делай: Leave UI frozen with no feedback
- **[Animation · High] Hover vs Tap**
  - Делай: Use click/tap for primary interactions
  - Не делай: Rely only on hover for important actions
- **[Feedback · High] Loading Indicators**
  - Делай: Show spinner/skeleton for operations > 300ms
  - Не делай: No feedback during loading
- **[Forms · High] Input Labels**
  - Делай: Always show label above or beside input
  - Не делай: Placeholder as only label
- **[Forms · High] Submit Feedback**
  - Делай: Show loading then success/error state
  - Не делай: No feedback after submit
- **[Interaction · High] Focus States**
  - Делай: Use visible focus rings on interactive elements
  - Не делай: Remove focus outline without replacement
- **[Interaction · High] Loading Buttons**
  - Делай: Disable button and show loading state
  - Не делай: Allow multiple clicks during processing
- **[Interaction · High] Error Feedback**
  - Делай: Show clear error messages near problem
  - Не делай: Silent failures with no feedback
- **[Interaction · High] Confirmation Dialogs**
  - Делай: Confirm before delete/irreversible actions
  - Не делай: Delete without confirmation
- **[Layout · High] Z-Index Management**
  - Делай: Define z-index scale system (10 20 30 50)
  - Не делай: Use arbitrary large z-index values
- **[Layout · High] Content Jumping**
  - Делай: Reserve space for async content
  - Не делай: Let images/content push layout around
- **[Navigation · High] Smooth Scroll**
  - Делай: Use scroll-behavior: smooth on html element
  - Не делай: Jump directly without transition
- **[Navigation · High] Back Button**
  - Делай: Preserve navigation history properly
  - Не делай: Break browser/app back button behavior
- **[Performance · High] Image Optimization**
  - Делай: Use appropriate size and format (WebP)
  - Не делай: Unoptimized full-size images
- **[Responsive · High] Touch Friendly**
  - Делай: Increase touch targets on mobile
  - Не делай: Same tiny buttons on mobile
- **[Responsive · High] Readable Font Size**
  - Делай: Minimum 16px body text on mobile
  - Не делай: Tiny text on mobile
- **[Responsive · High] Viewport Meta**
  - Делай: Use width=device-width initial-scale=1
  - Не делай: Missing or incorrect viewport
- **[Responsive · High] Horizontal Scroll**
  - Делай: Ensure content fits viewport width
  - Не делай: Content wider than viewport
- **[Spatial UI · High] Gaze Hover**
  - Делай: Scale/highlight element on look
  - Не делай: Static element until pinch
- **[Touch · High] Touch Target Size**
  - Делай: Minimum 44x44px touch targets
  - Не делай: Tiny clickable areas
- **[Typography · High] Contrast Readability**
  - Делай: Use darker text on light backgrounds
  - Не делай: Gray text on gray background
- **[Layout · Medium] Overflow Hidden**
  - Делай: Test all content fits within containers
  - Не делай: Blindly apply overflow-hidden
- **[Layout · Medium] Fixed Positioning**
  - Делай: Account for safe areas and other fixed elements
  - Не делай: Stack multiple fixed elements carelessly
- **[Layout · Medium] Stacking Context**
  - Делай: Understand what creates new stacking context
  - Не делай: Expect z-index to work across contexts
- **[Layout · Medium] Viewport Units**
  - Делай: Use dvh or account for mobile browser chrome
  - Не делай: Use 100vh for full-screen mobile layouts
- **[Layout · Medium] Container Width**
  - Делай: Limit max-width for text content (65-75ch)
  - Не делай: Let text span full viewport width
- **[Navigation · Medium] Sticky Navigation**
  - Делай: Add padding-top to body equal to nav height
  - Не делай: Let nav overlap first section content
- **[Navigation · Medium] Active State**
  - Делай: Highlight active nav item with color/underline
  - Не делай: No visual feedback on current location
- **[Navigation · Medium] Deep Linking**
  - Делай: Update URL on state/view changes
  - Не делай: Static URLs for dynamic content
- **[Performance · Medium] Lazy Loading**
  - Делай: Lazy load below-fold images and content
  - Не делай: Load everything upfront
- **[Touch · Medium] Touch Spacing**
  - Делай: Minimum 8px gap between touch targets
  - Не делай: Tightly packed clickable elements
- **[Touch · Medium] Gesture Conflicts**
  - Делай: Avoid horizontal swipe on main content
  - Не делай: Override system gestures
- **[Touch · Medium] Tap Delay**
  - Делай: Use touch-action CSS or fastclick
  - Не делай: Default mobile tap handling

---

## 5. Быстрый выбор: ниша → стиль + палитра + шрифты

| Ниша / тип бизнеса | Стиль | Палитра (раздел 1) | Шрифты (раздел 3) |
|---|---|---|---|
| SaaS / IT-сервис / стартап | Hero-Centric / Conversion-Optimized | SaaS (General) | Modern Professional / Tech Startup |
| B2B услуги / агентство | Trust & Authority | B2B Service / Marketing Agency | Corporate Trust / Premium Sans |
| Интернет-магазин / товары | Vibrant & Block-based / Bento Grids | E-commerce | E-commerce Clean / Geometric Modern |
| Салон красоты / спа / барбершоп | Soft UI Evolution / Minimalism | Beauty/Spa/Wellness Service | Wellness Calm / Classic Elegant |
| Ресторан / кафе / кофейня | Editorial Grid / Glassmorphism | Restaurant/Food Service / Bakery/Cafe | Restaurant Menu / Classic Elegant |
| Фитнес / спортзал | Exaggerated Minimalism / Dark Mode | Fitness/Gym App | Sports/Fitness / Bold Statement |
| Недвижимость / застройщик | Minimalism & Swiss / Trust & Authority | Real Estate/Property | Real Estate Luxury / Modern Professional |
| Медцентр / клиника / стоматология | Minimalism & Swiss / Flat Design | Medical Clinic / Dental Practice | Medical Clean / Corporate Trust |
| Онлайн-курсы / репетитор / школа | Hero-Centric / Vibrant & Block-based | Online Course/E-learning / Educational App | Friendly SaaS / Geometric Modern |
| Юридические / бухгалтерия | Trust & Authority / Minimalism | Legal Services | Legal Professional / Corporate Trust |
| Стройка / ремонт / мастер на час | Flat Design / Conversion-Optimized | Construction/Architecture / Home Services (Plumber/Electrician) | Bold Statement / Corporate Trust |
| Автосалон / автосервис | Dark Mode (OLED) / 3D Product Preview | Automotive/Car Dealership | Startup Bold / Modern Professional |
| Туризм / отель / экскурсии | Glassmorphism / Editorial Grid | Travel/Tourism Agency / Hotel/Hospitality | Classic Elegant / Premium Sans |
| Премиум / luxury бренд | Exaggerated Minimalism / Editorial Grid | Luxury/Premium Brand | Luxury Serif / Classic Elegant |
| Финтех / крипта / банк | Dark Mode (OLED) / Glassmorphism | Fintech/Crypto / Banking/Traditional Finance | Financial Trust / Tech Startup |
| Свадьбы / ивенты | Editorial Grid / Soft UI | Wedding/Event Planning | Classic Elegant / Luxury Serif |
| Детский центр / садик | Claymorphism / Vibrant & Block-based | Childcare/Daycare | Friendly SaaS / Bold Statement |
| Фотограф / творческая студия | Editorial Grid / Minimalism | Photography Studio / Creative Agency | Premium Sans / Classic Elegant |
| Коворкинг / аренда офисов | Bento Grids / Minimalism | Coworking Space | Geometric Modern / Modern Professional |

---

## Чек-лист перед выдачей HTML
- [ ] Палитра вставлена в :root, текст использует on-* токены (контраст 4.5:1+).
- [ ] Стиль выдержан единообразно во всех секциях (не смешивать случайно).
- [ ] Подключены оба шрифта пары; заголовки и текст используют их.
- [ ] CTA крупные, контрастные (accent), с тенью; одна главная цель.
- [ ] Тач-цели ≥44×44px, отступы между кликабельными ≥8px.
- [ ] Mobile-first: проверено до 320px, без горизонтального скролла.
- [ ] Иконки — inline SVG, НЕ эмодзи.
- [ ] Все High-severity UX-правила соблюдены.
