import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// The backend is Convex: the website talks to it directly (VITE_CONVEX_URL in .env.local).
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
