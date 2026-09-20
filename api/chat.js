const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const FEATHERLESS_KEY = process.env.FEATHERLESS_API_KEY;
const FEATHERLESS_MODEL =
  process.env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-14B-Instruct";

const friendInstruction = [
  "You are Solarchik (Sol), a warm, witty AI companion in a cozy solar-powered game.",
  "Reply in the same language the player uses. Understand Ukrainian, English, Russian, and other languages naturally.",
  "When the player writes Ukrainian, reply in clear correct Ukrainian with no typos and no Russian mixed in. Prefer short natural spoken sentences that sound good when read aloud. Never use the English catchphrase about being in the pocket.",
  "Talk like a thoughtful friend, not like a robot, manual, or salesperson.",
  "Answer the player's actual message. Do not force solar energy, NFTs, or game advice into unrelated chat.",
  "Keep answers concise: usually one to three short natural sentences.",
  "Never reply with a fixed catchphrase like \"Hey — Sol here. Talk to me. I'm in your pocket.\"",
  "Do not claim to be human. Be honest when you do not know something.",
].join(" ");

function mapHistoryForGemini(history) {
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

function mapHistoryForFeatherless(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry) => {
      const text = String(entry?.text || entry?.parts?.[0]?.text || "").trim();
      if (!text) return null;
      const role =
        entry?.role === "model" || entry?.role === "assistant"
          ? "assistant"
          : "user";
      return { role, content: text };
    })
    .filter(Boolean)
    .slice(-12);
}

async function askFeatherless(message, history) {
  if (!FEATHERLESS_KEY) {
    const error = new Error("missing_featherless_key");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch("https://api.featherless.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FEATHERLESS_KEY}`,
      "HTTP-Referer": "https://solarchik-super-app.vercel.app",
      "X-Title": "Solarchik",
      // Cloudflare on Featherless blocks empty/bot UAs from some hosts (error 1010).
      "User-Agent":
        "Mozilla/5.0 (compatible; Solarchik/1.0; +https://solarchik-super-app.vercel.app)",
    },
    body: JSON.stringify({
      model: FEATHERLESS_MODEL,
      temperature: 0.9,
      max_tokens: 220,
      messages: [
        { role: "system", content: friendInstruction },
        ...mapHistoryForFeatherless(history),
        { role: "user", content: String(message) },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`featherless_${response.status}`);
    error.statusCode = response.status === 429 ? 429 : 502;
    error.publicMessage =
      response.status === 429 ? "provider_rate_limited" : "ai_provider_unavailable";
    throw error;
  }

  const reply = String(body?.choices?.[0]?.message?.content || "").trim();
  if (!reply || reply.length < 2) {
    const error = new Error("empty_featherless_reply");
    error.statusCode = 502;
    throw error;
  }
  return reply;
}

async function askGemini(message, history) {
  if (!GEMINI_KEY || GEMINI_KEY.includes("PASTE_")) {
    const error = new Error("missing_gemini_key");
    error.statusCode = 503;
    throw error;
  }

  const models = [
    GEMINI_MODEL,
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
  ].filter((value, index, list) => value && list.indexOf(value) === index);

  let lastError;
  for (const model of models) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: friendInstruction }] },
          contents: [
            ...mapHistoryForGemini(history),
            { role: "user", parts: [{ text: String(message) }] },
          ],
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
        if (reply && reply.length >= 2) return { reply, model };
        lastError = Object.assign(new Error("empty_gemini_reply"), { statusCode: 502 });
        continue;
      }

      lastError = Object.assign(new Error(`gemini_${response.status}`), {
        statusCode: response.status === 429 ? 429 : 502,
        publicMessage:
          response.status === 429 ? "provider_rate_limited" : "ai_provider_unavailable",
      });
      if (response.status !== 429 && response.status !== 404) break;
    } catch (error) {
      lastError = error;
    }
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

    response.setHeader("Cache-Control", "no-store");

    // Featherless first = Best Featherless prize eligibility + reliable chat.
    if (FEATHERLESS_KEY) {
      try {
        const reply = await askFeatherless(message, incoming.history);
        return response.status(200).json({
          ok: true,
          reply,
          provider: "featherless",
          model: FEATHERLESS_MODEL,
          fallback: false,
        });
      } catch (_) {
        // Fall through to Gemini.
      }
    }

    const gemini = await askGemini(message, incoming.history);
    return response.status(200).json({
      ok: true,
      reply: gemini.reply,
      provider: "gemini",
      model: gemini.model,
      fallback: Boolean(FEATHERLESS_KEY),
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    const status = error?.statusCode || 503;
    // Soft Ukrainian recovery text so the game does not show the English catchphrase.
    if (status === 429) {
      return response.status(200).json({
        ok: true,
        reply: "Я трохи перевантажений зараз. Напиши ще раз за мить — я тут.",
        provider: "soft_fallback",
        fallback: true,
      });
    }
    return response.status(status).json({
      ok: false,
      error: error?.publicMessage || error?.message || "ai_unavailable",
    });
  }
}
