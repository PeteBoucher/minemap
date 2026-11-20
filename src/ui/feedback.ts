// The feedback dialog (#14): report a bug or ask for a feature. Responses go to the "Feedback" API survey in PostHog.
import { type FeedbackKind, type FeedbackSurvey, sendFeedback } from "../core/feedback";
import { currentConsent, posthogTarget, runningPostHog } from "./analytics";

/** The "Feedback" survey in PostHog (EU), type api. Its question ids key the responses, so keep them in step. */
const SURVEY: FeedbackSurvey = {
  id: "01a1f818-4fa4-0000-d403-292a265f7561",
  questions: {
    kind: { id: "094f3d15-531b-40ca-88d1-8ae415279c1a", question: "What kind of feedback?" },
    message: { id: "2cb0b95e-c1b9-4ac0-80e4-8e562e7b0337", question: "Message" },
    email: { id: "65fc47c4-4ba6-411e-8a81-e8ce63277839", question: "Email (optional, for a reply)" },
  },
};

const KINDS: FeedbackKind[] = ["Bug", "Feature request", "Other"];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

function dialog(): HTMLDialogElement {
  let d = document.getElementById("feedbackDlg") as HTMLDialogElement | null;
  if (!d) {
    d = h("dialog", { id: "feedbackDlg" });
    d.setAttribute("aria-label", "Send feedback");
    document.body.append(d);
  }
  return d;
}

export function openFeedback(): void {
  const d = dialog();
  const kinds = KINDS.map((k, i) =>
    h("label", {}, h("input", { type: "radio", name: "fbKind", value: k, checked: i === 0 }), ` ${k}`));
  const message = h("textarea", { rows: 5, required: true, placeholder: "What happened, or what would you like?" });
  message.setAttribute("aria-label", "Message");
  const email = h("input", { type: "email", autocomplete: "email", placeholder: "Email (optional, if you'd like a reply)" });
  email.setAttribute("aria-label", "Email (optional)");
  const status = h("p", { className: "status", role: "status" });
  const cancel = h("button", { type: "button", className: "btn ghost", textContent: "Cancel" });
  const send = h("button", { type: "submit", className: "btn", textContent: "Send" });
  const form = h("form", { className: "fb" },
    h("fieldset", { className: "fb-kind" }, h("legend", { className: "sr" }, "Kind of feedback"), ...kinds),
    message, email,
    h("p", { className: "note" }, "Your message, and your email if you give it, are stored in PostHog (EU) so we can read and reply. If you accepted analytics, it's linked to your visit to help us find bugs."),
    status,
    h("menu", {}, cancel, send));

  cancel.onclick = () => d.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    send.disabled = true;
    status.textContent = "Sending…";
    const kind = (form.querySelector<HTMLInputElement>("input[name=fbKind]:checked")?.value ?? "Other") as FeedbackKind;
    const r = await sendFeedback({ kind, message: message.value, email: email.value }, {
      consent: currentConsent(),
      survey: SURVEY,
      ...posthogTarget,
      newId: () => crypto.randomUUID(),
      posthog: runningPostHog,
      fetch: (url, init) => fetch(url, { ...init, keepalive: true }),
    });
    if (!r.ok) { status.textContent = r.error; send.disabled = false; return; }
    const ok = h("button", { type: "button", className: "btn", textContent: "Close" });
    ok.onclick = () => d.close();
    d.replaceChildren(h("h2", {}, "FEEDBACK"), h("p", { className: "status", role: "status" }, "Thanks, it's sent."), h("menu", {}, ok));
    ok.focus();
  };

  d.replaceChildren(h("h2", {}, "FEEDBACK"), form);
  if (!d.open) d.showModal();
  message.focus();
}
