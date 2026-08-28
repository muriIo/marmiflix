import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        char: {
          950: "#120D0A",
          900: "#19130F",
          800: "#231C17",
          700: "#332921",
          600: "#4A3B2F",
        },
        ember: {
          400: "#FF9A47",
          500: "#FF7A1A",
          600: "#E4610A",
        },
        amber: {
          300: "#FFD98A",
          400: "#FFC155",
          500: "#FFB020",
        },
        cream: {
          100: "#FFF7ED",
          300: "#E9D9C7",
          500: "#B8AA9C",
        },
        alarm: {
          500: "#FF4141",
          600: "#E22626",
        },
      },
      fontFamily: {
        display: ["var(--font-sora)", "system-ui", "sans-serif"],
        mono: ["var(--font-space-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 60px -12px rgba(255, 122, 26, 0.55)",
      },
      keyframes: {
        "pulse-urgent": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "trail-dash": {
          to: { "stroke-dashoffset": "-20" },
        },
        "dot-breathe": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.35)" },
        },
      },
      animation: {
        "pulse-urgent": "pulse-urgent 0.8s ease-in-out infinite",
        "trail-dash": "trail-dash 1.4s linear infinite",
        "trail-dash-fast": "trail-dash 0.5s linear infinite",
        "dot-breathe": "dot-breathe 1.8s ease-in-out infinite",
        "dot-breathe-fast": "dot-breathe 0.7s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
