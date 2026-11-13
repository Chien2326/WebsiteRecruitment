/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#D9232D', light: '#FDECEE', dark: '#A81821' },
        navy: { DEFAULT: '#1F3A5F', light: '#E8EEF6' },
        cream: '#FFF9F5',
      },
      // Noto Sans JP is the primary face (see CLAUDE.md). The per-locale stack
      // (Myanmar / Devanagari / Bengali) is applied in globals.css via [lang].
      fontFamily: {
        sans: [
          '"Noto Sans JP"',
          '"Hiragino Kaku Gothic ProN"',
          '"Hiragino Kaku Gothic Pro"',
          'Meiryo',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
