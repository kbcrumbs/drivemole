/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        app: token("app"),
        panel: token("panel"),
        raised: token("raised"),
        line: token("line"),
        field: token("field"),
        fg: token("fg"),
        muted: token("muted"),
        subtle: token("subtle"),
      },
    },
  },
  plugins: [],
}
