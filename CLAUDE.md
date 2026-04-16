# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⛔ DATA PROTECTION — MANDATORY

**NEVER drop, clear, or bulk-delete MongoDB collections or documents.** The database (MongoDB Atlas, db name `selftalk`) contains all user data (sessions, transcripts, notes, drill expressions). There is no automatic backup.

- **NEVER** run `drop()`, `delete_many({})`, or any operation that wipes a collection.
- **NEVER** modify `MONGODB_URI` or `DB_NAME` without user confirmation.
- Index changes are safe (`create_index` is idempotent), but schema-altering bulk updates must be confirmed first.
- Before ANY action that touches the database or `db/` directory, **ask the user for explicit confirmation** and explain what data would be affected.
- This rule applies during planning, implementation, and debugging. No exceptions.

## Quick Start

```bash
pip install -r requirements.txt
cp .env.example .env   # Add GOOGLE_API_KEY
python3 server.py      # Serves at http://localhost:8000
```

No frontend build step. Vanilla JS + Tailwind CDN served as static files from `public/`.

## Architecture

Real-time voice coaching app: browser captures mic audio → WebSocket → FastAPI server → Gemini 3.1 Flash Live API → audio response back to browser. All bidirectional and streaming.

```
Browser (mic 16kHz PCM16) ←WebSocket→ FastAPI server ←SDK→ Gemini Live API
                                         ↕
                                    MongoDB Atlas (sessions, transcripts, checklist_items)
```

### Backend (`server.py`)
- FastAPI with 4 HTTP endpoints + 1 WebSocket endpoint (`/ws/{session_id}`)
- WebSocket handler runs 3 concurrent tasks: `browser_to_gemini()`, `gemini_to_browser()`, `session_timer()`
- Gemini receive loop uses `async for message in session.receive():` with `break` on `turn_complete`/`interrupted`
- **Critical**: Use `audio=types.Blob(...)` not `media=` for `send_realtime_input()`
- 10-minute session hard cap (warning at 9 min)
- On session end: generates title via Gemini Flash, saves to DB

### System Prompts (`prompts/`)
- `speech_coach.py` assembles: base prompt + scenario prompt + mode addendum + reference text
- `build_system_prompt(scenario, mode, reference_text)` — scenario is "persuade"|"explain"|"storytelling"
- Prompt files are Markdown: `prompt_base.md`, `prompt_persuade.md`, `prompt_explain.md`, `prompt_storytelling.md`

### Database (`db/`)
- MongoDB Atlas via motor (async driver), indexes created on startup via `init_db()`
- Collections: `sessions`, `transcripts`, `checklist_items`, `reports`, `notes`, `drill_expressions`, `drill_expression_usage`
- `CHECKLIST_DEFS` dict in `database.py` maps scenarios to checklist items
- `populate_checklist()` inserts items on session creation
- Connection URI set via `MONGODB_URI` env var

### Frontend (`public/`)
- **Entry point**: `ui-controller.js` (imports all other modules as ES modules)
- **State machine**: idle → connecting → listening → agentSpeaking → soloRunActive → analyzing → complete
- **Audio pipeline**: `audio-recorder.js` (mic → PCM16 → base64) → WebSocket → `audio-streamer.js` (base64 → 24kHz playback via gain node)
- **AudioWorklet**: `pcm-processor.js` — Float32 to Int16 conversion, 4096 sample buffer
- **Checklist**: `checklist.js` has per-scenario regex patterns; `runChecklistMatch()` in ui-controller auto-checks items and syncs to server
- **Do NOT** connect AudioWorklet to `destination` (causes echo). Only connect to gain node for playback.

## Key Patterns

### Adding a New Scenario
1. Create `prompts/prompt_newscenario.md`
2. Add to `SCENARIO_PROMPTS` dict in `prompts/speech_coach.py`
3. Add checklist items to `CHECKLIST_DEFS` in `db/database.py`
4. Add checklist + patterns to `CHECKLISTS` and `PATTERNS` in `public/js/checklist.js`
5. Add scenario card to sidebar in `public/index.html`

### WebSocket Message Types
Browser → Server: `audio` (base64 PCM), `end_session`, `checklist_state` (checked_indices + context for Gemini)
Server → Browser: `audio`, `input_transcript`, `output_transcript`, `turn_complete`, `interrupted`, `session_ended`, `status`, `error`

### Session Lifecycle
1. `POST /api/sessions` creates DB record + checklist items
2. WebSocket connects, Gemini session starts with assembled prompt
3. Audio streams bidirectionally, transcripts saved in real-time
4. User clicks End Session → `analyzing` state → server cleanup → title generation → `session_ended` message
5. Frontend loads session from DB → chat log view with frozen checklist

## Configuration
- Gemini model: `gemini-3.1-flash-live-preview` (for Live API), `gemini-2.0-flash` (for title generation)
- Voice: `Kore` (configurable in server.py LiveConnectConfig)
- Session limit: 600s (constants `SESSION_MAX_SECONDS`, `SESSION_WARNING_SECONDS`)
- Server binds to `127.0.0.1:8000` (required for browser mic access)

## Screenshot Tool
```bash
node screenshot.mjs http://localhost:8000 [label]
# Saves to ./temporary screenshots/screenshot-N-label.png
```
Requires `npm install` (puppeteer). Used for design iteration only.
