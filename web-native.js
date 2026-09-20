(() => {
  const previous = window.SolarchikNative || {};
  const api = new URL("/api", location.origin).toString().replace(/\/$/, "");

  const reply = (requestId, data) => {
    try {
      window.SolarchikNativeReply(String(requestId), JSON.stringify(data));
    } catch (_) {}
  };

  // Hackathon demo: prefer English speech recognition + TTS.
  const demoLang = "en-US";

  const locale = (value) => {
    const raw = String(value || "");
    if (/^(eve|rex|leo|ara|sunny|dry)$/i.test(raw)) return demoLang;
    if (/^uk/i.test(raw)) return "uk-UA";
    if (/^ru/i.test(raw)) return "ru-RU";
    if (/^es/i.test(raw)) return "es-ES";
    if (/^en/i.test(raw)) return "en-US";
    return demoLang;
  };

  const unlockSpeech = () => {
    try {
      window.speechSynthesis?.getVoices();
      if (!window.__solarchikSpeechUnlocked && window.speechSynthesis) {
        const warm = new SpeechSynthesisUtterance(" ");
        warm.volume = 0;
        window.speechSynthesis.speak(warm);
        window.speechSynthesis.cancel();
        window.__solarchikSpeechUnlocked = true;
      }
    } catch (_) {}
  };

  const pickVoice = (lang) => {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (!voices.length) return null;
    const prefix = lang.slice(0, 2).toLowerCase();
    const score = (v) => {
      let s = 0;
      const id = `${v.name} ${v.lang}`.toLowerCase();
      if (v.lang.toLowerCase().startsWith(prefix)) s += 10;
      if (v.lang.toLowerCase() === lang.toLowerCase()) s += 5;
      if (/neural|natural|online|premium|google|microsoft|samantha|aria|jenny/.test(id)) s += 4;
      if (v.localService === false) s += 1;
      return s;
    };
    return [...voices].sort((a, b) => score(b) - score(a))[0] || null;
  };

  const speak = (text, requestedLocale) => {
    if (!text || !window.speechSynthesis) return false;
    try {
      unlockSpeech();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(String(text));
      const lang = locale(requestedLocale) || demoLang;
      utterance.lang = lang;
      utterance.rate = 1.0;
      utterance.pitch = 1.05;
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
      const start = () => {
        try { window.speechSynthesis.speak(utterance); } catch (_) {}
      };
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) {
        window.speechSynthesis.addEventListener("voiceschanged", start, { once: true });
        window.setTimeout(start, 150);
      } else {
        window.setTimeout(start, 40);
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

      const response = await withTimeout(
        `${api}/chat`,
        { message, history, language: "en" },
        20000,
      );
      const result = await response.json().catch(() => ({}));
      let text = String(result.reply || result.text || result.message || "").trim();
      if (!response.ok || !text) {
        text = "I glitched for a second. Say that again — I'm here.";
      }
      speak(text, "en-US");
      reply(requestId, { ok: true, text });
    } catch (error) {
      const text = "I glitched for a second. Say that again — I'm here.";
      speak(text, "en-US");
      reply(requestId, { ok: true, text });
    }
  }

  async function hear(audio, mime, requestId) {
    try {
      const base64 = String(audio || "").replace(/^data:[^,]*,/, "");
      if (!base64) return reply(requestId, { ok: false, error: "empty_audio" });
      const response = await withTimeout(
        `${api}/transcribe`,
        { audio: base64, mime: String(mime || "audio/webm") },
        15000,
      );
      const result = await response.json().catch(() => ({}));
      const text = String(result.text || "").trim();
      reply(
        requestId,
        response.ok && result.ok && text
          ? { ok: true, text }
          : { ok: false, error: result.error || "transcription_unavailable" },
      );
    } catch (error) {
      reply(requestId, {
        ok: false,
        error: error?.name === "AbortError" ? "timeout" : "network",
      });
    }
  }

  let listenSession = null;

  const warmMic = () => {
    try {
      navigator.mediaDevices
        ?.getUserMedia?.({ audio: true })
        .then((stream) => {
          try { stream.getTracks().forEach((track) => track.stop()); } catch (_) {}
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

    if (listenSession) {
      try {
        listenSession.recognition.onresult = null;
        listenSession.recognition.onerror = null;
        listenSession.recognition.onend = null;
        listenSession.recognition.stop();
      } catch (_) {}
      try { listenSession.finish({ ok: false, error: "aborted" }); } catch (_) {}
      listenSession = null;
    }

    warmMic();

    let settled = false;
    let transcript = "";
    let recognition;
    const lang = "en-US";

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
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 3;

      recognition.onresult = (event) => {
        let text = "";
        for (let i = 0; i < event.results.length; i += 1) {
          text += event.results[i]?.[0]?.transcript || "";
        }
        transcript = String(text).trim();
      };

      recognition.onerror = (event) => {
        const code = String(event?.error || "speech_error");
        if (code === "no-speech" || code === "aborted" || code === "audio-capture") return;
        if (code === "not-allowed" || code === "service-not-allowed") {
          finish({ ok: false, error: "mic_blocked" });
        }
      };

      recognition.onend = () => {
        if (!settled && listenSession && listenSession.requestId === String(requestId)) {
          try { recognition.start(); } catch (_) {}
        }
      };

      listenSession = {
        requestId: String(requestId),
        recognition,
        finish,
        getTranscript: () => transcript,
        startedAt: Date.now(),
      };
      recognition.start();
    } catch (error) {
      finish({ ok: false, error: String(error?.message || "speech_start_failed") });
    }
  }

  function stopListen() {
    if (!listenSession) return;
    const session = listenSession;
    const finish = session.finish;
    const heldMs = Date.now() - (session.startedAt || Date.now());
    const read = () => String(session.getTranscript() || "").trim();
    try { session.recognition.stop(); } catch (_) {}
    const text = read();
    if (text) {
      finish({ ok: true, text });
      return;
    }
    if (heldMs < 350) {
      finish({ ok: false, error: "no_speech" });
      return;
    }
    window.setTimeout(() => {
      const late = read();
      finish(late ? { ok: true, text: late } : { ok: false, error: "no_speech" });
    }, 320);
  }

  window.SolarchikNative = {
    ...previous,
    ask,
    hear,
    listen,
    stopListen,
    speak,
    hush() {
      try { window.speechSynthesis?.cancel(); } catch (_) {}
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
