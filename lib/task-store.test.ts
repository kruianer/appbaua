import { describe, it, expect } from "vitest";
import {
  createMemoryTaskStore,
  seedMissingDefaults,
  type TaskTypeStore,
} from "./task-store";
import { defaultTaskTypes, type TaskType } from "./task-types";

// req-014: Security was added to the predefined types after the stores had
// already been seeded. A store seeds only an EMPTY list, so without this an
// installation that ran before would never see the new type — and the Security
// task could never become due there.

describe("seedMissingDefaults", () => {
  const withoutSecurity = () =>
    defaultTaskTypes().filter((t) => t.id !== "security");

  it("adds a predefined type the persisted list does not know yet", async () => {
    const store = seedMissingDefaults(createMemoryTaskStore(withoutSecurity()));
    const types = await store.list();
    expect(types.map((t) => t.id)).toEqual([
      "bug",
      "requirement",
      "code-review",
      "security",
      "doku",
      "ideen",
    ]);
    const security = types.find((t) => t.id === "security")!;
    expect(security.active).toBe(true);
    expect(security.always).toBe(true);
  });

  it("persists the addition, so a change to it sticks", async () => {
    const inner = createMemoryTaskStore(withoutSecurity());
    await seedMissingDefaults(inner).list();
    expect((await inner.list()).map((t) => t.id)).toContain("security");
  });

  it("keeps what the user configured on the existing types", async () => {
    const custom = withoutSecurity().map((t) =>
      t.id === "doku" ? { ...t, active: false } : t,
    );
    const types = await seedMissingDefaults(
      createMemoryTaskStore(custom),
    ).list();
    expect(types.find((t) => t.id === "doku")!.active).toBe(false);
  });

  it("touches nothing when the list is complete", async () => {
    let writes = 0;
    const inner = createMemoryTaskStore();
    const counting: TaskTypeStore = {
      list: () => inner.list(),
      replace: (types: TaskType[]) => {
        writes += 1;
        return inner.replace(types);
      },
    };
    const types = await seedMissingDefaults(counting).list();
    expect(types).toHaveLength(6);
    expect(writes).toBe(0);
  });

  it("passes replace straight through", async () => {
    const inner = createMemoryTaskStore();
    const store = seedMissingDefaults(inner);
    const only = defaultTaskTypes().slice(0, 2);
    await store.replace(only);
    expect((await inner.list()).map((t) => t.id)).toEqual([
      "bug",
      "requirement",
    ]);
  });
});
