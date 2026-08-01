import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@stonks/db",
    "@stonks/ledger",
    "@heroui/react",
    "@heroui/styles",
    "@heroui-pro/react",
  ],
  serverExternalPackages: ["postgres"],
  outputFileTracingRoot: join(__dirname, "../.."),
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
