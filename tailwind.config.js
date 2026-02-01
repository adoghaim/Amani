/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        theme: {
          primary: '#C97C8B',
          'primary-dark': '#A85C6D',
          accent: '#7A3E55',
          background: '#FFF8F7',
          surface: '#FFFFFF',
          'surface-2': '#F6ECEB',
          text: '#2A1F23',
          'muted-text': '#6B5B60',
          border: '#E9D6DA',
          success: '#2F8F6B',
          warning: '#C78A2A',
          danger: '#B5475A',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
