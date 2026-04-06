import type { NextConfig } from "next";
import path from "path";

// Tell Next.js to transpile rehype-highlight for compatibility.
const nextConfig: NextConfig = {
  transpilePackages: ['rehype-highlight'],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
