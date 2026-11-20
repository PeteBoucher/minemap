// The unlock dialog: shown when a free limit is reached, and after returning from payment.
import { FREE, type LimitReason } from "../core/license";
import { PAYMENT_LINK, claimSession, isUnlocked, restoreByEmail, unlockConfigured } from "../store/unlock";
import { h } from "./dom";

const WHY: Record<LimitReason, string> = {
  worlds: `The free version keeps ${FREE.worlds} world of your own (plus the demo).`,
  places: `The free version saves up to ${FREE.places} places per world.`,
  maps: `The free version lines up ${FREE.maps} map screenshots per world.`,
  backup: "Backing up and restoring worlds is part of the full version.",
};

function dialog(): HTMLDialogElement {
  let d = document.getElementById("unlockDlg") as HTMLDialogElement | null;
  if (!d) {
    d = h("dialog", { id: "unlockDlg" });
    d.setAttribute("aria-label", "Unlock Minemap");
    document.body.append(d);
  }
  return d;
}

/**
 * True if the app is unlocked. Otherwise explains the limit and offers to unlock; resolves true only
 * if the user unlocks (by restoring a purchase) before closing the dialog.
 */
export async function requireUnlock(reason: LimitReason): Promise<boolean> {
  if (await isUnlocked()) return true;
  const d = dialog();
  return new Promise((resolve) => {
    const status = h("p", { className: "status", role: "status" });
    const email = h("input", { type: "email", placeholder: "Email you paid with", autocomplete: "email" });
    email.setAttribute("aria-label", "Email you paid with");
    const restoreBtn = h("button", { type: "submit", className: "btn ghost", textContent: "Restore" });
    const restore = h("form", { className: "restore" }, email, restoreBtn);
    const close = h("button", { type: "button", className: "btn ghost", textContent: "Not now" });
    const buy = h("a", { className: "btn", textContent: "Unlock for $5", href: PAYMENT_LINK || "#", rel: "noopener" });

    if (!unlockConfigured()) {
      buy.setAttribute("aria-disabled", "true");
      buy.onclick = (e) => e.preventDefault();
      status.textContent = "Unlocking isn't set up on this copy of Minemap yet.";
    }
    restore.onsubmit = async (e) => {
      e.preventDefault();
      restoreBtn.disabled = true;
      status.textContent = "Checking…";
      try {
        await restoreByEmail(email.value);
        finish(true);
      } catch (err) {
        status.textContent = (err as Error).message;
        restoreBtn.disabled = false;
      }
    };
    const finish = (ok: boolean) => { d.onclose = null; d.close(); resolve(ok); };
    close.onclick = () => finish(false);
    d.onclose = () => resolve(false);

    d.replaceChildren(
      h("h2", {}, "UNLOCK MINEMAP"),
      h("p", {}, WHY[reason]),
      h("ul", { className: "perks" },
        h("li", {}, "Unlimited worlds, places and map screenshots"),
        h("li", {}, "Back up worlds and move them between devices"),
        h("li", {}, "One payment of $5, no subscription")),
      status,
      h("menu", {}, close, buy),
      h("details", { className: "already" }, h("summary", {}, "Already paid on another device?"), restore),
    );
    if (!d.open) d.showModal();
  });
}

/** Handle the return from Stripe (?session_id=…): claim the licence and say thanks. */
export async function handlePaymentReturn(): Promise<void> {
  const url = new URL(location.href), sid = url.searchParams.get("session_id");
  if (!sid) return;
  url.searchParams.delete("session_id");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  const d = dialog(), status = h("p", { className: "status", role: "status", textContent: "Confirming your payment…" });
  const ok = h("button", { type: "button", className: "btn", textContent: "OK" });
  ok.onclick = () => d.close();
  d.replaceChildren(h("h2", {}, "UNLOCK MINEMAP"), status, h("menu", {}, ok));
  d.showModal();
  try {
    await claimSession(sid);
    status.textContent = "Unlocked — thank you! Everything is available on this device now.";
  } catch (err) {
    status.textContent = `${(err as Error).message} If you were charged, use “Already paid on another device?” with your email, or get in touch.`;
  }
}
