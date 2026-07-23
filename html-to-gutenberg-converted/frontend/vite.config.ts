import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Backend not required for the MVP (all conversion is in-browser),
    // but the proxy is ready for when /api/crawl etc. are added.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
