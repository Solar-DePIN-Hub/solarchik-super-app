(() => {
  // The static game loads its original Netlify bridge too. Keep any unrelated
  // game methods from it, but replace chat, voice and speech with this Vercel
  // bridge after the game bundle has loaded.
  const previous = window.SolarchikNative || {};
  const api = new URL("/api", location.origin).toString().replace(/\/$/, "");

  const reply = (requestId, data) => {
    try {
      window.SolarchikNativeReply(String(requestId), JSON.stringify(data));
    } catch (_) {
      // The game may already have left the room; nothing else is required.
    }
  };

  const locale = (value) => {
    const raw = String(value || navigator.language || "uk-UA");
    if (/^uk/i.test(raw)) return "uk-UA";
    if (/^ru/i.test(raw)) return "ru-RU";
    if (/^es/i.test(raw)) return "es-ES";
    return "en-US";
  };

  const speak = (text, requestedLocale) => {
    if (!text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(String(text));
      utterance.lang = locale(requestedLocale);
      utterance.rate = 1.03;
      const voice = window.speechSynthesis
        .getVoices()
        .find((item) => item.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2).toLowerCase()));
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    } catch (_) {
      // Text stays visible even on a browser that has no installed speech voice.
    }
  };

  const withTimeout = async (url, body, timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  async function ask(serialized, requestId) {
    try {
      const payload = typeof serialized === "string" ? JSON.parse(serialized) : serialized || {};
      const contents = Array.isArray(payload.contents) ? payload.contents : [];
      const latest = contents.at(-1) || {};
      const message = String(latest.parts?.[0]?.text || payload.message || "").trim();
      if (!message) return reply(requestId, { ok: false, error: "empty_message" });

      const history = contents
        .slice(0, -1)
        .map((entry) => ({
          role: entry.role === "model" ? "assistant" : "user",
          text: String(entry.parts?.[0]?.text || "").trim(),
        }))
        .filter((entry) => entry.text)
        .slice(-8);

      // The Worker performs a Featherless attempt followed by Gemini. Leave
      // enough time for the real second provider instead of cancelling it at
      // the old bridge's 5.5-second cutoff.
      const response = await withTimeout(`${api}/chat`, {
        message,
        history,
        language: locale(),
      }, 8000);
      const result = await response.json().catch(() => ({}));
      const text = String(result.reply || result.text || result.message || "").trim();
      reply(requestId, response.ok && text ? { ok: true, text } : {
        ok: false,
        error: result.error || "ai_unavailable",
      });
    } catch (error) {
      reply(requestId, { ok: false, error: error?.name === "AbortError" ? "timeout" : "network" });
    }
  }

  async function hear(audio, mime, requestId) {
    try {
      const base64 = String(audio || "").replace(/^data:[^,]*,/, "");
      if (!base64) return reply(requestId, { ok: false, error: "empty_audio" });
      const response = await withTimeout(`${api}/transcribe`, {
        audio: base64,
        mime: String(mime || "audio/webm"),
      }, 12000);
      const result = await response.json().catch(() => ({}));
      const text = String(result.text || "").trim();
      reply(requestId, response.ok && result.ok && text ? { ok: true, text} : {
        ok: false,
        error: result.error || "transcription_unavailable",
      });
    } catch (error) {
      reply(requestId, { ok: false, error: error?.name === "AbortError" ? "timeout" : "network" });
    }
  }

  window.SolarchikNative = {
    ...previous,
    ask,
    hear,
    speak,
    hush() {
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    },
  };

  document.addEventListener("pointerdown", () => {
    try { window.speechSynthesis?.getVoices(); } catch (_) {}
  }, { once: true, capture: true });
})();
