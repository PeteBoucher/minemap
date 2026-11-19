# The e2e purchase check runs only for payment changes, but always reports

"e2e purchase on Preview" is a required check on `main`, and it costs about 6½ minutes and a sandbox purchase per run. It also depends on Stripe's hosted checkout, which can break for reasons unrelated to our code (PR #6 failed on a README change). So the job runs on every pull request, lists the PR's changed files, and only does the purchase when one matches `PAYMENT_PATHS` in `.github/workflows/e2e-preview.yml`; otherwise it passes in seconds.

## Considered Options

- **`on.paths` on the workflow.** Rejected: when no path matches the workflow never starts, the required check never reports, and GitHub blocks the PR indefinitely ("Expected — waiting for status").
- **Run the purchase on every PR.** Rejected: slow, and unrelated PRs inherit Stripe checkout flakiness.
- **Drop the check from the required list.** Rejected: payment PRs could then merge red.

## Consequences

- `PAYMENT_PATHS` is a hand-kept list. A change that affects payments from outside it merges without a purchase test. `src/main.ts`, `index.html` and `src/styles.css` hold some unlock wiring but are left out because almost every PR touches them; add a path when payment logic moves into a new file.
- The workflow file itself is in the list, so changes to the filter are tested by a real purchase.
