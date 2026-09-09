import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  publicDir: false,
  build: {
    lib: { entry: 'public/js/components/mount.js', formats: ['es'], fileName: 'testimony-island' },
    outDir: 'public/js/dist',
    emptyOutDir: false,
  },
})
