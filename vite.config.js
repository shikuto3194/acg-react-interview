import { optimizedImages } from './scripts/optimized-images.mjs';
import { manualChunks } from './scripts/chunks.mjs';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), optimizedImages({ sourceDir: 'public/images', preferExisting: true })],
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
    proxy: {
      // CORS 回避用: ランタイムで acgtcg.com/QA.html を取得するためのプロキシ。
      // 本番(Netlify) では public/_redirects 側で同じパスをリライトする。
      '/qa-proxy': {
        target: 'https://acgtcg.com',
        changeOrigin: true,
        rewrite: () => '/QA.html',
      },
      // 同様にホーム画面用 (acgtcg.com トップページ)。
      '/home-proxy': {
        target: 'https://acgtcg.com',
        changeOrigin: true,
        rewrite: () => '/',
      },
      // 公式・公認イベント一覧 (acgtcg.com/index_event.html)。
      '/event-proxy': {
        target: 'https://acgtcg.com',
        changeOrigin: true,
        rewrite: () => '/index_event.html',
      },
    },
  },
  build: {
    manifest: true,
    // 警告のしきい値を引き上げ（大きなデータやPDF系依存を使用しているため）
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // 主要依存や大きめのモジュールを事前に分割
        manualChunks
      }
    }
  }
})
