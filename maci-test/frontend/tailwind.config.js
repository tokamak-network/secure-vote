/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'primary': '#833cf6',
        'background-dark': '#09090b',
        'surface-dark': '#111113',
        'border-dark': '#1c1c1e',
        'accent-blue': '#3b82f6',
      },
      fontFamily: {
        'display': ['Inter', 'sans-serif'],
        'mono': ['ui-monospace', 'monospace'],
      },
      borderRadius: {
        'DEFAULT': '0px',
        'lg': '0px',
        'xl': '0px',
        'full': '9999px',
      },
      letterSpacing: {
        'widest-custom': '0.15em',
      },
    },
  },
  plugins: [],
};
