/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        chatgpt: {
          sidebar: '#202123',
          main: '#343541',
          hover: '#2A2B32',
          border: '#4D4D4F'
        }
      }
    },
  },
  plugins: [],
}
