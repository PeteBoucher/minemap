// Vercel endpoint: GET /api/unlock?session_id=cs_… → { license }. Logic in server/unlock.ts.
import { envFromProcess } from "../server/stripe";
import { handleUnlock } from "../server/unlock";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return Promise.resolve(new Response("Method not allowed", { status: 405, headers: { allow: "GET" } }));
  return handleUnlock(request, envFromProcess());
}
