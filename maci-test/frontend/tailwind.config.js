/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        carbon: {
          bg: '#161616',
          'layer-1': '#262626',
          'layer-2': '#393939',
          'layer-hover': '#333333',
          'border': '#393939',
          'border-subtle': '#2a2a2a',
          'text-primary': '#f4f4f4',
          'text-secondary': '#c6c6c6',
          'text-helper': '#6f6f6f',
          'text-disabled': '#525252',
          'interactive': '#4589ff',
          'interactive-hover': '#6ea6ff',
          'support-success': '#42be65',
          'support-warning': '#f1c21b',
          'support-error': '#da1e28',
          'support-error-light': '#fa4d56',
          'support-info': '#4589ff',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],    // 11px
        'xs': ['0.75rem', { lineHeight: '1rem' }],        // 12px
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],    // 14px
        'base': ['1rem', { lineHeight: '1.5rem' }],       // 16px
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],    // 18px
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],     // 20px
        'heading': ['1.75rem', { lineHeight: '2.25rem' }], // 28px
      },
      borderRadius: {
        'none': '0',
        'sm': '2px',
        'DEFAULT': '4px',
        'md': '4px',
        'lg': '4px',
      },
    },
  },
  plugins: [],
};
