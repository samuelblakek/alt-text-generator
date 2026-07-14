import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#FBFAF7',
        'text-primary': '#000000',
        'brand-primary': '#1e3771', // Menkind Blue
        'brand-secondary': '#1d71b8', // Cool Blue
        'brand-accent': '#4c90db', // Electric Blue
        'surface-muted': '#EAF1FB',
        'border-light': 'rgba(0,0,0,0.1)',
        danger: '#ed1c24', // Menkind Sale
        warning: '#b45309',
      },
      fontFamily: {
        heading: ['var(--font-heading)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      borderRadius: {
        sm: '4px',
        md: '12px',
        lg: '16px',
      },
      boxShadow: {
        card: '0 10px 15px -3px rgba(30,55,113,0.08)',
      },
      spacing: {
        section: '96px',
      },
    },
  },
  plugins: [],
};

export default config;
