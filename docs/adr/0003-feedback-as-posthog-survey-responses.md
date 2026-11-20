# Feedback goes to PostHog as survey responses, even without analytics consent

The in-app feedback form (#14) sends each report as a response to the "Feedback" API survey in PostHog (EU): a `survey sent` event with the kind, message and optional email under the survey's question ids (`src/ui/feedback.ts`). There's no backend, email provider or spam handling to run, and a bug report sits next to the same visitor's replay and errors. If the visitor accepted analytics, the response goes through the running SDK and is linked to their visit. Otherwise (they declined, haven't answered, or the SDK couldn't load) it's a single `fetch` to PostHog's capture endpoint under a random one-off id with `$process_person_profile: false`. The SDK isn't loaded and nothing is stored, as ADR 0002 requires. Visitors are told what's kept: the dialog says the message and email are stored in PostHog (EU), and the analytics banner says feedback you choose to send is the one thing collected without accepting.

## Considered Options

- **File reports as GitHub issues.** Rejected: the repo is public, so users' text and emails would be published.
- **PostHog's own popover or widget survey.** Rejected: it needs the SDK, which visitors who declined never load, and it doesn't match the app's look.
- **A per-message "link this to my visit" checkbox.** Tried and removed. With consent the visit is recorded anyway, and without it there's nothing recorded to link: ticking the box couldn't give a replay of the problem being reported. Instead the dialog tells visitors who haven't accepted that accepting analytics lets future reports include a replay.

## Consequences

- The survey's question ids are hard-coded; editing the survey's questions in PostHog must keep them, or new responses won't line up with old ones.
- A build without `VITE_POSTHOG_KEY` (including dev) shows no feedback entry point, since there's nowhere to send it.
