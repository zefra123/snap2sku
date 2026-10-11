import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toMiniTokenStyles } from "./mini-token-styles";

const designTokens = readFileSync(
  new URL("../../web/app/assets/css/tokens.css", import.meta.url),
  "utf8",
);

describe("mini-program design tokens", () => {
  it("keeps shared token declarations and excludes web-only selectors", () => {
    const styles = toMiniTokenStyles(designTokens);

    expect(styles).toMatch(/^page\s*\{/);
    expect(styles).toContain("--c-bg:");
    expect(styles).toContain("--radius:");
    expect(styles).not.toContain("* {");
    expect(styles).not.toContain("html {");
    expect(styles).not.toContain("body {");
  });

  it("fails clearly when the shared stylesheet has no token block", () => {
    expect(() => toMiniTokenStyles("body { color: red; }")).toThrow(
      "Design token stylesheet must define a :root rule",
    );
  });
});
