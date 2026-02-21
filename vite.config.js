import { defineConfig, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // Pre-transform 'UI Frontend' (no extension) as JSX before Vite's import analysis
    {
      name: 'treat-ui-frontend-as-jsx',
      enforce: 'pre',
      async transform(code, id) {
        if (id.endsWith('UI Frontend')) {
          return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' })
        }
      },
    },
    react(),
  ],
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', ''],
  },
})
