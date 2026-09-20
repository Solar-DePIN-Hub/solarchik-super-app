/* Vercel bridge for Solarchik CLOCK IN. API credentials never enter the browser. */
(() => {
  const CHAT_URL = "https://friend.solardepin.net/v1/chat";
  let activeSpeech = null;

  const reply = (id, data) => {
    try { window.SolarchikNativeReply(String(id), JSON.stringify(data)); } catch (_) {}
  };

  const locale = (value) => {
    const raw = String(value || navigator.language || "uk-UA");
    if (/^uk/i.test(raw)) return "uk-UA";
    if (/^ru/i.test(raw)) return "ru-RU";
    if (/^es/i.test(raw)) return "es-ES";
    return "en-US";
  };

  function speak(text, requestedLocale) {
    const message = String(text || "").trim();
    if (!message || !window.speechSynthesis) return;
    try { speechSynthesis.cancel(); } catch (_) {}
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = locale(requestedLocale);
    utterance.rate = 1.03;
    const wanted = utterance.lang.slice(0, 2).toLowerCase();
    const voice = speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(wanted));
    if (voice) utterance.voice = voice;
    activeSpeech = utterance;
    try { speechSynthesis.speak(utterance); } catch (_) {}
  }

  async function ask(serialized, id) {
    try {
      const source = typeof serialized === "string" ? JSON.parse(serialized) : (serialized || {});
      const contents = Array.isArray(source.contents) ? source.contents : [];
      const last = contents.at(-1) || {};
      const message = String(last.parts?.[0]?.text || source.message || "").trim();
      if (!message) return reply(id, { ok: false, error: "empty_message" });
      const history = contents.slice(0, -1).map((turn) => ({
        role: turn.role === "model" ? "assistant" : "user",
        text: String(turn.parts?.[0]?.text || "").trim(),
      })).filter((turn) => turn.text).slice(-8);
      const controller = new AbortController();
      // The Worker has its own provider timeout. This just prevents a browser
      // from sitting on a dead connection for too long.
      const timeout = setTimeout(() => controller.abort(), 5500);
      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, language: locale() }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await response.json().catch(() => ({}));
      const text = String(body.reply || body.text || body.message || "").trim();
      if (response.ok && text) return reply(id, { ok: true, text });
      reply(id, { ok: false, error: body.error || "ai_unavailable" });
    } catch (error) {
      reply(id, { ok: false, error: error?.name === "AbortError" ? "timeout" : "network" });
    }
  }

  // Voice recognition stays inside the game bundle. It directly uses
  // Chrome's SpeechRecognition and its browser fallback on Android.
  window.SolarchikNative = {
    ask,
    speak,
    hush() { try { speechSynthesis.cancel(); } catch (_) {} },
  };

  document.addEventListener("pointerdown", () => {
    try { speechSynthesis.getVoices(); } catch (_) {}
  }, { once: true, capture: true });
})();
