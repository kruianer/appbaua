import { describe, it, expect } from "vitest";
import { isPublic } from "./middleware";

// req-023 AC3: everything except the auth surface itself must require a
// session. These pin exactly which paths are the exception — the ONE list
// that decides what a visitor can reach without logging in.

describe("middleware isPublic (req-023)", () => {
  it("the auth pages themselves are public", () => {
    expect(isPublic("/login")).toBe(true);
    expect(isPublic("/register")).toBe(true);
    expect(isPublic("/recovery")).toBe(true);
  });

  it("auth API routes are public, including nested ones (invitations/[token]/finish)", () => {
    expect(isPublic("/api/auth/login/start")).toBe(true);
    expect(isPublic("/api/auth/invitations/abc123/finish")).toBe(true);
  });

  it("AC3: the app's own surface is NOT public", () => {
    expect(isPublic("/")).toBe(false);
    expect(isPublic("/api/repos")).toBe(false);
    expect(isPublic("/api/worker-status")).toBe(false);
    expect(isPublic("/api/task-types")).toBe(false);
  });

  it("a path that merely starts with an auth page's name is not public (no prefix leak)", () => {
    expect(isPublic("/login-bypass")).toBe(false);
    expect(isPublic("/api/authorization")).toBe(false);
  });

  it("Next's own static assets stay reachable", () => {
    expect(isPublic("/_next/static/chunk.js")).toBe(true);
    expect(isPublic("/favicon.ico")).toBe(true);
  });
});
