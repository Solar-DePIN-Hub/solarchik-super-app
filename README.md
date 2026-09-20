# Solarchik

**Warm voice AI companion inside a playable solar browser game.**

Talk in the room. Run the roofs together. Let Sol screen a call when you cannot.

Built for **MunichTech Open AI & DeepTech** — with an open-model path via **Featherless** (Best Featherless track).

---

## Try it

| | Link |
|---|---|
| **Live demo** | https://solarchik-super-app.vercel.app |
| **Demo video** | https://youtu.be/0kk81JAXtvI |
| **Call-assistant demo** | https://solar-screen-demo.netlify.app |

> Use **Chrome/Edge** for best mic + TTS. Allow microphone when prompted. Prefer **English** for the hackathon demo (Ukrainian still works).

---

## What it is

One character — **Sol** — three modes:

1. **Friend** — room chat by voice or text (hold-to-talk mic, on-device TTS)
2. **Runner** — solar roof-run with mid-game banter
3. **Secretary** — AI call assistant (who called / why / next action); Android path works, phone-number docs are the last step

---

## Stack

| Layer | Tech |
|---|---|
| App | React / HTML game shell on **Vercel** |
| Chat API | Serverless `api/chat.js` (keys stay on server) |
| Open models | **Featherless** — OpenAI-compatible, default `Qwen/Qwen2.5-7B-Instruct` |
| Fallback | **Gemini** for resilient / higher-quality replies when needed |
| Voice | Browser **Web Speech API** (STT + TTS on-device) |

Architecture sketch:

```
Player mic / text
      │
      ▼
 Web Speech STT (on-device)
      │
      ▼
 Vercel  /api/chat
   ├─ Featherless (open weights)  ← Best Featherless path
   └─ Gemini (fallback)
      │
      ▼
 Web Speech TTS + captions
```

---

## Repo layout

```
api/chat.js      # serverless chat (Featherless + Gemini)
index.html       # shell, yard layout, booth shortcuts
web-native.js    # hold-to-talk mic + TTS helpers
vercel.json      # rewrites / asset proxies
```

Game assets for the yard / booth are served via Vercel rewrites from the friend Netlify origin.

---

## Local / env

On Vercel (Production), set at least:

- `FEATHERLESS_API_KEY`
- `FEATHERLESS_MODEL` (optional; default `Qwen/Qwen2.5-7B-Instruct`)
- `GEMINI_API_KEY` (or your existing Gemini key name)

Never put provider keys in client JS.

---

## For judges

1. Open the **live demo** and talk to Sol (Friend) or run a roof.
2. Watch the **~1:20 film**: https://youtu.be/0kk81JAXtvI
3. Check **Featherless** in the stack (`api/chat.js` + env) for Best Featherless.
4. Optional: open the **call-assistant** demo from Secretary / Play Demo.

---

## Team

**Solar DePin · Vadym · Ukraine**

MunichTech EXPO — Open AI & DeepTech Grand Challenge
