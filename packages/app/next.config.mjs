/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile ESM workspace packages so Next.js can bundle them correctly.
  transpilePackages: ['@covenant/sdk'],

  // Suppress the "require of ES Module" warning from @shelby-protocol/sdk in
  // API routes; those routes already run on Node.js so native ESM is fine.
  experimental: {
    serverComponentsExternalPackages: ['@shelby-protocol/sdk'],
  },
};

export default nextConfig;
