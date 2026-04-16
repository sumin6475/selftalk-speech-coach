# SelfTalk — AI Speech Coach

Real-time voice-based speech coaching powered by Gemini 2.0 Flash Live.

## Features

- **Coaching Mode** — Interactive back-and-forth voice conversation with your AI coach
- **Solo Run Mode** — Deliver your full speech uninterrupted, then receive detailed feedback
- **Reference Text** — Paste scripts, notes, or key points for context-aware coaching
- **PDF Reports** — Auto-generated analysis reports with annotated transcripts
- **Session History** — Review past practice sessions

## Prerequisites

- Python 3.10+
- Google AI API key ([get one free](https://aistudio.google.com/apikey))
- Microphone
- Chrome or Edge browser

## Quick Start

1. Clone the repo
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and paste your API key:
   ```bash
   cp .env.example .env
   ```
4. Start the server:
   ```bash
   python server.py
   ```
5. Open **http://localhost:8000** in your browser

## How It Works

1. Click **+ New Chat**
2. (Optional) Paste reference text in the right panel
3. Choose a mode: **Coaching** or **Solo Run**
4. Practice speaking with your AI coach
5. End the session to generate a PDF report
6. Download and review your report

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Connecting spins forever | Check your API key in `.env`. Ensure it's valid. |
| No audio from coach | Check browser permissions. Use headphones to avoid echo. |
| Mic denied | Allow microphone access in browser settings. Chrome requires localhost or HTTPS. |
| Echo / feedback | Use headphones. Echo cancellation is enabled but may not be sufficient with speakers. |
| Port 8000 in use | Kill the existing process or change the port in `server.py`. |

## Tech Stack

- **Server**: Python FastAPI
- **AI**: Gemini 2.0 Flash Live (speech-to-speech)
- **Database**: SQLite via aiosqlite
- **PDF**: reportlab
- **Frontend**: Vanilla HTML/CSS/JS + Tailwind CDN
- **Audio**: Web Audio API + AudioWorklet
