/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        theme: {
          primary: '#C97C8B',
          'primary-dark': '#A85C6D',
          'primary-light': '#E8B4BD',
          'primary-faded': '#D4A8B0',
          accent: '#7A3E55',
          background: '#FFF8F7',
          'background-tint': '#fdf7f8',
          surface: '#FFFFFF',
          'surface-2': '#F6ECEB',
          'surface-hover': '#EED9D9',
          text: '#2A1F23',
          'text-body': '#4A3A40',
          'muted-text': '#6B5B60',
          'muted-text-2': '#7A6570',
          'muted-text-3': '#9A8A90',
          'muted-text-4': '#A8969C',
          'muted-text-5': '#c4adb2',
          border: '#E9D6DA',
          'border-subtle': '#e8dce0',
          'border-inner': '#f0e6ea',
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
