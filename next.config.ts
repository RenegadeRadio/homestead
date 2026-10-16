import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["cron-parser", "playwright"],
};

export default nextConfig;
