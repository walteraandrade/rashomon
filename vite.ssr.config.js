import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte({ compilerOptions: { generate: 'server' } })],
  publicDir: false,
  build: {
    ssr: true,
    lib: { entry: 'public/js/components/ssr.js', formats: ['es'], fileName: 'testimony-ssr' },
    outDir: '.svelte-ssr',
    emptyOutDir: false,
    minify: false,
  },
})
