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
            includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon.png'],
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
              globIgnores: ['**/PreviewWorkspace-*.*', '**/LiveWorkspace-*.*'],
              navigateFallback: 'index.html',
              runtimeCaching: [{
                urlPattern: /\/assets\/(?:PreviewWorkspace|LiveWorkspace)-[^/]+\.(?:js|css)$/,
                handler: 'CacheFirst',
                options: {
                  // Stable legacy key: existing installed PWAs already use this runtime cache.
                  cacheName: 'saath-feature-chunks',
                  expiration: { maxEntries: 16, maxAgeSeconds: 30 * 24 * 60 * 60 },
                },
              }],
            },
            manifest: {
              id: '/',
              name: 'Saathi',
              short_name: 'Saathi',
              description: 'A multilingual family inbox and shared messenger.',
              lang: 'en',
              dir: 'ltr',
              theme_color: '#233f72',
              background_color: '#f4f0e8',
              display: 'standalone',
              display_override: ['standalone', 'minimal-ui'],
              orientation: 'portrait-primary',
              scope: '/',
              start_url: '/',
              categories: ['lifestyle', 'productivity', 'social'],
              icons: [
                { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
