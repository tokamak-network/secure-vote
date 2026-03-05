/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@rainbow-me/rainbowkit',
    '@vanilla-extract/css',
    '@vanilla-extract/dynamic',
  ],
};

module.exports = nextConfig;
