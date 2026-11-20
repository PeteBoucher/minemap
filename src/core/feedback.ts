// The in-app feedback form's answers, as a response to the "Feedback" API survey in PostHog (#14).
// The app draws its own form; PostHog only stores the "survey sent" event.

export type FeedbackKind = "Bug" | "Feature request" | "Other";

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  email: string;
  /** The visitor ticked "link this to my visit". Only possible when they accepted analytics. */
  linkVisit: boolean;
}

interface Question { id: string; question: string }

/** The survey's id and its three questions' ids, as created in PostHog. */
export interface FeedbackSurvey {
  id: string;
  questions: { kind: Question; message: Question; email: Question };
}

export type SurveyResponse =
  | { ok: true; properties: Record<string, unknown> }
  | { ok: false; error: string };

export interface SendDeps {
  consent: "granted" | "denied" | null;
  survey: FeedbackSurvey;
  apiKey: string;
  host: string;
  newId: () => string;
  /** The running PostHog SDK; only asked for when the visitor accepted analytics. */
  posthog: () => Promise<{ capture: (event: string, props: Record<string, unknown>) => unknown } | null>;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean }>;
}

export async function sendFeedback(input: FeedbackInput, deps: SendDeps): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = surveyResponse(input, deps.survey);
  if (!r.ok) return r;
  if (deps.consent === "granted" && input.linkVisit) {
    const ph = await deps.posthog().catch(() => null);
    if (ph) {
      ph.capture("survey sent", r.properties);
      return { ok: true };
    }
  }
  // Not linked (no consent, box unticked, or the SDK couldn't load): one event straight to the capture endpoint, under a throwaway id with no person profile.
  // The SDK isn't loaded, so nothing is stored and the response isn't linked to any visit (ADR 0002).
  const res = await deps
    .fetch(`${deps.host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: deps.apiKey,
        event: "survey sent",
        distinct_id: deps.newId(),
        properties: { ...r.properties, $process_person_profile: false },
      }),
    })
    .catch(() => null);
  return res?.ok ? { ok: true } : { ok: false, error: "Couldn't send your feedback. Check your connection and try again." };
}

export function surveyResponse(input: Omit<FeedbackInput, "linkVisit">, survey: FeedbackSurvey): SurveyResponse {
  const msg = input.message.trim();
  if (!msg) return { ok: false, error: "Please write a message." };
  const email = input.email.trim();
  const q = survey.questions;
  return {
    ok: true,
    properties: {
      $survey_id: survey.id,
      $survey_questions: [q.kind, q.message, q.email].map(({ id, question }) => ({ id, question })),
      [`$survey_response_${q.kind.id}`]: input.kind,
      [`$survey_response_${q.message.id}`]: msg,
      ...(email && { [`$survey_response_${q.email.id}`]: email }),
      $survey_completed: true,
    },
  };
}
