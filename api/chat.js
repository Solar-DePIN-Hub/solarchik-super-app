const AI_CHAT_URL = "https://ai.solardepin.net/v1/chat";

// Browser talks only to this Vercel origin. We proxy to the Gemini AI server
// without forwarding Origin — ai.solardepin.net rejects unknown browser
// origins, and friend.solardepin.net was returning truncated Gemini replies.
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const incoming = request.body || {};
    const upstream = await fetch(AI_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: incoming.message,
        conversationId: incoming.conversationId,
        history: incoming.history,
        language: incoming.language,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const raw = await upstream.text();
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = {};
    }

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");

    if (!upstream.ok) {
      return response.status(upstream.status).send(raw);
    }

    const reply = String(parsed.reply || "").trim();
    if (!reply) {
      return response.status(502).json({ ok: false, error: "ai_provider_returned_no_text" });
    }

    return response.status(200).json({
      ok: true,
      reply,
      conversationId: parsed.conversationId,
      provider: "gemini",
      fallback: false,
    });
  } catch (_) {
    response.setHeader("Cache-Control", "no-store");
    return response.status(503).json({ error: "ai_unavailable" });
  }
}
