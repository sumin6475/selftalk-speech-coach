<div align="center">

# SelfTalk — Speech Coach

**A real-time voice coach that listens to you practice, gives live feedback in conversation, and hands you a polished speech script at the end.**

<img src="./docs/screenshot.png" alt="SelfTalk Speech Coach Screenshot" width="800" />

</div>

---

## About

SelfTalk is a **real-time voice speech coach**. You speak, the AI coach listens and replies — all over a low-latency audio stream. It holds a coaching conversation in your ear while you practice, then at the end it compiles everything you worked on into a complete, read-aloud-ready speech script you can rehearse with.

Built for people who want to rehearse **investor pitches, paper presentations, or founding stories** — not just type notes, but actually _talk it out_ with feedback.

Defaults to English; switches to another language when the user speaks it.

---

## ✨ Features

### 🎙️ Real-Time Voice Conversation

Full bidirectional audio streaming with Gemini 3.1 Flash Live. You talk, the coach talks back. 16kHz mic in, 24kHz speech out, streamed over a single WebSocket with sub-second latency. No push-to-talk, no round trips — just conversation.

### 🗂️ Three Speech Scenarios

Pre-loaded templates for **Persuade / Propose**, **Explain / Report**, and **Storytelling**, each with its own coaching prompt and structural framework (proposal → reasons → objection → CTA for persuade; scene → tension → action → lesson for storytelling, etc.).

### 📝 Reference Panel

Paste your draft, notes, or script. One-click **Translate to English**, or transform it into **Easy** (speech-friendly) or **Professional** (polished) versions before practicing. The coach reads the reference and builds context around it.

### 📌 Live Tips During Practice

Sticky-note-style reminders of the chosen scenario's structure stay visible during the session. Not a checklist — just a glanceable template so you don't lose your place mid-sentence.

### 🎯 Drill Expressions

Add target phrases you want to practice ("as a result," "the key insight here") before the session. The coach detects them in your speech via transcript matching and counts each natural use. Per-session — each practice round starts fresh.

### 📄 Model Script — Your Take-Home

The flagship output. After the session, the AI compiles **your own content** + **the coach's suggested phrasings** into a polished 250–400 word read-aloud script with cleaned-up delivery (no fillers, no fragments). Start-to-finish. Read it aloud to rehearse. Regenerate anytime.

### 📚 Session History

Every session is saved with full transcript, checklist state, drill usage, and model script. Click any past session to review the chat log and the generated script side-by-side.

---

## 🛠 Tech Stack

| Layer      | Technology                                                           |
| ---------- | -------------------------------------------------------------------- |
| Frontend   | Vanilla JS (ES modules), Tailwind CDN, Web Audio API + AudioWorklet  |
| Backend    | Python 3.12, FastAPI, uvicorn, WebSocket                             |
| Database   | MongoDB Atlas (`motor` async driver)                                 |
| AI / Voice | **Gemini 3.1 Flash Live** (real-time speech-to-speech)               |
| AI / Text  | **Gemini 2.5 Flash** (summary, model script, translation, transform) |

---

## 🏗️ Architecture

```
┌────────────────┐    WebSocket    ┌──────────────────┐   SDK    ┌──────────────────┐
│  Browser       │  (base64 PCM)   │  FastAPI Server  │ ───────▶ │  Gemini Live API │
│                │ ◀─────────────▶ │                  │ ◀─────── │                  │
│  Mic (16kHz)   │                 │  • browser_to_ai │          │  (audio in/out)  │
│  Speaker(24k)  │                 │  • ai_to_browser │          └──────────────────┘
│  Tailwind UI   │                 │  • session_timer │
└────────────────┘                 └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │  MongoDB Atlas   │
                                   │  sessions        │
                                   │  transcripts     │
                                   │  drill usage     │
                                   │  notes           │
                                   └──────────────────┘
```

**Session lifecycle:**

1. `POST /api/sessions` — creates the session record with scenario + reference text
2. Browser opens `WS /ws/{session_id}` → server runs 3 concurrent async tasks
3. Mic audio streams browser → server → Gemini; AI audio streams back the same way
4. Transcripts saved in real time, drill expressions detected via matching
5. On end: `POST /api/sessions/{id}/generate-summary` builds the complete speech script via Gemini 2.5 Flash

---

## 🚀 Run Locally

This app runs on your own machine — no hosted demo. Headphones recommended to prevent echo between your mic and speakers.

### Prerequisites

- Python 3.12+
- Chrome or Edge (for microphone access on `localhost`)
- A Google AI API key with billing enabled ([AI Studio](https://aistudio.google.com/apikey))
- A MongoDB Atlas cluster (free tier is fine)

### Setup

```bash
git clone https://github.com/sumin6475/selftalk-speech-coach.git
cd selftalk-speech-coach
pip install -r requirements.txt
cp .env.example .env          # add GOOGLE_API_KEY + MONGODB_URI
python server.py              # http://localhost:8000
```

### Environment Variables

```env
GOOGLE_API_KEY=AIza...
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/?appName=...
```

Open `http://localhost:8000` in your browser, allow microphone access, pick a scenario, and start a session.

---

## 📁 Repo Layout

```
selftalk-speech-coach/
├── server.py              # FastAPI entry + WebSocket handler
├── db/                    # MongoDB models + async helpers
├── prompts/               # Coaching prompts (base + per-scenario)
│   ├── prompt_base.md
│   ├── prompt_persuade.md
│   ├── prompt_explain.md
│   ├── prompt_storytelling.md
│   └── summary_generator.py
├── public/                # Vanilla JS frontend
│   ├── index.html
│   ├── css/styles.css     # CSS variable design tokens
│   └── js/                # ui-controller, session-manager, audio-recorder, ...
├── render.yaml            # Render blueprint
└── requirements.txt
```

---

## 📄 License

MIT

---

_Last updated: 2026.04_
