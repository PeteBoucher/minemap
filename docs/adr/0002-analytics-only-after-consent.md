# 2. Browser analytics only after the visitor accepts

Date: 2026-11-19
Status: accepted

## Context

We want real user monitoring of the web app: pageviews, Core Web Vitals, JavaScript errors and session replay. Most visitors are in the EU, so analytics cookies and session recording need the visitor's prior consent (ePrivacy Directive, GDPR). The server already sends the licence audit trail to the PostHog project "Default project" (EU cloud); the browser uses the same project.

## Decision

- **Nothing before consent.** `posthog-js` isn't even loaded until the visitor taps *Accept* on the banner. Before that no request reaches PostHog and no cookie or PostHog storage is set. Declining keeps it that way.
- **With consent, the full set:** pageviews, Web Vitals, exception autocapture and session replay, with PostHog's normal cookie persistence, so a returning visitor is recognised.
- **Masking:** replays mask every input (`maskAllInputs`), in the app config as well as the project settings. The project anonymises IP addresses.
- **No identification.** The app has no accounts and never calls `identify`, so visitors stay anonymous ids.
- **The choice** is kept in `localStorage` (`minemap.analytics`, an essential setting, not tracking). The footer's "Analytics & privacy" link reopens the banner. Declining after accepting opts out and resets the PostHog id.
- `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` are optional. Without a key a production build simply has no analytics.

## Considered options

- **Cookieless mode, no banner:** simpler and privacy-friendly, but visits aren't linked across days and session replay is weaker. We chose to ask instead.
- **Load the SDK up front with `opt_out_capturing_by_default`:** fewer moving parts, but the SDK still runs and may write storage before consent, and the combination with cookieless mode has known quirks. Not loading it at all is easier to reason about.
- **A consent-management platform (Cookiebot, OneTrust):** too heavy for one optional tool.

## Consequences

- Only visitors who accept are counted, so traffic numbers are a lower bound.
- Feedback (#14) must still work for visitors who declined: send it as a one-off event without starting analytics.
- Adding another analytics or tracking tool means asking for consent for it too, through the same banner.
- The visitor-facing wording lives in the banner in `index.html`; keep it in step with what the config actually collects.
