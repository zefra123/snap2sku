# Domain Docs

Engineering skills should use the multi-context documentation layout in this repository.

## Before exploring

- Read the root `CONTEXT-MAP.md`, then read the `CONTEXT.md` for each context relevant to the task.
- Read system-wide decisions in `docs/adr/` and relevant context-specific decisions in that context's `docs/adr/` directory.
- If a map entry or document does not exist yet, proceed silently. The `/domain-modeling` skill creates context and ADR documents lazily when terms or decisions are resolved.

## Context layout

- Web application: `apps/web/CONTEXT.md` and `apps/web/docs/adr/`
- WeChat mini program: `apps/mp/CONTEXT.md` and `apps/mp/docs/adr/`
- Shared contracts and schemas: `packages/shared/CONTEXT.md` and `packages/shared/docs/adr/`
- AI prompts: `packages/prompts/CONTEXT.md` and `packages/prompts/docs/adr/`
- System-wide decisions: `docs/adr/`

Use each context glossary's vocabulary in issue titles, refactor proposals, hypotheses, and test names. If a needed concept is absent, note it as a domain-modeling gap rather than inventing a competing term.

If an implementation or proposal contradicts an ADR, surface the conflict explicitly rather than silently overriding the decision.
