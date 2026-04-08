import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        bg: {
          primary: "#FAFAF8",
          secondary: "#F5F3EF",
        },
        surface: "#FFFFFF",
        border: {
          DEFAULT: "#E8E5E0",
          subtle: "#F0EDE8",
        },
        text: {
          primary: "#1A1A1A",
          secondary: "#6B6B6B",
          tertiary: "#9B9B9B",
        },
        accent: {
          DEFAULT: "#354DAA",
          hover: "#2A3F8E",
          subtle: "#EEF1FB",
          text: "#1E2F6B",
        },
        info: {
          DEFAULT: "#5B8DEF",
          subtle: "#EFF4FE",
        },
        success: {
          DEFAULT: "#3D9A5F",
          subtle: "#EDFBF2",
        },
        warning: {
          DEFAULT: "#D4940A",
          subtle: "#FEF9E8",
        },
        error: {
          DEFAULT: "#DC4A3F",
          subtle: "#FEF0EF",
        },
        sidebar: {
          bg: "#191919",
          text: "#EBEBEB",
          muted: "#8F8F8F",
          active: "rgba(255,255,255,0.08)",
          hover: "rgba(255,255,255,0.04)",
          accent: "#354DAA",
        },
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.04)",
        md: "0 2px 8px rgba(0,0,0,0.06)",
        lg: "0 4px 16px rgba(0,0,0,0.08)",
        xl: "0 8px 32px rgba(0,0,0,0.1)",
      },
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-subtle": "pulse-subtle 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
