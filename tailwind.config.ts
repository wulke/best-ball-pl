import type { Config } from 'tailwindcss';

type ColorOpacity = { opacityValue?: string };

// Fixed position badge colors — not themed, support opacity modifiers (e.g. bg-pos-g/10)
function positionColor(r: number, g: number, b: number) {
  return ({ opacityValue }: ColorOpacity) =>
    opacityValue !== undefined
      ? `rgb(${r} ${g} ${b} / ${opacityValue})`
      : `rgb(${r} ${g} ${b})`;
}

// Themed colors backed by CSS variables — hex for full opacity, RGB var for opacity modifiers
function themeColor(rgbVar: string, hexVar: string) {
  return ({ opacityValue }: ColorOpacity) =>
    opacityValue !== undefined
      ? `rgb(var(${rgbVar}) / ${opacityValue})`
      : `var(${hexVar})`;
}

export default {
  content: ['./src/ui/index.html', './src/ui/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // IBM Plex Sans Condensed — use for headings, stat callouts, projections
        condensed: ['"IBM Plex Sans Condensed"', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        // Page background
        app: 'var(--color-bg)',

        // Surface layers
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
          hover: 'var(--color-surface-hover)',
        },

        // Text hierarchy
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        muted: 'var(--color-text-muted)',

        // Brand accent — supports opacity modifiers (bg-accent/10, border-accent/30)
        accent: {
          DEFAULT: themeColor('--color-accent-rgb', '--color-accent'),
          hover: 'var(--color-accent-hover)',
          fg: 'var(--color-accent-fg)',
        },

        // Semantic data colors — support opacity modifiers for status badges
        positive: themeColor('--color-positive-rgb', '--color-positive'),
        negative: themeColor('--color-negative-rgb', '--color-negative'),
        info:     themeColor('--color-info-rgb',     '--color-info'),

        // Position badge colors — fixed across all themes, support opacity modifiers
        'pos-g':  positionColor(252, 211,  77),  // amber-300
        'pos-d':  positionColor( 96, 165, 250),  // blue-400
        'pos-md': positionColor( 52, 211, 153),  // emerald-400
        'pos-fw': positionColor(167, 139, 250),  // violet-400
      },

      // Border semantic tokens — separate from colors to avoid polluting text/bg namespaces
      borderColor: {
        default: 'var(--color-border)',
        strong: 'var(--color-border-strong)',
      },

      // Page-level background gradient wired to the active theme
      backgroundImage: {
        'app-gradient': 'var(--bg-gradient)',
      },
    },
  },
  plugins: [],
} satisfies Config;
