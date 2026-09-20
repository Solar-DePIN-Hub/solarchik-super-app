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
      // Prefer clear English neural / known-good voices; avoid robotic desktop defaults.
      if (/google us english|google uk english female|microsoft aria|microsoft jenny|microsoft guy|samantha|karen|moira|daniel/.test(id)) s += 12;
      if (/neural|natural|online|premium|enhanced|wavenet/.test(id)) s += 6;
      if (/google|microsoft/.test(id)) s += 3;
      if (/zira|david|mark|susan|hazel/.test(id)) s -= 4;
      if (v.localService === false) s += 2;
      return s;
    };
    return [...voices].sort((a, b) => score(b) - score(a))[0] || null;
  };

  const cleanForSpeech = (text) =>
    String(text || "")
      .replace(/[*_`#~>\[\]()]/g, " ")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  const splitSentences = (text) => {
    const parts = String(text)
      .match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
      ?.map((p) => p.trim())
      .filter(Boolean);
    return parts && parts.length ? parts : [text];
  };

  let lastSpoken = { text: "", at: 0 };
  let speakQueueToken = 0;

  const speak = (text, requestedLocale) => {
    const cleaned = cleanForSpeech(text);
    if (!cleaned || !window.speechSynthesis) return false;
    const now = Date.now();
    if (cleaned === lastSpoken.text && now - lastSpoken.at < 1800) return false;
    lastSpoken = { text: cleaned, at: now };

    try {
      unlockSpeech();
      window.speechSynthesis.cancel();
      const lang = locale(requestedLocale) || demoLang;
      const voice = pickVoice(lang);
      const chunks = splitSentences(cleaned).slice(0, 4);
      const token = ++speakQueueToken;

      const speakNext = (index) => {
        if (token !== speakQueueToken || index >= chunks.length) return;
        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = lang;
        utterance.rate = 0.94;
        utterance.pitch = 1.0;
        utterance.volume = 1;
        if (voice) utterance.voice = voice;
        utterance.onend = () => speakNext(index + 1);
        utterance.onerror = () => speakNext(index + 1);
        try {
          window.speechSynthesis.speak(utterance);
        } catch (_) {}
      };

      const start = () => {
        if (token !== speakQueueToken) return;
        speakNext(0);
      };

      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) {
        window.speechSynthesis.addEventListener("voiceschanged", start, { once: true });
        window.setTimeout(start, 180);
      } else {
        // Chrome often drops the first speak() right after cancel().
        window.setTimeout(start, 80);
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
      // Do NOT speak here — the game calls SolarchikNative.speak once after reply.
      reply(requestId, { ok: true, text });
    } catch (error) {
      const text = "I glitched for a second. Say that again — I'm here.";
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

    if (listenSession) {
      try {
        listenSession.holding = false;
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
    let finals = "";
    let interim = "";
    let recognition;
    const lang = "en-US";

    const readTranscript = () => `${finals} ${interim}`.replace(/\s+/g, " ").trim();

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
        let nextInterim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) continue;
          let best = "";
          let bestConf = -1;
          for (let a = 0; a < result.length; a += 1) {
            const alt = result[a];
            const conf = typeof alt?.confidence === "number" ? alt.confidence : 0;
            const piece = String(alt?.transcript || "");
            if (piece && conf >= bestConf) {
              best = piece;
              bestConf = conf;
            }
          }
          if (!best) best = String(result[0]?.transcript || "");
          if (result.isFinal) {
            finals = `${finals} ${best}`.replace(/\s+/g, " ").trim();
            interim = "";
          } else {
            nextInterim += best;
          }
        }
        if (nextInterim) interim = nextInterim.trim();
      };

      recognition.onerror = (event) => {
        const code = String(event?.error || "speech_error");
        if (code === "no-speech" || code === "aborted" || code === "audio-capture") return;
        if (code === "not-allowed" || code === "service-not-allowed") {
          finish({ ok: false, error: "mic_blocked" });
        }
      };

      recognition.onend = () => {
        // Chrome ends continuous sessions between phrases; restart while still held.
        if (
          !settled &&
          listenSession &&
          listenSession.holding &&
          listenSession.requestId === String(requestId)
        ) {
          try {
            recognition.start();
          } catch (_) {}
        }
      };

      listenSession = {
        requestId: String(requestId),
        recognition,
        finish,
        getTranscript: readTranscript,
        startedAt: Date.now(),
        holding: true,
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

    session.holding = false;
    try {
      session.recognition.stop();
    } catch (_) {}

    if (heldMs < 280) {
      finish({ ok: false, error: "no_speech" });
      return;
    }

    // Always wait for Chrome to promote the last interim ("how are" -> "how are you").
    window.setTimeout(() => {
      const late = read();
      finish(late ? { ok: true, text: late } : { ok: false, error: "no_speech" });
    }, 550);
  }

  window.SolarchikNative = {
    ...previous,
    ask,
    hear,
    listen,
    stopListen,
    speak,
    hush() {
      speakQueueToken += 1;
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
