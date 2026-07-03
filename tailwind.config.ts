import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#05070d",
        panel: "#0a0f1c",
        line: "#12203a",
        arc: "#6fe3ff",       // JARVIS cyan
        arcdim: "#2b7ea8",
        signal: "#38bdf8",
        danger: "#ff4d5e",
        caution: "#ffb454",
        profit: "#4ade80",
      },
      fontFamily: {
        display: ["Rajdhani", "sans-serif"],
        mono: ["Share Tech Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        arc: "0 0 12px rgba(111,227,255,0.25), inset 0 0 20px rgba(111,227,255,0.04)",
        dangerGlow: "0 0 12px rgba(255,77,94,0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
