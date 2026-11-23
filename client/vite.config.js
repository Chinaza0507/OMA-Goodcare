import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Forward API and websocket calls to the Express server in development
    proxy: {
      '/api': 'http://localhost:5001',
      '/socket.io': { target: 'http://localhost:5001', ws: true },
    },
  },
})
