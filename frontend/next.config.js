/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@noble/curves', '@noble/hashes'],
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };

    // Add rule to transpile TypeScript files from offchain directory
    config.module.rules.push({
      test: /\.ts$/,
      include: /offchain/,
      use: [
        {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          },
        },
      ],
    });

    return config;
  },
}

module.exports = nextConfig
