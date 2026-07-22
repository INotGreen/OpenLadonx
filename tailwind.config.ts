import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./src/features/terminal/**/*.{ts,tsx}",
    "./src/components/ui/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        fg: "var(--text-stronger)",
        "fg-strong": "var(--text-strong)",
        "fg-muted": "var(--text-muted)",
        "fg-subtle": "var(--text-subtle)",
        "fg-faint": "var(--text-faint)",
        card: "var(--surface-card)",
        "card-strong": "var(--surface-card-strong)",
        "card-muted": "var(--surface-card-muted)",
        control: "var(--surface-control)",
        "control-hover": "var(--surface-control-hover)",
        hover: "var(--surface-hover)",
        active: "var(--surface-active)",
        panel: "var(--surface-debug)",
        messages: "var(--surface-messages)",
        border: "var(--border-subtle)",
        "border-strong": "var(--border-strong)",
        ring: "var(--accent, var(--text-muted))",
        destructive: "var(--danger, #ef4444)",
      },
      borderRadius: {
        lg: "10px",
        md: "8px",
        sm: "6px",
      },
      fontFamily: {
        mono: "var(--code-font-family, ui-monospace, Menlo, Monaco, monospace)",
        sans: "var(--font-family-base, system-ui, sans-serif)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "slide-up": "slide-up 180ms ease-out",
      },
    },
  },
  plugins: [animate],
};

export default config;
