/**
 * Fobs (Monad) — dark terminal design system.
 *
 * preflight is OFF: the global reset lives hand-authored in app/globals.css
 * (box-sizing, element normalisation) so Tailwind utilities layer cleanly on
 * top. Colors below reference CSS custom properties defined on :root in
 * globals.css, so re-pointing a token there re-themes everything.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        raised: "var(--raised)",
        border: "var(--border)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        primary: "var(--primary)",
        up: "var(--up)",
        down: "var(--down)",
        warn: "var(--warn)"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px"
      }
    }
  },
  plugins: []
};

export default config;
