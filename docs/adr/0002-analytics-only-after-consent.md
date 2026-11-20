# Browser analytics run only after the visitor accepts

The web app reports pageviews, Core Web Vitals, JavaScript errors and session replays to PostHog (EU cloud, the "Default project" the server's licence audit trail already uses). Most visitors are in the EU, so analytics cookies and recordings need prior consent. Until a visitor taps *Accept* on the banner, `posthog-js` isn't even downloaded: no request reaches PostHog and no PostHog cookie or storage is set.

With consent, PostHog runs with normal cookie persistence, so returning visitors are recognised. It collects exactly what the banner names: pageviews, Web Vitals, exceptions and replay, with every input masked. Click autocapture, heatmaps and dead-click capture are off, and the app never calls `identify`. The answer is kept in `localStorage` (`minemap.analytics`), and the footer's "Analytics & privacy" link reopens the banner.

Declining after accepting opts out and removes PostHog's cookies and storage at once. PostHog's own opt-out flag stays in `localStorage` until the next page load, because removing it while the SDK is still running switches capturing back on. A `before_send` gate drops anything captured after the answer changes. Events captured before the decline may still go out from PostHog's send queue a few seconds later (Web Vitals batches like this).

`VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` are optional. A build without a key has no banner, no footer link and no PostHog code.

## Considered Options

- **Cookieless mode, no banner.** Rejected: simpler, but visits aren't linked across days and session replay is weaker. We chose to ask instead.
- **Load the SDK up front with `opt_out_capturing_by_default`.** Rejected: the SDK would still run, and might write storage, before consent, and its combination with cookieless mode has known quirks. Not loading it at all is easier to reason about.
- **A consent-management platform (Cookiebot, OneTrust).** Rejected: too heavy for one optional tool.

## Consequences

- Only visitors who accept are counted, so traffic numbers are a lower bound.
- The PostHog chunk is left out of the service worker's precache, so visitors who decline never download it.
- Feedback (#14) must work for visitors who declined: send it as a one-off event without starting analytics. It does: with consent the response goes through the running SDK (linked to the visit and its replay); without consent, or if the SDK can't load, it's a single `fetch` to PostHog's capture endpoint under a random one-off id with `$process_person_profile: false`. The SDK isn't loaded and nothing is stored. The dialog says the message and optional email are stored in PostHog (EU). There's no per-message "link my visit" checkbox: with consent the visit is recorded anyway, and without it there's no recording to link, so ticking it couldn't give a replay of the problem being reported. Instead the dialog tells visitors who haven't accepted that accepting analytics lets future reports include a replay.
- Any other analytics or tracking tool needs consent too, through the same banner. The banner wording in `index.html` must match what the config collects.
