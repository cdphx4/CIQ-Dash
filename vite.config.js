import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set base to the repository name for GitHub Pages deployment.
// When hosted at https://<user>.github.io/CIQ-Dash/ this must match.
export default defineConfig({
  plugins: [react()],
  base: '/CIQ-Dash/',
})
