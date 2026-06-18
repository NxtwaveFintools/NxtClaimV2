import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "80mb",
      allowedOrigins: ["127.0.0.1", "localhost"],
    },
    optimizePackageImports: [
      "lucide-react",
      "exceljs",
      "@supabase/supabase-js",
      "zod",
      "react-hook-form",
      "@hookform/resolvers",
      "sonner",
      "next-themes",
    ],
  },
  // Next.js internal dev warning requires this to stop HMR ws blocking
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
