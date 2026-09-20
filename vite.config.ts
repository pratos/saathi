import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
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
      ...(portalBuild
        ? [portalLatencyOptimizations, viteSingleFile({ removeViteModuleLoader: true })]
        : [VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.png', 'icon.png'],
            manifest: {
              name: 'Saath',
              short_name: 'Saath',
              description: 'A multilingual family inbox and shared messenger.',
              theme_color: '#372a38',
              background_color: '#101a16',
              display: 'standalone',
              start_url: '/',
              icons: [
                { src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                { src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
          })]),
    ],
    server: {
      allowedHosts: ['.onamp.dev', 'amp.tarp.sh'],
    },
    preview: {
      allowedHosts: ['.onamp.dev', 'amp.tarp.sh'],
    },
  }
})
