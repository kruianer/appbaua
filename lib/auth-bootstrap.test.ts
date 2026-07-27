import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryAuthStore, setAuthStore, getAuthStore } from "./auth-store";
import { bootstrapOperator } from "./auth-bootstrap";

const NOW = new Date(2026, 6, 27, 10, 0, 0);

beforeEach(() => {
  setAuthStore(createMemoryAuthStore());
});

describe("bootstrapOperator (req-023 AC1)", () => {
  it("AC: in an empty environment, creates an operator and starts a registration ceremony", async () => {
    const result = await bootstrapOperator(() => NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.options).toBeTruthy();
    expect(result.registration.token).toBeTruthy();

    const users = await getAuthStore().countUsers();
    expect(users).toBe(1);
    const operator = await getAuthStore().getOperator();
    expect(operator?.isOperator).toBe(true);
  });

  it("refuses a second bootstrap once a user exists", async () => {
    await bootstrapOperator(() => NOW);
    const second = await bootstrapOperator(() => NOW);
    expect(second).toEqual({ ok: false, error: "already-bootstrapped" });
    expect(await getAuthStore().countUsers()).toBe(1); // no second user created
  });

  it("refuses even if the existing user is not the operator (any user blocks it)", async () => {
    await getAuthStore().createUser({
      id: "invited1",
      isOperator: false,
      createdAt: NOW.toISOString(),
    });
    const result = await bootstrapOperator(() => NOW);
    expect(result).toEqual({ ok: false, error: "already-bootstrapped" });
  });
});
