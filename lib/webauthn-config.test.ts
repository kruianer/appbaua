import { describe, it, expect } from "vitest";
import { appOrigin, rpId } from "./webauthn-config";

describe("webauthn-config (req-023)", () => {
  it("uses APP_ORIGIN when set, trimming a trailing slash", () => {
    expect(appOrigin({ APP_ORIGIN: "https://app.appbaua.com/" })).toBe(
      "https://app.appbaua.com",
    );
  });

  it("falls back to localhost when APP_ORIGIN is unset", () => {
    expect(appOrigin({})).toBe("http://localhost:3000");
  });

  it("derives rpId as the bare hostname — no scheme, no port", () => {
    expect(rpId({ APP_ORIGIN: "https://dev.appbaua.com" })).toBe(
      "dev.appbaua.com",
    );
    expect(rpId({})).toBe("localhost");
  });

  it("dev and prod origins derive DIFFERENT rpIds — a dev passkey does not carry over", () => {
    const devRp = rpId({ APP_ORIGIN: "https://dev.appbaua.com" });
    const prodRp = rpId({ APP_ORIGIN: "https://app.appbaua.com" });
    expect(devRp).not.toBe(prodRp);
  });
});
