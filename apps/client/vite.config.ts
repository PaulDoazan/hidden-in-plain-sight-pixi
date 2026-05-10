import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // @hips/shared exports source TS to the browser via the `browser` condition
  // (see packages/shared/package.json `exports` field). Excluding it from
  // optimizeDeps prevents Vite from pre-bundling the CJS dist build, which
  // does not surface named exports through esbuild's CJS interop.
  optimizeDeps: {
    exclude: ['@hips/shared'],
  },
})
