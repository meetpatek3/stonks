import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(__dirname, "../app/globals.css"), "utf-8");
const layoutTsx = readFileSync(join(__dirname, "../app/layout.tsx"), "utf-8");

describe("globals.css", () => {
  it("imports tailwindcss, @heroui/styles, and @heroui-pro/react/css in that order", () => {
    const tailwindIndex = globalsCss.indexOf('@import "tailwindcss"');
    const heroUiIndex = globalsCss.indexOf('@import "@heroui/styles"');
    const heroUiProCssIndex = globalsCss.indexOf('@import "@heroui-pro/react/css"');

    expect(tailwindIndex).toBeGreaterThanOrEqual(0);
    expect(heroUiIndex).toBeGreaterThan(tailwindIndex);
    expect(heroUiProCssIndex).toBeGreaterThan(heroUiIndex);
  });

  it("imports tailwindcss exactly once", () => {
    const matches = globalsCss.match(/@import "tailwindcss"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("contains no custom property declarations", () => {
    expect(globalsCss).not.toMatch(/^\s*--[a-zA-Z-]+\s*:/m);
  });

  it("contains no glass references", () => {
    expect(globalsCss).not.toMatch(/glass/i);
  });

  it("contains no @theme rule", () => {
    expect(globalsCss).not.toMatch(/@theme/);
  });
});

describe("layout.tsx", () => {
  it("sets data-theme=\"dark\" on <html>", () => {
    expect(layoutTsx).toMatch(/<html[^>]*data-theme="dark"/);
  });

  it("does not reference glass", () => {
    expect(layoutTsx).not.toMatch(/glass/i);
  });
});
