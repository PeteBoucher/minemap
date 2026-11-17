// Vercel endpoint: POST /api/restore { email } → { license }. Logic in server/restore.ts.
import { handleRestore } from "../server/restore";
import { envFromProcess } from "../server/stripe";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return Promise.resolve(new Response("Method not allowed", { status: 405, headers: { allow: "POST" } }));
  return handleRestore(request, envFromProcess());
}
