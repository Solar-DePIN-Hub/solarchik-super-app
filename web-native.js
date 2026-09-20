(() => {
  // Keep any unrelated game methods from a prior Netlify bridge, but own chat,
  // mic, and speech so they stay on this Vercel origin.
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
    if (/^en/i.test(raw)) return "en-US";
    // Voice names like eve/rex/leo are not locales — fall back to browser language.
    if (/^(eve|rex|leo|ara|sunny|dry)$/i.test(raw)) {
      return locale(navigator.language || "uk-UA");
    }
    return "en-US";
  };

  const unlockSpeech = () => {
    try {
      window.speechSynthesis?.getVoices();
      // Some Chromium builds stay silent until a no-op utterance runs after a gesture.
      if (!window.__solarchikSpeechUnlocked && window.speechSynthesis) {
        const warm = new SpeechSynthesisUtterance(" ");
        warm.volume = 0;
        window.speechSynthesis.speak(warm);
        window.speechSynthesis.cancel();
        window.__solarchikSpeechUnlocked = true;
      }
    } catch (_) {}
  };

  const speak = (text, requestedLocale) => {
    if (!text || !window.speechSynthesis) return false;
    try {
      unlockSpeech();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(String(text));
      utterance.lang = locale(requestedLocale);
      utterance.rate = 1.03;
      const voices = window.speechSynthesis.getVoices() || [];
      const prefix = utterance.lang.slice(0, 2).toLowerCase();
      const voice =
        voices.find((item) => item.lang.toLowerCase().startsWith(prefix)) ||
        voices.find((item) => item.default) ||
        voices[0];
      if (voice) utterance.voice = voice;
      const start = () => {
        try {
          window.speechSynthesis.speak(utterance);
        } catch (_) {}
      };
      if (!voices.length) {
        window.speechSynthesis.addEventListener("voiceschanged", start, { once: true });
        window.setTimeout(start, 120);
      } else {
        window.setTimeout(start, 30);
      }
      return true;
    } catch (_) {
      return false;
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

      const response = await withTimeout(`${api}/chat`, {
        message,
        history,
        language: locale(),
      }, 20000);
      const result = await response.json().catch(() => ({}));
      const text = String(result.reply || result.text || result.message || "").trim();
      if (response.ok && text) {
        speak(text, locale());
        reply(requestId, { ok: true, text });
      } else {
        reply(requestId, {
          ok: false,
          error: result.error || "ai_unavailable",
        });
      }
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
      }, 15000);
      const result = await response.json().catch(() => ({}));
      const text = String(result.text || "").trim();
      reply(requestId, response.ok && result.ok && text ? { ok: true, text } : {
        ok: false,
        error: result.error || "transcription_unavailable",
      });
    } catch (error) {
      reply(requestId, { ok: false, error: error?.name === "AbortError" ? "timeout" : "network" });
    }
  }

  // Hold-to-talk session. The game calls listen() on pointerdown and
  // stopListen() on pointerup (via SolarchikNative.stopListen).
  let listenSession = null;

  const warmMic = () => {
    try {
      navigator.mediaDevices
        ?.getUserMedia?.({ audio: true })
        .then((stream) => {
          try {
            stream.getTracks().forEach((track) => track.stop());
          } catch (_) {}
        })
        .catch(() => {});
    } catch (_) {}
  };

  function listen(requestId, localeHint) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      reply(requestId, { ok: false, error: "no_speech_recognition" });
      return;
    }

    // Replace any prior session.
    if (listenSession) {
      try {
        listenSession.recognition.onresult = null;
        listenSession.recognition.onerror = null;
        listenSession.recognition.onend = null;
        listenSession.recognition.stop();
      } catch (_) {}
      try {
        listenSession.finish({ ok: false, error: "aborted" });
      } catch (_) {}
      listenSession = null;
    }

    warmMic();

    let settled = false;
    let transcript = "";
    let recognition;

    const finish = (data) => {
      if (settled) return;
      settled = true;
      if (listenSession && listenSession.requestId === String(requestId)) {
        listenSession = null;
      }
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop();
      } catch (_) {}
      reply(requestId, data);
    };

    try {
      recognition = new SR();
      recognition.lang = locale(localeHint);
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        let text = "";
        for (let i = 0; i < event.results.length; i += 1) {
          text += event.results[i]?.[0]?.transcript || "";
        }
        transcript = String(text).trim();
      };

      recognition.onerror = (event) => {
        const code = String(event?.error || "speech_error");
        // Soft errors while still holding — keep waiting for stopListen.
        if (code === "no-speech" || code === "aborted" || code === "audio-capture") {
          return;
        }
        if (code === "not-allowed" || code === "service-not-allowed") {
          finish({ ok: false, error: "mic_blocked" });
        }
      };

      recognition.onend = () => {
        // Chrome ends continuous sessions between phrases; restart while held.
        if (!settled && listenSession && listenSession.requestId === String(requestId)) {
          try {
            recognition.start();
          } catch (_) {
            // Will be finalized by stopListen or timeout in the game.
          }
        }
      };

      listenSession = {
        requestId: String(requestId),
        recognition,
        finish,
        getTranscript: () => transcript,
      };
      recognition.start();
    } catch (error) {
      finish({ ok: false, error: String(error?.message || "speech_start_failed") });
    }
  }

  function stopListen() {
    if (!listenSession) return;
    const text = String(listenSession.getTranscript() || "").trim();
    const finish = listenSession.finish;
    try {
      listenSession.recognition.stop();
    } catch (_) {}
    finish(text ? { ok: true, text } : { ok: false, error: "no_speech" });
  }

  window.SolarchikNative = {
    ...previous,
    ask,
    hear,
    listen,
    stopListen,
    speak,
    hush() {
      try {
        window.speechSynthesis?.cancel();
      } catch (_) {}
    },
  };

  const unlock = () => unlockSpeech();
  document.addEventListener("pointerdown", unlock, { capture: true });
  document.addEventListener("keydown", unlock, { capture: true });
  document.addEventListener("touchstart", unlock, { capture: true });
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", unlockSpeech);
  }
})();
