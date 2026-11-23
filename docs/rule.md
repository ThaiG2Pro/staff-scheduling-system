# Project Rules — Staff Scheduling System

## Source of Truth
Before writing any code, always read the frozen specs in `docs/`:
- `01-prduct-scope.md`
- `02-manager-workflow.md`
- `03-domain-model.md`
- `04-optimization-spec.md`
- `05-ux-spec.md`
- `technical-design.md`
- `06-acceptance-tests.md`

## Hard Guardrails
1. Follow strict 4-layer boundaries: `ui` -> `state` -> `domain` & `persistence`.
2. `src/domain/*` must be 100% pure TypeScript: NO React, NO DOM, NO `localStorage`, NO `File`, NO `Date.now()`, NO `Math.random()`, NO `crypto.randomUUID()`.
3. Never store Derived State in `localStorage`. Never use `useEffect` to compute or sync Derived State — compute via pure functions + `useMemo`.
4. Never use `Math.ceil(transactions / n)` directly; always use `computeRequiredStaff()` in `decimalMath.ts` (BigInt exact decimal division).
5. Keep solver allocation 100% deterministic and independent of generated UUIDs.
6. Asymmetric enforcement: hard constraints in `autoScheduler.ts`, soft warnings with inline confirmation for manual Manager edits.
7. Do NOT add out-of-scope features (no auth, no roles/skills, no per-staff availability, no 2-way swap UI, no 0-100 composite score, no Publish/Finalize state).
8. Keep files small, readable, and easy to modify live in an interview. Prefer explicit, plain TypeScript over clever abstractions.

## Workflow Per Task
- Use **`mise` + `pnpm`** exclusively (`pnpm install`, `pnpm run typecheck`, `pnpm test`, `pnpm run bench`, `pnpm run build`). NEVER use `npm` or `npx`.
- Implement strictly ONE vertical slice at a time.
- After each slice, run `pnpm run typecheck` and `pnpm test` and fix all errors before stopping.
- If a requirement conflicts with any frozen doc, STOP and ask instead of guessing.