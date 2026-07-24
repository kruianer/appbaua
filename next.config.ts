import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Schlankes Docker-Image: Next bündelt nur die nötigen Dateien.
  output: "standalone",
  // Behebt die "multiple lockfiles"-Warnung: dieses Verzeichnis ist die Wurzel.
  outputFileTracingRoot: path.join(__dirname),
  // schema.sql wird zur Laufzeit von pg-store.ts gelesen -> ins Bundle nehmen.
  outputFileTracingIncludes: {
    "/": ["./lib/schema.sql"],
  },
};

export default nextConfig;
