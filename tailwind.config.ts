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
        "bowl-bounce": {
          "0%, 100%": { transform: "scale(1, 1) translateY(0)" },
          "50%": { transform: "scale(1.03, 0.96) translateY(-3px)" },
        },
        "bowl-shake": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(-3deg)" },
          "75%": { transform: "rotate(3deg)" },
        },
        "curl-rise": {
          "0%": { opacity: "0", transform: "translate(0px, 4px) scale(0.85)" },
          "18%": { opacity: "0.9", transform: "translate(-3px, -6px) scale(0.95)" },
          "45%": { opacity: "0.75", transform: "translate(3px, -18px) scale(1.05)" },
          "75%": { opacity: "0.3", transform: "translate(-3px, -30px) scale(1.15)" },
          "100%": { opacity: "0", transform: "translate(2px, -40px) scale(1.2)" },
        },
        twinkle: {
          "0%, 100%": { opacity: "0", transform: "scale(0.4)" },
          "50%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "pulse-urgent": "pulse-urgent 0.8s ease-in-out infinite",
        "bowl-bounce": "bowl-bounce 2.4s cubic-bezier(0.34,1.56,0.64,1) infinite",
        "bowl-shake": "bowl-shake 0.35s ease-in-out infinite",
        "curl-rise": "curl-rise 3.4s ease-in-out infinite",
        "curl-rise-urgent": "curl-rise 1.4s ease-in-out infinite",
        twinkle: "twinkle 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
