import asyncio
import base64
import json
import logging
import os
import time
from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("speech-coach")

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from google import genai
from google.genai import types

from db import database as db
from prompts.speech_coach import build_system_prompt
from prompts.summary_generator import build_summary_prompt
from prompts.reference_transformer import transform_reference

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
SESSION_MAX_SECONDS = 600  # 10 minutes
SESSION_WARNING_SECONDS = 540  # 9 minutes


# ── App lifecycle ──


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    yield


app = FastAPI(lifespan=lifespan)


# ── Request models ──


class CreateSessionRequest(BaseModel):
    scenario: str = "persuade"  # "persuade" | "explain" | "storytelling"
    coaching_style: str = "guide"  # "guide" | "challenger" | "listener"
    reference_text: str | None = None
    reference_text_original: str | None = None
    reference_text_transformed: str | None = None
    reference_transform_mode: str | None = None
    beta_flags: dict | None = None
    drill_expression_ids: list[str] | None = None


class TransformRequest(BaseModel):
    text: str
    mode: str  # "easy" | "professional"
    scenario: str | None = None


class ExpressionHelpRequest(BaseModel):
    query: str
    session_id: str | None = None


EXPRESSION_HELP_PROMPT = """You are a bilingual language assistant helping a Korean speaker practice English speeches.

The user will give you a Korean word, phrase, or sentence they want to express in English.

Return exactly 2-3 short English expressions that convey the same meaning.

Rules:
- Keep expressions SHORT: words or short phrases preferred over full sentences
- Range from formal to casual if possible (e.g., "cost-effective" vs "bang for your buck")
- No explanations, no Korean, no numbering — just the expressions, one per line
- If the input is ambiguous, give the most likely interpretation in a speech/presentation context
"""


# ── HTTP endpoints ──


@app.post("/api/reference/transform")
async def transform_reference_endpoint(req: TransformRequest):
    text = req.text.strip()
    if not text:
        return JSONResponse({"error": "Text is required"}, status_code=400)
    if len(text) > 8000:
        text = text[:8000]
    if req.mode not in ("easy", "professional"):
        return JSONResponse({"error": "Mode must be 'easy' or 'professional'"}, status_code=400)
    try:
        transformed = transform_reference(text, req.mode, req.scenario)
        return JSONResponse({"transformed_text": transformed})
    except Exception as e:
        logger.error(f"Reference transform failed: {e}")
        return JSONResponse({"error": "Transformation failed"}, status_code=500)


class TranslateRequest(BaseModel):
    text: str
    target_lang: str = "English"


@app.post("/api/reference/translate")
async def translate_reference(req: TranslateRequest):
    text = req.text.strip()
    if not text:
        return JSONResponse({"error": "Text is required"}, status_code=400)
    if len(text) > 8000:
        text = text[:8000]
    try:
        client = genai.Client(api_key=GOOGLE_API_KEY)
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"Translate the following text to {req.target_lang}. Output ONLY the translated text, nothing else. No explanations, no notes.\n\n{text}",
        )
        translated = resp.text.strip()
        return JSONResponse({"translated_text": translated})
    except Exception as e:
        logger.error(f"Translation failed: {e}")
        return JSONResponse({"error": "Translation failed"}, status_code=500)


@app.post("/api/expression-help")
async def expression_help(req: ExpressionHelpRequest):
    query = req.query.strip()
    if not query:
        return JSONResponse({"error": "Query is required"}, status_code=400)
    try:
        client = genai.Client(api_key=GOOGLE_API_KEY)
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=query,
            config=types.GenerateContentConfig(
                system_instruction=EXPRESSION_HELP_PROMPT,
                temperature=0.3,
                max_output_tokens=150,
            ),
        )
        raw_text = resp.text.strip()
        expressions = [line.strip().lstrip("•-123. ") for line in raw_text.split("\n") if line.strip()]
        return JSONResponse({"expressions": expressions[:3]})
    except Exception as e:
        logger.error(f"Expression help failed: {e}")
        return JSONResponse({"error": "Failed to get suggestions"}, status_code=500)


@app.post("/api/sessions")
async def create_session(req: CreateSessionRequest):
    ref = req.reference_text
    if ref and len(ref) > 8000:
        ref = ref[:8000]
    ref_orig = req.reference_text_original
    if ref_orig and len(ref_orig) > 8000:
        ref_orig = ref_orig[:8000]
    ref_trans = req.reference_text_transformed
    if ref_trans and len(ref_trans) > 8000:
        ref_trans = ref_trans[:8000]
    beta_json = json.dumps(req.beta_flags) if req.beta_flags else None
    session = await db.create_session(
        reference_text=ref, scenario=req.scenario,
        reference_text_original=ref_orig, reference_text_transformed=ref_trans,
        reference_transform_mode=req.reference_transform_mode,
        beta_flags=beta_json, coaching_style=req.coaching_style,
    )
    await db.populate_checklist(session["id"], req.scenario)
    if req.drill_expression_ids:
        await db.populate_drill_expressions(session["id"], req.drill_expression_ids)
    return JSONResponse(session)


@app.get("/api/sessions")
async def list_sessions():
    sessions = await db.list_sessions()
    return JSONResponse(sessions)


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    transcripts = await db.get_transcripts(session_id)
    checklist = await db.get_checklist(session_id)
    drill_expressions = await db.get_drill_expression_usage(session_id)
    # Parse summary JSON if stored
    summary = None
    if session.get("summary"):
        try:
            summary = json.loads(session["summary"])
        except (json.JSONDecodeError, TypeError):
            pass
    return JSONResponse({**session, "summary": summary, "transcripts": transcripts, "checklist": checklist, "drill_expressions": drill_expressions})


@app.post("/api/sessions/{session_id}/generate-summary")
async def generate_summary(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    transcripts = await db.get_transcripts(session_id)
    if not transcripts:
        return JSONResponse({"error": "No transcripts found"}, status_code=400)
    try:
        checklist = await db.get_checklist(session_id)
        transcript_str = "\n".join(
            f"{'User' if t['role'] == 'user' else 'Coach'}: {t['content']}"
            for t in transcripts if t.get("content")
        )
        prompt = build_summary_prompt(
            scenario=session.get("scenario", "persuade"),
            practice_mode=session.get("practice_mode", "conversation"),
            checklist_items=checklist,
            transcript=transcript_str,
            reference_text=session.get("reference_text"),
        )
        client = genai.Client(api_key=GOOGLE_API_KEY)
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        summary_text = resp.text.strip()
        if summary_text.startswith("```"):
            summary_text = summary_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        summary = json.loads(summary_text)

        title = summary.pop("title", None)
        if title:
            await db.update_session_title(session_id, str(title)[:100])
        await db.update_session_summary(session_id, json.dumps(summary))
        logger.info(f"[{session_id[:8]}] Summary regenerated via API")
        return JSONResponse({"summary": summary, "title": str(title)[:100] if title else None})
    except Exception as e:
        logger.error(f"Summary generation failed: {e}")
        return JSONResponse({"error": f"Summary generation failed: {e}"}, status_code=500)


class CreateNoteRequest(BaseModel):
    title: str = ""
    content: str = ""


class UpdateNoteRequest(BaseModel):
    title: str | None = None
    content: str | None = None


class RenameSessionRequest(BaseModel):
    title: str


@app.patch("/api/sessions/{session_id}")
async def rename_session(session_id: str, req: RenameSessionRequest):
    title = req.title.strip()
    if not title:
        return JSONResponse({"error": "Title cannot be empty"}, status_code=400)
    if len(title) > 100:
        title = title[:100]
    session = await db.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    await db.update_session_title(session_id, title)
    return JSONResponse({"id": session_id, "title": title})


@app.delete("/api/sessions/{session_id}")
async def delete_session_endpoint(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    if session.get("status") == "active":
        return JSONResponse({"error": "Cannot delete an active session"}, status_code=400)
    await db.delete_session(session_id)
    return JSONResponse(None, status_code=204)


@app.post("/api/sessions/{session_id}/end")
async def end_session_endpoint(session_id: str):
    session = await db.get_session(session_id)
    if not session:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    return JSONResponse({"status": "ended", "session_id": session_id})




# ── Notes endpoints ──


@app.get("/api/notes")
async def list_notes():
    notes = await db.list_notes()
    return JSONResponse(notes)


@app.post("/api/notes")
async def create_note(req: CreateNoteRequest):
    note = await db.create_note(title=req.title, content=req.content)
    return JSONResponse(note)


@app.patch("/api/notes/{note_id}")
async def update_note(note_id: str, req: UpdateNoteRequest):
    note = await db.update_note(note_id, title=req.title, content=req.content)
    if not note:
        return JSONResponse({"error": "Note not found"}, status_code=404)
    return JSONResponse(note)


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str):
    await db.delete_note(note_id)
    return JSONResponse(None, status_code=204)


# ── Drill Expressions endpoints ──


class CreateDrillExpressionRequest(BaseModel):
    expression: str
    hint: str | None = None


@app.get("/api/drill-expressions")
async def list_drill_expressions():
    expressions = await db.list_drill_expressions()
    return JSONResponse(expressions)


@app.post("/api/drill-expressions")
async def create_drill_expression(req: CreateDrillExpressionRequest):
    expr = req.expression.strip()
    if not expr:
        return JSONResponse({"error": "Expression is required"}, status_code=400)
    if len(expr) > 200:
        expr = expr[:200]
    hint = req.hint.strip() if req.hint else None
    result = await db.create_drill_expression(expr, hint)
    return JSONResponse(result)


@app.delete("/api/drill-expressions/{expr_id}")
async def delete_drill_expression(expr_id: str):
    await db.delete_drill_expression(expr_id)
    return JSONResponse(None, status_code=204)


# ── WebSocket: Voice session relay ──


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    sid = session_id[:8]

    session = await db.get_session(session_id)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return

    scenario = session.get("scenario", "persuade")
    coaching_style = session.get("coaching_style", "guide")
    # Parse beta flags
    beta_flags = {}
    if session.get("beta_flags"):
        try:
            beta_flags = json.loads(session["beta_flags"])
        except (json.JSONDecodeError, TypeError):
            pass
    beta_checklist = beta_flags.get("checklist", False)
    beta_summary = beta_flags.get("summary", False)

    system_prompt = build_system_prompt(
        scenario=scenario, reference_text=session.get("reference_text"), coaching_style=coaching_style
    )

    # Build Gemini tool declarations (only if beta_checklist enabled)
    tools = None
    if beta_checklist:
        checklist_items = db.CHECKLIST_DEFS.get(scenario, [])
        item_descriptions = ", ".join(f"{i}: {label}" for i, (label, _) in enumerate(checklist_items))
        tools = [types.Tool(function_declarations=[
            types.FunctionDeclaration(
                name="update_checklist",
                description=f"Mark a checklist item as completed when the user has covered that structural element in their speech. Items: {item_descriptions}",
                parameters=types.Schema(
                    type="OBJECT",
                    properties={
                        "item_index": types.Schema(
                            type="INTEGER",
                            description="The 0-based index of the checklist item to mark as complete.",
                        ),
                    },
                    required=["item_index"],
                ),
            ),
        ])]

    client = genai.Client(api_key=GOOGLE_API_KEY)
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
            )
        ),
        system_instruction=types.Content(
            parts=[types.Part(text=system_prompt)]
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=tools,
    )

    session_start_time = time.time()
    title_set = False
    browser_disconnected = False
    help_mode_active = False

    try:
        logger.info(f"[{sid}] Connecting to Gemini...")
        async with client.aio.live.connect(
            model="gemini-3.1-flash-live-preview",
            config=config,
        ) as gemini_session:
            logger.info(f"[{sid}] Gemini connected. Style: {coaching_style}")
            await websocket.send_json({"type": "status", "message": "Connected"})

            # ── Browser → Gemini ──
            async def browser_to_gemini():
                nonlocal browser_disconnected, help_mode_active
                try:
                    while True:
                        data = await websocket.receive_text()
                        msg = json.loads(data)
                        if msg["type"] == "help_mode":
                            help_mode_active = msg.get("active", False)
                            logger.info(f"[{sid}] Help mode: {'on' if help_mode_active else 'off'}")
                            continue
                        if msg["type"] == "checklist_manual":
                            idx = msg.get("item_index", 0)
                            checked = msg.get("checked", True)
                            await db.update_checklist_item(session_id, idx, checked)
                            continue
                        if msg["type"] == "drill_expression_used":
                            expr_id = msg.get("expression_id")
                            if expr_id:
                                await db.increment_drill_expression_usage(session_id, expr_id)
                            continue
                        if msg["type"] == "audio":
                            if help_mode_active:
                                continue  # suppress mic audio during help mode
                            audio_bytes = base64.b64decode(msg["data"])
                            await gemini_session.send_realtime_input(
                                audio=types.Blob(
                                    data=audio_bytes,
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )
                        elif msg["type"] == "end_session":
                            logger.info(f"[{sid}] User ended session")
                            return  # clean exit
                except WebSocketDisconnect:
                    logger.info(f"[{sid}] Browser disconnected")
                    browser_disconnected = True
                except Exception as e:
                    logger.error(f"[{sid}] browser_to_gemini: {type(e).__name__}: {e}")

            # ── Gemini → Browser ──
            async def gemini_to_browser():
                nonlocal title_set
                checklist_items = db.CHECKLIST_DEFS.get(scenario, [])
                checked_indices = set()
                try:
                    while True:
                        async for message in gemini_session.receive():
                            # Audio response (suppress during help mode)
                            if message.server_content and message.server_content.model_turn:
                                if not help_mode_active:
                                    for part in message.server_content.model_turn.parts:
                                        if part.inline_data and part.inline_data.data:
                                            audio_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                                            await websocket.send_json({"type": "audio", "data": audio_b64})

                            # Tool calls from Gemini (update_checklist)
                            if message.tool_call:
                                for fc in message.tool_call.function_calls:
                                    if fc.name == "update_checklist":
                                        idx = fc.args.get("item_index", 0)
                                        if isinstance(idx, float):
                                            idx = int(idx)
                                        # Persist to DB
                                        await db.update_checklist_item(session_id, idx, True)
                                        checked_indices.add(idx)
                                        # Notify browser
                                        await websocket.send_json({
                                            "type": "checklist_update",
                                            "item_index": idx,
                                            "checked": True,
                                        })
                                        # Build tool response
                                        checked_label = checklist_items[idx][0] if idx < len(checklist_items) else f"Item {idx}"
                                        remaining = [label for i, (label, _) in enumerate(checklist_items) if i not in checked_indices]
                                        next_item = remaining[0] if remaining else None
                                        result = {
                                            "status": "success",
                                            "checked_item": checked_label,
                                            "progress": f"{len(checked_indices)}/{len(checklist_items)} complete",
                                            "remaining": remaining,
                                        }
                                        if next_item:
                                            result["next_item"] = next_item
                                        # Send tool response back to Gemini
                                        await gemini_session.send_tool_response(
                                            function_responses=[types.FunctionResponse(
                                                name="update_checklist",
                                                id=fc.id,
                                                response=result,
                                            )]
                                        )
                                        logger.info(f"[{sid}] Checklist: checked [{idx}] {checked_label} ({len(checked_indices)}/{len(checklist_items)})")

                            # Transcriptions
                            if message.server_content:
                                if message.server_content.input_transcription:
                                    text = message.server_content.input_transcription.text
                                    if text:
                                        await db.save_transcript(session_id, "user", text)
                                        await websocket.send_json({"type": "input_transcript", "text": text})
                                        if not title_set:
                                            await db.update_session_title(session_id, text[:50])
                                            title_set = True

                                if message.server_content.output_transcription:
                                    text = message.server_content.output_transcription.text
                                    if text:
                                        await db.save_transcript(session_id, "agent", text)
                                        await websocket.send_json({"type": "output_transcript", "text": text})

                                # Turn complete — break inner loop, outer while True continues for next turn
                                if message.server_content.turn_complete:
                                    await websocket.send_json({"type": "turn_complete"})
                                    break

                                # Interrupted (barge-in)
                                if message.server_content.interrupted:
                                    await websocket.send_json({"type": "interrupted"})
                                    break

                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.error(f"[{sid}] gemini_to_browser: {type(e).__name__}: {e}", exc_info=True)

            # ── Timer ──
            async def session_timer():
                while True:
                    await asyncio.sleep(1)
                    elapsed = time.time() - session_start_time
                    if elapsed >= SESSION_WARNING_SECONDS and elapsed < SESSION_WARNING_SECONDS + 1:
                        try:
                            await websocket.send_json({"type": "status", "message": "1 minute remaining"})
                        except Exception:
                            return
                    if elapsed >= SESSION_MAX_SECONDS:
                        try:
                            await websocket.send_json({"type": "session_ended"})
                        except Exception:
                            pass
                        return

            # Run both directions concurrently
            try:
                await asyncio.gather(
                    browser_to_gemini(),
                    gemini_to_browser(),
                    session_timer(),
                )
            except Exception as e:
                logger.error(f"[{sid}] gather error: {type(e).__name__}: {e}")

    except Exception as e:
        logger.error(f"[{sid}] Session error: {type(e).__name__}: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

    # ── Cleanup ──
    elapsed = int(time.time() - session_start_time)
    await db.end_session(session_id, elapsed)
    logger.info(f"[{sid}] Session ended. Duration: {elapsed}s")

    # Generate title (always) and summary (if beta enabled)
    try:
        transcripts = await db.get_transcripts(session_id)
        if transcripts:
            if beta_summary:
                # Full summary + title in one LLM call
                checklist = await db.get_checklist(session_id)
                session_data = await db.get_session(session_id)
                transcript_str = "\n".join(
                    f"{'User' if t['role'] == 'user' else 'Coach'}: {t['content']}"
                    for t in transcripts if t.get("content")
                )
                prompt = build_summary_prompt(
                    scenario=session_data.get("scenario", "persuade"),
                    practice_mode=session_data.get("practice_mode", "conversation"),
                    checklist_items=checklist,
                    transcript=transcript_str,
                    reference_text=session_data.get("reference_text"),
                )
                summary_client = genai.Client(api_key=GOOGLE_API_KEY)
                resp = summary_client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                )
                summary_text = resp.text.strip()
                if summary_text.startswith("```"):
                    summary_text = summary_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
                summary = json.loads(summary_text)

                title = summary.pop("title", None)
                if title:
                    await db.update_session_title(session_id, str(title)[:100])
                    logger.info(f"[{sid}] Generated title: {title}")

                await db.update_session_summary(session_id, json.dumps(summary))
                logger.info(f"[{sid}] Summary generated")

                if not browser_disconnected:
                    try:
                        msg = {"type": "summary_ready", "summary": summary}
                        if title:
                            msg["title"] = str(title)[:100]
                        await websocket.send_json(msg)
                    except Exception:
                        pass
            else:
                # Title only (lightweight LLM call)
                convo = " ".join(t["content"] for t in transcripts[:10] if t.get("content"))
                if len(convo) > 500:
                    convo = convo[:500]
                title_client = genai.Client(api_key=GOOGLE_API_KEY)
                resp = title_client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=f"Summarize this speech coaching session in a short title (3-6 words, no quotes).\n\n{convo}",
                )
                title = resp.text.strip().strip('"').strip("'")
                if title:
                    await db.update_session_title(session_id, title[:60])
                    logger.info(f"[{sid}] Generated title: {title}")
    except Exception as e:
        logger.warning(f"[{sid}] Post-session generation failed: {type(e).__name__}: {e}", exc_info=True)

    # Notify browser session is done
    if not browser_disconnected:
        try:
            await websocket.send_json({"type": "session_ended"})
        except Exception:
            pass

    try:
        await websocket.close()
    except Exception:
        pass


# ── Static files (must be last) ──

app.mount("/", StaticFiles(directory="public", html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
