import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "./Icon";

// req-015: the logo is a gear with a check, drawn in the same thin, even lines
// as the rest of the icon set — one colour, no fills, no background shape.

describe("brand icon (req-015)", () => {
  it("AC: is a gear with a check in line style", () => {
    const { container } = render(<Icon name="brand" size={30} />);
    const svg = container.querySelector("svg")!;

    // Zahnradkörper + Zähne + Häkchen, alles als Striche.
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
    expect(svg.querySelectorAll("path").length).toBeGreaterThanOrEqual(9);

    // Linien-Stil: nichts ist ausgefüllt, alles nutzt die eine Strichfarbe.
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.innerHTML).not.toContain("fill=");
  });

  it("draws within the shared 24×24 grid, like every other icon", () => {
    const { container } = render(<Icon name="brand" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  });
});
