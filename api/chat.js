const WORKER_CHAT_URL = "https://friend.solardepin.net/v1/chat";
const APP_ORIGIN = "https://solarchik-super-app.vercel.app";

// The browser talks only to its own Vercel origin. This removes dependency on
// browser extensions accepting the Worker hostname and keeps all AI secrets in
// Cloudflare, where they already live.
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const upstream = await fetch(WORKER_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APP_ORIGIN,
      },
      body: JSON.stringify(request.body || {}),
      signal: AbortSignal.timeout(9000),
    });
    const body = await upstream.text();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.status(upstream.status).send(body);
  } catch (_) {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({ error: "ai_unavailable" });
  }
}
