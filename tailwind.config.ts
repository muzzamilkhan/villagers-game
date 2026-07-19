import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        parchment: "#f2e6cf",
        "parchment-dark": "#e6d5b0",
        ink: "#2b2016",
        wood: "#3b2a1a",
        "wood-light": "#5a4128",
        blood: "#7a1f1f",
        forest: "#3d5a3d",
        gold: "#a67c2e",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
