const rootRulePattern = /:root\s*\{[^}]*\}/;

export function toMiniTokenStyles(source: string): string {
  const rootRule = source.match(rootRulePattern)?.[0];

  if (!rootRule) {
    throw new Error("Design token stylesheet must define a :root rule");
  }

  return rootRule.replace(/^:root/, "page");
}
