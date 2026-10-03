import type { NextConfig } from "next";
if (
  process.env.NODE_ENV === "production" &&
  process.env.E2E_AUTH_BYPASS === "1"
)
  throw new Error("Test authentication cannot run in production");
const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@edu/db", "@edu/shared", "@edu/email"],
  serverExternalPackages: ["pg", "pg-boss"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};
export default config;
