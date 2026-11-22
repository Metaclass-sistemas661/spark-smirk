import { defineConfig } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html';
import viteCompression from 'vite-plugin-compression';
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  return {
    root: '.',
    base: '/',
    publicDir: 'public',
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],

    // ═══════════════════════════════════════════════════════════
    // DEV SERVER
    // ═══════════════════════════════════════════════════════════
    server: {
      port: 3000,
      open: true,
      cors: true,
      strictPort: false,
      host: true,
      hmr: {
        overlay: true,
      },
    },

    // ═══════════════════════════════════════════════════════════
    // PREVIEW SERVER (after build)
    // ═══════════════════════════════════════════════════════════
    preview: {
      port: 4173,
      open: true,
      host: true,
    },

    // ═══════════════════════════════════════════════════════════
    // BUILD OPTIONS
    // ═══════════════════════════════════════════════════════════
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: !isProduction,
      minify: isProduction ? 'terser' : false,
      cssMinify: isProduction,
      
      terserOptions: {
        compress: {
          drop_console: isProduction,
          drop_debugger: isProduction,
        },
        format: {
          comments: false,
        },
      },

      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          gestao: resolve(__dirname, 'gestao/index.html'),
          login: resolve(__dirname, 'login/index.html'),
        },
        output: {
          entryFileNames: 'js/[name]-[hash].js',
          chunkFileNames: 'js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const extType = assetInfo.name.split('.').pop();
            if (/css/i.test(extType)) {
              return 'css/[name]-[hash][extname]';
            }
            if (/png|jpe?g|svg|gif|tiff|bmp|ico|webp|avif/i.test(extType)) {
              return 'images/[name]-[hash][extname]';
            }
            if (/woff2?|eot|ttf|otf/i.test(extType)) {
              return 'fonts/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
          manualChunks(id) {
            if (id.includes('node_modules') && (id.includes('gsap') || id.includes('lenis'))) {
              return 'vendor';
            }
          },
        },
      },

      // Chunk size warning limit (500kb)
      chunkSizeWarningLimit: 500,
    },

    // ═══════════════════════════════════════════════════════════
    // CSS OPTIONS
    // ═══════════════════════════════════════════════════════════
    css: {
      devSourcemap: true,
      postcss: {
        plugins: [
          autoprefixer(),
          ...(isProduction ? [cssnano({ preset: 'default' })] : []),
        ],
      },
    },

    // ═══════════════════════════════════════════════════════════
    // PLUGINS
    // ═══════════════════════════════════════════════════════════
    plugins: [
      {
        name: 'gestao-mpa-route',
        enforce: 'pre',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const urlPath = (req.url || '').split('?')[0];
            if (urlPath === '/gestao' || urlPath === '/login') {
              const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
              res.writeHead(302, { Location: `${urlPath}/${qs}` });
              res.end();
              return;
            }
            const routeMap = {
              '/gestao/': 'gestao/index.html',
              '/gestao/index.html': 'gestao/index.html',
              '/login/': 'login/index.html',
              '/login/index.html': 'login/index.html',
            };
            const targetHtml = routeMap[urlPath];
            if (targetHtml) {
              try {
                const filePath = resolve(__dirname, targetHtml);
                const rawHtml = fs.readFileSync(filePath, 'utf-8');
                const transformed = await server.transformIndexHtml(req.url, rawHtml);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(transformed);
                return;
              } catch (err) {
                next(err);
                return;
              }
            }
            next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const urlPath = (req.url || '').split('?')[0];
            if (urlPath === '/gestao' || urlPath === '/login') {
              const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
              res.writeHead(302, { Location: `${urlPath}/${qs}` });
              res.end();
              return;
            }
            next();
          });
        },
      },

      // HTML Minification & Injection
      createHtmlPlugin({
        minify: isProduction,
        inject: {
          data: {
            title: 'Spark & Smirk — Engenharia, Construção e Jardinagem',
            description: 'Transformamos projetos em resultados sólidos, de elevada excelência e qualidade.',
          },
        },
      }),

      // Gzip & Brotli Compression (Production only)
      isProduction &&
        viteCompression({
          algorithm: 'gzip',
          ext: '.gz',
          threshold: 1024,
        }),
      isProduction &&
        viteCompression({
          algorithm: 'brotliCompress',
          ext: '.br',
          threshold: 1024,
        }),
    ].filter(Boolean),

    // ═══════════════════════════════════════════════════════════
    // RESOLVE
    // ═══════════════════════════════════════════════════════════
    resolve: {
      alias: {
        '@': resolve(__dirname, './'),
        '@css': resolve(__dirname, './css'),
        '@js': resolve(__dirname, './js'),
        '@assets': resolve(__dirname, './assets'),
      },
    },

    // ═══════════════════════════════════════════════════════════
    // OPTIMIZATIONS
    // ═══════════════════════════════════════════════════════════
    optimizeDeps: {
      include: ['gsap', 'lenis'],
    },

    // ═══════════════════════════════════════════════════════════
    // ENVIRONMENT VARIABLES
    // ═══════════════════════════════════════════════════════════
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
  };
});
