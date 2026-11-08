/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--accent-ink) / <alpha-value>)",
        bubble: "rgb(var(--bubble) / <alpha-value>)",
        online: "rgb(var(--online) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", '"Segoe UI"', "-apple-system", "system-ui", "sans-serif"],
        display: ['"Bricolage Grotesque Variable"', '"Inter Variable"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
      borderRadius: { bubble: "20px" },
      transitionTimingFunction: { soft: "cubic-bezier(.2,.8,.2,1)" },
      boxShadow: {
        soft: "0 1px 2px rgb(0 0 0 / .04), 0 4px 16px rgb(0 0 0 / .06)",
        pop: "0 8px 40px rgb(0 0 0 / .18)",
      },
    },
  },
  plugins: [],
};
