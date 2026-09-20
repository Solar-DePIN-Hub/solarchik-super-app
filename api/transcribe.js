const WORKER_TRANSCRIBE_URL = "https://friend.solardepin.net/v1/transcribe";
const APP_ORIGIN = "https://solarchik-super-app.vercel.app";

export const config = { api: { bodyParser: { sizeLimit: "3mb" } } };

// Audio is sent straight through to Cloudflare for transcription. Neither
// Vercel nor the web app stores it.
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const upstream = await fetch(WORKER_TRANSCRIBE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APP_ORIGIN,
      },
      body: JSON.stringify(request.body || {}),
      signal: AbortSignal.timeout(10000),
    });
    const body = await upstream.text();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    return response.status(upstream.status).send(body);
  } catch (_) {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({ error: "transcription_unavailable" });
  }
}
