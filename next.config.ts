import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/shared-reading-app",
  assetPrefix: "/shared-reading-app/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;