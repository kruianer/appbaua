import { describe, it, expect } from "vitest";
import { route } from "./routes";

// Der Health-Agent ist der einzige Prozess mit dem Docker-Socket (req-032).
// Was er annimmt und was er abweist, ist damit eine Sicherheitsaussage.

describe("route — genau vier Aufrufe, sonst nichts", () => {
  it("kennt die Container-Liste", () => {
    expect(route("GET", "/containers")).toEqual({ kind: "list" });
  });

  it("kennt die drei Aufrufe an einen einzelnen Container", () => {
    expect(route("GET", "/containers/abc/env")).toEqual({ kind: "env", id: "abc" });
    expect(route("POST", "/containers/abc/exec")).toEqual({ kind: "exec", id: "abc" });
    expect(route("POST", "/containers/abc/restart")).toEqual({
      kind: "restart",
      id: "abc",
    });
  });

  it("weist ein falsches Verb ab — ein Neustart ist kein GET", () => {
    expect(route("GET", "/containers/abc/restart")).toBeNull();
    expect(route("POST", "/containers")).toBeNull();
  });

  it("weist alles ab, was nicht in der Liste steht — kein Durchgriff auf die Engine", () => {
    expect(route("GET", "/")).toBeNull();
    expect(route("GET", "/version")).toBeNull();
    expect(route("POST", "/containers/abc/kill")).toBeNull();
    expect(route("GET", "/images/json")).toBeNull();
    expect(route("POST", "/containers/create")).toBeNull();
  });

  it("nimmt einen Container-Namen mit Bindestrichen entgegen", () => {
    expect(route("POST", "/containers/lgt-prod-app/restart")).toEqual({
      kind: "restart",
      id: "lgt-prod-app",
    });
  });
});
