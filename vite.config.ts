import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const portalLatencyOptimizations = {
  name: 'portal-latency-optimizations',
  enforce: 'pre',
  transform(code, id) {
    if (!id.split('?')[0].endsWith('/src/index.css')) return
    return code.replace(/^@import url\([^\n]+\);\n/, '')
  },
  transformIndexHtml(html) {
    return html.replace('</head>', '<link rel="icon" href="data:,">\n  </head>')
  },
} satisfies Plugin

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const portalBuild = mode === 'portal'

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(portalBuild ? [portalLatencyOptimizations, viteSingleFile({ removeViteModuleLoader: true })] : []),
    ],
    server: {
      allowedHosts: ['.onamp.dev', 'amp.tarp.sh'],
    },
    preview: {
      allowedHosts: ['.onamp.dev', 'amp.tarp.sh'],
    },
  }
})
