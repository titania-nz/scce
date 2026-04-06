import type { NextConfig } from "next";

// Tell Next.js to transpile rehype-highlight for compatibility.
const nextConfig: NextConfig = {
  transpilePackages: ['rehype-highlight'],
};

export default nextConfig;
