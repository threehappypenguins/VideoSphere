import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {'/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      '/auth': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      '/auth/google': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'build',
    manifest: true,
    rollupOptions: {
      input: '/src/main.jsx',
    },
  },
})