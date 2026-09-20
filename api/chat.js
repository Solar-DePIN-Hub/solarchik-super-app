const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const API_KEY = process.env.GEMINI_API_KEY;

const friendInstruction = [
  "You are Solarchik (Sol), a warm, witty AI companion in a cozy solar-powered game.",
  "Reply in the same language the player uses. Understand Ukrainian, English, Russian, and other languages naturally.",
  "Talk like a thoughtful friend, not like a robot, manual, or salesperson.",
  "Answer the player's actual message. Do not force solar energy, NFTs, or game advice into unrelated chat.",
  "Keep answers concise: usually one to three short natural sentences.",
  "Never reply with a fixed catchphrase like \"Hey — Sol here. Talk to me. I'm in your pocket.\"",
  "Do not claim to be human. Be honest when you do not know something.",
].join(" ");

function mapHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry) => {
      const text = String(entry?.text || entry?.parts?.[0]?.text || "").trim();
      if (!text) return null;
      const role =
        entry?.role === "assistant" || entry?.role === "model" ? "model" : "user";
      return { role, parts: [{ text }] };
    })
    .filter(Boolean)
    .slice(-12);
}

async function askGemini(message, history) {
  if (!API_KEY || API_KEY.includes("PASTE_")) {
    const error = new Error("missing_gemini_key");
    error.statusCode = 503;
    throw error;
  }

  const contents = [
    ...mapHistory(history),
    { role: "user", parts: [{ text: String(message) }] },
  ];

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: friendInstruction }] },
          contents,
          generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 512,
          },
        }),
        signal: AbortSignal.timeout(25000),
      });

      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        const reply = (body?.candidates?.[0]?.content?.parts || [])
          .map((part) => part.text || "")
          .join("")
          .trim();
        if (reply && reply.length >= 2) return reply;
        lastError = Object.assign(new Error("empty_gemini_reply"), { statusCode: 502 });
      } else {
        const retryable = [429, 500, 502, 503, 504].includes(response.status);
        lastError = Object.assign(
          new Error(`gemini_${response.status}`),
          {
            statusCode: response.status === 429 ? 429 : 502,
            publicMessage:
              response.status === 429 ? "provider_rate_limited" : "ai_provider_unavailable",
          },
        );
        if (!retryable || attempt === 2) throw lastError;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 2 || error?.statusCode === 429) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  throw lastError || Object.assign(new Error("gemini_failed"), { statusCode: 502 });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const incoming = request.body || {};
    const message = String(incoming.message || "").trim();
    if (!message || message.length > 2000) {
      return response.status(400).json({ error: "message_must_be_1_to_2000_characters" });
    }

    const reply = await askGemini(message, incoming.history);
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      ok: true,
      reply,
      provider: "gemini",
      fallback: false,
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    const status = error?.statusCode || 503;
    return response.status(status).json({
      ok: false,
      error: error?.publicMessage || error?.message || "ai_unavailable",
    });
  }
}
