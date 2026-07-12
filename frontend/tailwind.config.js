/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: process.env.DARK_MODE ? process.env.DARK_MODE : 'class',
  content: [
    './app/**/*.{html,js,jsx,ts,tsx,mdx}',
    './components/**/*.{html,js,jsx,ts,tsx,mdx}',
    './utils/**/*.{html,js,jsx,ts,tsx,mdx}',
    './*.{html,js,jsx,ts,tsx,mdx}',
    './src/**/*.{html,js,jsx,ts,tsx,mdx}',
  ],
  presets: [require('nativewind/preset')],
  important: 'html',
  safelist: [
    {
      pattern:
        /(bg|border|text|stroke|fill)-(primary|secondary|tertiary|error|success|warning|info|typography|outline|background|indicator)-(0|50|100|200|300|400|500|600|700|800|900|950|white|gray|black|error|warning|muted|success|info|light|dark|primary)/,
    },
  ],
  theme: {
    extend: {
      colors: {
        /* ────────────────────────────────────────────────────────────────
         * Inflo design tokens (task 6.7) — traceable to docs/design-tokens.md
         * Part 2. These sit ALONGSIDE gluestack's own ramps below (no name
         * collisions). Use these for Inflo-owned screens/components.
         * ──────────────────────────────────────────────────────────────── */
        // Surfaces
        app: '#FBFAF6', // bg.app — warm near-white app base
        dashboard: '#FAFAF8', // bg.dashboard
        chatCanvas: '#EBE7E0', // bg.chatCanvas — deeper deal-room canvas
        surface: {
          card: '#FFFFFF', // surface.card
          recess: '#EFEAE2', // surface.recess — recessed track under white-on-white lifts
        },
        hairline: {
          DEFAULT: '#EAE8E2', // border.hairline
          card: '#EFEDE8', // border.cardHairline — the "whisper" hairline on cards
        },
        avatar: {
          DEFAULT: '#E8E5DF', // avatar.bg — greige
          ring: 'rgba(28,27,24,0.09)', // avatar.ring
        },
        // Text (ink = primary; -2 secondary; -3 tertiary/icons only)
        ink: {
          DEFAULT: '#1C1B18', // text.primary — also primary button fill
          2: '#5E574E', // text.secondary — passes AA
          3: '#847F78', // text.tertiary — large text & icons only
        },
        // Status (on top only — never a chart's base)
        status: {
          good: '#7DB02E', // status.good.dot
          'good-label': '#4F7A1E', // status.good.label (deep green — legible as text)
          'good-tint': '#ECF2D6', // status.good.tint
          neutral: '#847F78', // status.neutral
          critical: '#C0392B', // status.critical
          'critical-tint': '#FBF3F1', // status.critical.tint
        },
        // Neutral / cane scale (warmth, chart context)
        cane: {
          1: '#EFEBE3',
          2: '#DFDACF',
          3: '#D2CFC6',
          4: '#B3AC9D',
          5: '#8E8676',
        },
        // Chart emphasis — single teal family (never all-blue; max 3, rest fade to glass)
        chart: {
          e1: '#0095A8', // deep teal
          'e1-top': '#1CACBE', // bar top-light
          e2: '#63B0BE', // mid
          'e2-top': '#7DC1CC',
          e3: '#A9CEDB', // light steel
          'e3-top': '#BFDBE5',
          grid: '#F0EEE9', // chart.grid
          axis: '#847F78', // chart.axisLabel
        },
        primary: {
          0: 'rgb(var(--color-primary-0)/<alpha-value>)',
          50: 'rgb(var(--color-primary-50)/<alpha-value>)',
          100: 'rgb(var(--color-primary-100)/<alpha-value>)',
          200: 'rgb(var(--color-primary-200)/<alpha-value>)',
          300: 'rgb(var(--color-primary-300)/<alpha-value>)',
          400: 'rgb(var(--color-primary-400)/<alpha-value>)',
          500: 'rgb(var(--color-primary-500)/<alpha-value>)',
          600: 'rgb(var(--color-primary-600)/<alpha-value>)',
          700: 'rgb(var(--color-primary-700)/<alpha-value>)',
          800: 'rgb(var(--color-primary-800)/<alpha-value>)',
          900: 'rgb(var(--color-primary-900)/<alpha-value>)',
          950: 'rgb(var(--color-primary-950)/<alpha-value>)',
        },
        secondary: {
          0: 'rgb(var(--color-secondary-0)/<alpha-value>)',
          50: 'rgb(var(--color-secondary-50)/<alpha-value>)',
          100: 'rgb(var(--color-secondary-100)/<alpha-value>)',
          200: 'rgb(var(--color-secondary-200)/<alpha-value>)',
          300: 'rgb(var(--color-secondary-300)/<alpha-value>)',
          400: 'rgb(var(--color-secondary-400)/<alpha-value>)',
          500: 'rgb(var(--color-secondary-500)/<alpha-value>)',
          600: 'rgb(var(--color-secondary-600)/<alpha-value>)',
          700: 'rgb(var(--color-secondary-700)/<alpha-value>)',
          800: 'rgb(var(--color-secondary-800)/<alpha-value>)',
          900: 'rgb(var(--color-secondary-900)/<alpha-value>)',
          950: 'rgb(var(--color-secondary-950)/<alpha-value>)',
        },
        tertiary: {
          50: 'rgb(var(--color-tertiary-50)/<alpha-value>)',
          100: 'rgb(var(--color-tertiary-100)/<alpha-value>)',
          200: 'rgb(var(--color-tertiary-200)/<alpha-value>)',
          300: 'rgb(var(--color-tertiary-300)/<alpha-value>)',
          400: 'rgb(var(--color-tertiary-400)/<alpha-value>)',
          500: 'rgb(var(--color-tertiary-500)/<alpha-value>)',
          600: 'rgb(var(--color-tertiary-600)/<alpha-value>)',
          700: 'rgb(var(--color-tertiary-700)/<alpha-value>)',
          800: 'rgb(var(--color-tertiary-800)/<alpha-value>)',
          900: 'rgb(var(--color-tertiary-900)/<alpha-value>)',
          950: 'rgb(var(--color-tertiary-950)/<alpha-value>)',
        },
        error: {
          0: 'rgb(var(--color-error-0)/<alpha-value>)',
          50: 'rgb(var(--color-error-50)/<alpha-value>)',
          100: 'rgb(var(--color-error-100)/<alpha-value>)',
          200: 'rgb(var(--color-error-200)/<alpha-value>)',
          300: 'rgb(var(--color-error-300)/<alpha-value>)',
          400: 'rgb(var(--color-error-400)/<alpha-value>)',
          500: 'rgb(var(--color-error-500)/<alpha-value>)',
          600: 'rgb(var(--color-error-600)/<alpha-value>)',
          700: 'rgb(var(--color-error-700)/<alpha-value>)',
          800: 'rgb(var(--color-error-800)/<alpha-value>)',
          900: 'rgb(var(--color-error-900)/<alpha-value>)',
          950: 'rgb(var(--color-error-950)/<alpha-value>)',
        },
        success: {
          0: 'rgb(var(--color-success-0)/<alpha-value>)',
          50: 'rgb(var(--color-success-50)/<alpha-value>)',
          100: 'rgb(var(--color-success-100)/<alpha-value>)',
          200: 'rgb(var(--color-success-200)/<alpha-value>)',
          300: 'rgb(var(--color-success-300)/<alpha-value>)',
          400: 'rgb(var(--color-success-400)/<alpha-value>)',
          500: 'rgb(var(--color-success-500)/<alpha-value>)',
          600: 'rgb(var(--color-success-600)/<alpha-value>)',
          700: 'rgb(var(--color-success-700)/<alpha-value>)',
          800: 'rgb(var(--color-success-800)/<alpha-value>)',
          900: 'rgb(var(--color-success-900)/<alpha-value>)',
          950: 'rgb(var(--color-success-950)/<alpha-value>)',
        },
        warning: {
          0: 'rgb(var(--color-warning-0)/<alpha-value>)',
          50: 'rgb(var(--color-warning-50)/<alpha-value>)',
          100: 'rgb(var(--color-warning-100)/<alpha-value>)',
          200: 'rgb(var(--color-warning-200)/<alpha-value>)',
          300: 'rgb(var(--color-warning-300)/<alpha-value>)',
          400: 'rgb(var(--color-warning-400)/<alpha-value>)',
          500: 'rgb(var(--color-warning-500)/<alpha-value>)',
          600: 'rgb(var(--color-warning-600)/<alpha-value>)',
          700: 'rgb(var(--color-warning-700)/<alpha-value>)',
          800: 'rgb(var(--color-warning-800)/<alpha-value>)',
          900: 'rgb(var(--color-warning-900)/<alpha-value>)',
          950: 'rgb(var(--color-warning-950)/<alpha-value>)',
        },
        info: {
          0: 'rgb(var(--color-info-0)/<alpha-value>)',
          50: 'rgb(var(--color-info-50)/<alpha-value>)',
          100: 'rgb(var(--color-info-100)/<alpha-value>)',
          200: 'rgb(var(--color-info-200)/<alpha-value>)',
          300: 'rgb(var(--color-info-300)/<alpha-value>)',
          400: 'rgb(var(--color-info-400)/<alpha-value>)',
          500: 'rgb(var(--color-info-500)/<alpha-value>)',
          600: 'rgb(var(--color-info-600)/<alpha-value>)',
          700: 'rgb(var(--color-info-700)/<alpha-value>)',
          800: 'rgb(var(--color-info-800)/<alpha-value>)',
          900: 'rgb(var(--color-info-900)/<alpha-value>)',
          950: 'rgb(var(--color-info-950)/<alpha-value>)',
        },
        typography: {
          0: 'rgb(var(--color-typography-0)/<alpha-value>)',
          50: 'rgb(var(--color-typography-50)/<alpha-value>)',
          100: 'rgb(var(--color-typography-100)/<alpha-value>)',
          200: 'rgb(var(--color-typography-200)/<alpha-value>)',
          300: 'rgb(var(--color-typography-300)/<alpha-value>)',
          400: 'rgb(var(--color-typography-400)/<alpha-value>)',
          500: 'rgb(var(--color-typography-500)/<alpha-value>)',
          600: 'rgb(var(--color-typography-600)/<alpha-value>)',
          700: 'rgb(var(--color-typography-700)/<alpha-value>)',
          800: 'rgb(var(--color-typography-800)/<alpha-value>)',
          900: 'rgb(var(--color-typography-900)/<alpha-value>)',
          950: 'rgb(var(--color-typography-950)/<alpha-value>)',
          white: '#FFFFFF',
          gray: '#D4D4D4',
          black: '#181718',
        },
        outline: {
          0: 'rgb(var(--color-outline-0)/<alpha-value>)',
          50: 'rgb(var(--color-outline-50)/<alpha-value>)',
          100: 'rgb(var(--color-outline-100)/<alpha-value>)',
          200: 'rgb(var(--color-outline-200)/<alpha-value>)',
          300: 'rgb(var(--color-outline-300)/<alpha-value>)',
          400: 'rgb(var(--color-outline-400)/<alpha-value>)',
          500: 'rgb(var(--color-outline-500)/<alpha-value>)',
          600: 'rgb(var(--color-outline-600)/<alpha-value>)',
          700: 'rgb(var(--color-outline-700)/<alpha-value>)',
          800: 'rgb(var(--color-outline-800)/<alpha-value>)',
          900: 'rgb(var(--color-outline-900)/<alpha-value>)',
          950: 'rgb(var(--color-outline-950)/<alpha-value>)',
        },
        background: {
          0: 'rgb(var(--color-background-0)/<alpha-value>)',
          50: 'rgb(var(--color-background-50)/<alpha-value>)',
          100: 'rgb(var(--color-background-100)/<alpha-value>)',
          200: 'rgb(var(--color-background-200)/<alpha-value>)',
          300: 'rgb(var(--color-background-300)/<alpha-value>)',
          400: 'rgb(var(--color-background-400)/<alpha-value>)',
          500: 'rgb(var(--color-background-500)/<alpha-value>)',
          600: 'rgb(var(--color-background-600)/<alpha-value>)',
          700: 'rgb(var(--color-background-700)/<alpha-value>)',
          800: 'rgb(var(--color-background-800)/<alpha-value>)',
          900: 'rgb(var(--color-background-900)/<alpha-value>)',
          950: 'rgb(var(--color-background-950)/<alpha-value>)',
          error: 'rgb(var(--color-background-error)/<alpha-value>)',
          warning: 'rgb(var(--color-background-warning)/<alpha-value>)',
          muted: 'rgb(var(--color-background-muted)/<alpha-value>)',
          success: 'rgb(var(--color-background-success)/<alpha-value>)',
          info: 'rgb(var(--color-background-info)/<alpha-value>)',
          light: '#FBFBFB',
          dark: '#181719',
        },
        indicator: {
          primary: 'rgb(var(--color-indicator-primary)/<alpha-value>)',
          info: 'rgb(var(--color-indicator-info)/<alpha-value>)',
          error: 'rgb(var(--color-indicator-error)/<alpha-value>)',
        },
      },
      // Inflo radii (task 6.7) — circular corners, NOT squircle. `rounded-card`,
      // `rounded-button`, `rounded-input`, `rounded-panel`, `rounded-pill`.
      borderRadius: {
        card: '14px',
        panel: '12px',
        button: '16px',
        input: '16px',
        pill: '9999px',
      },
      // Inflo spacing note: Tailwind's DEFAULT scale already IS our 4px grid
      // (1=4 · 2=8 · 3=12 · 4=16 · 5=20 · 6=24 · 8=32 · 10=40 · 12=48), matching
      // docs/design-tokens.md exactly — so we intentionally keep the defaults.
      // Defaults: screen/card padding = p-4, stack gap = gap-3, section gap = gap-5.
      fontFamily: {
        heading: undefined,
        body: undefined,
        mono: undefined,
        // Inflo — Geist (loaded in _layout.tsx). RN selects weight by the font
        // FILE (family), not `fontWeight`, so each weight is its own family.
        geist: ['Geist_400Regular'],
        'geist-medium': ['Geist_500Medium'],
        'geist-semibold': ['Geist_600SemiBold'],
        'geist-bold': ['Geist_700Bold'],
        'geist-mono': ['GeistMono_400Regular'],
        jakarta: ['var(--font-plus-jakarta-sans)'],
        roboto: ['var(--font-roboto)'],
        code: ['var(--font-source-code-pro)'],
        inter: ['var(--font-inter)'],
        'space-mono': ['var(--font-space-mono)'],
      },
      fontWeight: {
        extrablack: '950',
      },
      fontSize: {
        '2xs': '10px',
        /* Inflo — the 6 type roles (docs/design-tokens.md §Typography).
         * size + [lineHeight, letterSpacing]. Weight comes from the matching
         * font-geist-* family class (see fontFamily above). */
        display: ['26px', { lineHeight: '29px', letterSpacing: '-0.26px' }], // 26/700
        title: ['20px', { lineHeight: '26px', letterSpacing: '-0.2px' }], // 20/600
        subtitle: ['17px', { lineHeight: '23px', letterSpacing: '-0.17px' }], // 17/600
        body: ['15px', { lineHeight: '22px', letterSpacing: '0px' }], // 15/400
        secondary: ['13px', { lineHeight: '18px', letterSpacing: '0px' }], // 13/400
        micro: ['11px', { lineHeight: '15px', letterSpacing: '0.22px' }], // 11/500, sentence case
      },
      boxShadow: {
        /* Inflo elevation — warm-tinted (from ink), never cold grey.
         * (docs/design-tokens.md §Elevation + §Material signatures.)
         * L0 = hairline border only (no shadow) → use `border border-hairline`.
         * Multi-layer + inset render fully on WEB; NativeWind approximates to a
         * single shadow on native — acceptable. */
        l1: '0 1px 2px rgba(28,27,24,.05), 0 5px 14px rgba(28,27,24,.07)',
        l2: '0 2px 6px rgba(28,27,24,.06), 0 14px 34px rgba(28,27,24,.11)',
        liftIn: '0 1px 2px rgba(28,27,24,.05), 0 8px 18px rgba(28,27,24,.09)', // subsection lift
        recessInset: 'inset 0 1px 2px rgba(28,27,24,.05)', // recessed track
        // Pillow-glass — NAV-ACTIVE ONLY (gradient + lift is the reserved signature)
        pillowGlass:
          'inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(28,27,24,.05), 0 5px 12px rgba(28,27,24,.09)',
        // Glass FLUSH top-highlight — shared material (secondary button, chat bubble, bars); no outer lift
        glassInset: 'inset 0 1px 0 rgba(255,255,255,.9)',
        'hard-1': '-2px 2px 8px 0px rgba(38, 38, 38, 0.20)',
        'hard-2': '0px 3px 10px 0px rgba(38, 38, 38, 0.20)',
        'hard-3': '2px 2px 8px 0px rgba(38, 38, 38, 0.20)',
        'hard-4': '0px -3px 10px 0px rgba(38, 38, 38, 0.20)',
        'hard-5': '0px 2px 10px 0px rgba(38, 38, 38, 0.10)',
        'soft-1': '0px 0px 10px rgba(38, 38, 38, 0.1)',
        'soft-2': '0px 0px 20px rgba(38, 38, 38, 0.2)',
        'soft-3': '0px 0px 30px rgba(38, 38, 38, 0.1)',
        'soft-4': '0px 0px 40px rgba(38, 38, 38, 0.1)',
      },
    },
  },
};
