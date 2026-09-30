import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'

const include = ['test/components/**/*.spec.ts']

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    projects: [
      {
        extends: true,
        resolve: { conditions: ['browser'] },
        test: { name: 'dom', environment: 'happy-dom', include, exclude: ['**/*.server.spec.ts'] },
      },
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['test/components/**/*.server.spec.ts'] },
      },
    ],
  },
})
