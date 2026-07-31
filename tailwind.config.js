/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/supervision/**/*.{ts,tsx}',
    './components/supervision/**/*.{ts,tsx}',
  ],
  // Le reste de l'app (passager / chauffeur / admin) utilise déjà son propre
  // CSS global. On désactive le "preflight" de Tailwind pour que ce nouveau
  // module cohabite proprement sans réinitialiser les styles existants.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        copper: {
          DEFAULT: '#B08D57',
          light: '#e8c9a8',
          dark: '#6b4a35',
          deep: '#1c1512',
        },
        panel: 'rgba(20,22,26,0.6)',
        border: 'rgba(176,141,87,0.28)',
      },
      borderRadius: {
        xl: '18px',
        '2xl': '24px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        copper: '0 0 18px rgba(176,141,87,0.25)',
      },
    },
  },
  plugins: [],
};
