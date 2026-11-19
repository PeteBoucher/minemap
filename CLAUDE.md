# Minemap

## Workflow

`main` is protected: work on a branch and open a PR. Each PR runs the e2e purchase test against its Vercel Preview (about 6½ minutes and one sandbox purchase); merging needs it green and the branch up to date with `main`.

## Skills

Reach for these mattpocock-skills by default:

- **Bug** reported or something broken → `diagnosing-bugs`: get a red repro before touching the fix.
- **Feature or fix** → `tdd`: the failing test comes first.
- **Decision** worth keeping (pricing, tax, licensing, personal data) → `domain-modeling`: record it as an ADR in `docs/adr/`.
- **PR body** → `pr`.
- **Branch ready to merge** → `code-review` against `main` before asking for the merge.

Payments, Stripe, licences or the audit trail → read `docs/PAYMENTS.md` first.
