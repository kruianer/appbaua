import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMemoryAuthStore, setAuthStore, getAuthStore } from "./auth-store";
import {
  startRegistration,
  finishRegistration,
  startLogin,
  finishLogin,
} from "./auth-webauthn";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";

const NOW = new Date(2026, 6, 27, 10, 0, 0);

beforeEach(() => {
  setAuthStore(createMemoryAuthStore());
});

const fakeRegResponse = { id: "cred1" } as unknown as RegistrationResponseJSON;
const fakeAuthResponse = { id: "cred1" } as unknown as AuthenticationResponseJSON;

const verifiedRegistration = (): VerifiedRegistrationResponse =>
  ({
    verified: true,
    registrationInfo: {
      fmt: "none",
      aaguid: "aaguid",
      credential: {
        id: "cred1",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
      },
      credentialType: "public-key",
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "http://localhost:3000",
    },
  }) as unknown as VerifiedRegistrationResponse;

describe("startRegistration / finishRegistration (req-023)", () => {
  it("AC: a verified response stores a new credential for the user", async () => {
    await getAuthStore().createUser({
      id: "u1",
      isOperator: true,
      createdAt: NOW.toISOString(),
    });
    const { token } = await startRegistration("u1", "Betreiber", () => NOW);
    const result = await finishRegistration(
      token,
      fakeRegResponse,
      () => NOW,
      async () => verifiedRegistration(),
    );
    expect(result.ok).toBe(true);
    const creds = await getAuthStore().listCredentialsForUser("u1");
    expect(creds).toHaveLength(1);
    expect(creds[0].id).toBe("cred1");
  });

  it("a token that was never issued fails as no-ceremony", async () => {
    const result = await finishRegistration(
      "bogus-token",
      fakeRegResponse,
      () => NOW,
      async () => verifiedRegistration(),
    );
    expect(result).toEqual({ ok: false, error: "no-ceremony" });
  });

  it("the same token cannot finish a ceremony twice (single-use challenge)", async () => {
    await getAuthStore().createUser({
      id: "u1",
      isOperator: true,
      createdAt: NOW.toISOString(),
    });
    const { token } = await startRegistration("u1", "Betreiber", () => NOW);
    const verify = async () => verifiedRegistration();
    await finishRegistration(token, fakeRegResponse, () => NOW, verify);
    const second = await finishRegistration(token, fakeRegResponse, () => NOW, verify);
    expect(second).toEqual({ ok: false, error: "no-ceremony" });
  });

  it("a failed verification does not store a credential", async () => {
    await getAuthStore().createUser({
      id: "u1",
      isOperator: true,
      createdAt: NOW.toISOString(),
    });
    const { token } = await startRegistration("u1", "Betreiber", () => NOW);
    const result = await finishRegistration(
      token,
      fakeRegResponse,
      () => NOW,
      async () => ({ verified: false }) as VerifiedRegistrationResponse,
    );
    expect(result).toEqual({ ok: false, error: "verification-failed" });
    expect(await getAuthStore().listCredentialsForUser("u1")).toHaveLength(0);
  });
});

describe("startLogin / finishLogin (req-023)", () => {
  async function withRegisteredUser() {
    await getAuthStore().createUser({
      id: "u1",
      isOperator: true,
      createdAt: NOW.toISOString(),
    });
    await getAuthStore().addCredential({
      id: "cred1",
      userId: "u1",
      publicKey: Buffer.from([1, 2, 3]).toString("base64url"),
      counter: 4,
      transports: ["internal"],
      createdAt: NOW.toISOString(),
    });
  }

  it("AC: a verified login returns the credential's owner and bumps the counter", async () => {
    await withRegisteredUser();
    const { token } = await startLogin(() => NOW);
    const verify = vi.fn(
      async () =>
        ({
          verified: true,
          authenticationInfo: { newCounter: 5 },
        }) as unknown as VerifiedAuthenticationResponse,
    );
    const result = await finishLogin(token, fakeAuthResponse, () => NOW, verify);
    expect(result).toEqual({ ok: true, userId: "u1" });
    expect((await getAuthStore().getCredential("cred1"))?.counter).toBe(5);
  });

  it("a response naming an unregistered credential id fails cleanly", async () => {
    const { token } = await startLogin(() => NOW);
    const result = await finishLogin(
      token,
      fakeAuthResponse,
      () => NOW,
      async () => ({ verified: true }) as unknown as VerifiedAuthenticationResponse,
    );
    expect(result).toEqual({ ok: false, error: "unknown-credential" });
  });

  it("an expired challenge fails as no-ceremony, even with a valid credential", async () => {
    await withRegisteredUser();
    const { token } = await startLogin(() => NOW);
    const muchLater = new Date(NOW.getTime() + 60 * 60_000); // +1h, well past 5 min TTL
    const result = await finishLogin(
      token,
      fakeAuthResponse,
      () => muchLater,
      async () => ({ verified: true }) as unknown as VerifiedAuthenticationResponse,
    );
    expect(result).toEqual({ ok: false, error: "no-ceremony" });
  });
});
