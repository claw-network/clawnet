import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Backward compat: old /docs/... URLs → new /... URLs
      {
        source: '/docs/:path*',
        destination: '/:path*',
        permanent: true,
      },
      {
        source: '/docs',
        destination: '/',
        permanent: true,
      },
    ];
  },
};

const withMDX = createMDX();

export default withMDX(config);
