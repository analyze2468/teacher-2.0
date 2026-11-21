/**
 * Tailwind 主题配置（Play CDN 运行时读取）
 * 说明：本文件是普通脚本，必须在 tailwind-play.js 之后加载。
 * 项目未使用构建工具，所有工具类由 assets/vendor/tailwind-play.js 在浏览器端生成。
 */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'Helvetica',
          'Arial',
          'sans-serif'
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace'
        ]
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 30px -18px rgba(15, 23, 42, 0.25)',
        float: '0 18px 40px -24px rgba(37, 99, 235, 0.55)'
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.45)' },
          '70%': { boxShadow: '0 0 0 14px rgba(239, 68, 68, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0)' }
        }
      },
      animation: {
        'fade-up': 'fadeUp .32s ease-out both',
        'pulse-ring': 'pulseRing 1.6s ease-out infinite'
      }
    }
  }
};
