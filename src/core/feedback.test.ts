import { describe, expect, it } from "vitest";
import { type FeedbackSurvey, type SendDeps, sendFeedback, surveyResponse } from "./feedback";

const survey: FeedbackSurvey = {
  id: "survey-1",
  questions: {
    kind: { id: "q-kind", question: "What kind of feedback?" },
    message: { id: "q-message", question: "Message" },
    email: { id: "q-email", question: "Email (optional, for a reply)" },
  },
};

describe("feedback form → PostHog survey response", () => {
  it("a bug report with an email carries every answer under its question id", () => {
    expect(surveyResponse({ kind: "Bug", message: "Map shows a broken image", email: "me@example.com" }, survey)).toEqual({
      ok: true,
      properties: {
        $survey_id: "survey-1",
        $survey_questions: [
          { id: "q-kind", question: "What kind of feedback?" },
          { id: "q-message", question: "Message" },
          { id: "q-email", question: "Email (optional, for a reply)" },
        ],
        "$survey_response_q-kind": "Bug",
        "$survey_response_q-message": "Map shows a broken image",
        "$survey_response_q-email": "me@example.com",
        $survey_completed: true,
      },
    });
  });

  it("trims the answers and leaves out a blank email", () => {
    const r = surveyResponse({ kind: "Feature request", message: "  Dark mode for the map \n", email: "   " }, survey);
    expect(r.ok && r.properties["$survey_response_q-message"]).toBe("Dark mode for the map");
    expect(r.ok && Object.keys(r.properties)).not.toContain("$survey_response_q-email");
  });

  it("refuses a message that is empty or only spaces", () => {
    expect(surveyResponse({ kind: "Other", message: " \n ", email: "" }, survey)).toEqual({ ok: false, error: "Please write a message." });
  });
});

describe("sending feedback", () => {
  const bug = { kind: "Bug" as const, message: "Broken image", email: "" };

  function fakes(consent: "granted" | "denied" | null, status = 200) {
    const captured: [string, Record<string, unknown>][] = [];
    const posted: { url: string; body: unknown }[] = [];
    let sdkLoads = 0;
    const deps: SendDeps = {
      consent,
      survey,
      apiKey: "phc_test",
      host: "https://eu.i.posthog.com",
      newId: () => "anon-1",
      posthog: async () => {
        sdkLoads++;
        return { capture: (event: string, props: Record<string, unknown>) => void captured.push([event, props]) };
      },
      fetch: async (url: string, init: { body: string }) => {
        posted.push({ url, body: JSON.parse(init.body) });
        return { ok: status < 400 };
      },
    };
    return { deps, captured, posted, sdkLoads: () => sdkLoads };
  }

  it("with analytics accepted, goes through PostHog so it's linked to the session", async () => {
    const f = fakes("granted");
    expect(await sendFeedback(bug, f.deps)).toEqual({ ok: true });
    expect(f.captured).toEqual([["survey sent", expect.objectContaining({ $survey_id: "survey-1", "$survey_response_q-message": "Broken image" })]]);
    expect(f.posted).toEqual([]);
  });

  it.each(["denied", null] as const)("with analytics %s, sends one anonymous event without loading PostHog", async (consent) => {
    const f = fakes(consent);
    expect(await sendFeedback(bug, f.deps)).toEqual({ ok: true });
    expect(f.sdkLoads()).toBe(0);
    expect(f.posted).toEqual([
      {
        url: "https://eu.i.posthog.com/i/v0/e/",
        body: {
          api_key: "phc_test",
          event: "survey sent",
          distinct_id: "anon-1",
          properties: expect.objectContaining({ $survey_id: "survey-1", "$survey_response_q-kind": "Bug", $process_person_profile: false }),
        },
      },
    ]);
  });

  it("with analytics accepted but PostHog blocked from loading, still sends it anonymously", async () => {
    const f = fakes("granted");
    f.deps.posthog = async () => null;
    expect(await sendFeedback(bug, f.deps)).toEqual({ ok: true });
    expect(f.posted).toHaveLength(1);
  });

  it("says so when PostHog refuses it or the network is down", async () => {
    const refused = fakes(null, 500);
    expect(await sendFeedback(bug, refused.deps)).toEqual({ ok: false, error: "Couldn't send your feedback. Check your connection and try again." });
    const offline = fakes(null);
    offline.deps.fetch = async () => { throw new TypeError("Failed to fetch"); };
    expect(await sendFeedback(bug, offline.deps)).toEqual({ ok: false, error: "Couldn't send your feedback. Check your connection and try again." });
  });
});
