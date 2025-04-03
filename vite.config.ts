import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    server: {
        open: true
    },
    build: {
        target: 'esnext',
        rollupOptions: {
            output: {
                manualChunks: {
                    p5: ['p5']
                }
            }
        }
    },
    plugins: [tailwindcss()]
}) 