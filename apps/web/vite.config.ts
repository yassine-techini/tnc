import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'TNC Trading',
        short_name: 'TNC',
        description: 'Plateforme de tokenisation de l\'or souverain',
        theme_color: '#D4AF37',
        background_color: '#1A1A2E',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/api\/v1\/market\/price$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'market-price',
              expiration: { maxEntries: 1, maxAgeSeconds: 60 },
            },
          },
          {
            urlPattern: /\/api\/v1\/market\/price\/history/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'price-history',
              expiration: { maxEntries: 4, maxAgeSeconds: 300 },
            },
          },
          {
            urlPattern: /\/api\/v1\/market\/stock$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'market-stock',
              expiration: { maxEntries: 1, maxAgeSeconds: 120 },
            },
          },
        ],
      },
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charts: ['lightweight-charts'],
        },
      },
    },
  },
});
