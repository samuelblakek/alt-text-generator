/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'sharp', 'p-limit'],
  },
};

module.exports = nextConfig;
