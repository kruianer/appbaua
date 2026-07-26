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
  // Der Browser-Treiber der Doku-Screenshots (req-017) laeuft nur im Worker und
  // wird zur Laufzeit nachgeladen; Next soll ihn nicht mitbuendeln.
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;
