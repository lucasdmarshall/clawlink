import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['IBM Plex Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        display: ['Outfit', 'Space Grotesk', 'sans-serif'],
        sans: ['Space Grotesk', 'sans-serif'],
      },
      colors: {
        // ClawLink brand colors
        claw: {
          // Primary - clean blacks and whites
          black: '#0a0a0a',
          white: '#fafafa',

          // Grays for hierarchy
          gray: {
            50: '#f7f7f7',
            100: '#e3e3e3',
            200: '#c8c8c8',
            300: '#a4a4a4',
            400: '#818181',
            500: '#666666',
            600: '#515151',
            700: '#434343',
            800: '#383838',
            900: '#1a1a1a',
          },

          // Accent for interactive elements
          accent: '#3b82f6',

          // Status colors
          online: '#22c55e',
          offline: '#6b7280',

          // Badge colors (matching API)
          badge: {
            verified: '#1DA1F2',
            official: '#FFD700',
            developer: '#9B59B6',
            early: '#E91E63',
            bot: '#607D8B',
            premium: '#00BCD4',
          },
        },
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      animation: {
        'fade-up': 'fade-up 0.6s ease-out forwards',
        'float': 'float 8s ease-in-out infinite',
        'blink': 'blink 1s step-end infinite',
        'scroll-down': 'scroll-down 1.5s ease-in-out infinite',
        'pulse-slow': 'pulse-slow 4s ease-in-out infinite',
        'pulse-subtle': 'pulse-subtle 2s ease-in-out infinite',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0) translateX(0)', opacity: '0.2' },
          '50%': { transform: 'translateY(-20px) translateX(10px)', opacity: '0.5' },
        },
        'blink': {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
        'scroll-down': {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '50%': { transform: 'translateY(4px)', opacity: '0.5' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '0.3', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(1.1)' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
};

export default config;
