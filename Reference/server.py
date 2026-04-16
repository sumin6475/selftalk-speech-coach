import asyncio
import base64
import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from google import genai
from google.genai import types

from tools import clickup, calendar

# Load .env from parent directory (shared across demos)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

app = FastAPI()

import datetime
import zoneinfo

def _get_current_time_context():
    tz = zoneinfo.ZoneInfo("America/Chicago")
    now = datetime.datetime.now(tz)
    return now.strftime("Today is %A, %B %d, %Y. The current time is %I:%M %p %Z.")

SYSTEM_PROMPT = f"""You are a friendly, professional receptionist and executive assistant named Aria.

The user is in Central Time (America/Chicago). {_get_current_time_context()}
Always use Central Time when discussing dates, times, and scheduling. When creating calendar events, use the timezone offset -05:00 (CDT) or -06:00 (CST) as appropriate.

You help the user manage their schedule and tasks through natural conversation.

## What you can do:

**Google Calendar:**
- Check today's schedule or upcoming events
- Create new calendar events
- Look up details on specific events

**ClickUp Tasks:**
- Browse the user's workspace (workspaces → spaces → lists → tasks)
- View task details, status, and priorities
- Create new tasks
- Update task status or priority
- Add comments to tasks
- Close/complete tasks

## How to handle ClickUp navigation:
When the user asks about tasks, you may need to discover their workspace structure first.
Chain calls: get_workspaces → get_spaces → get_lists → get_tasks.
Remember IDs from previous calls so you don't re-fetch them.

## Guidelines:
- Be conversational and warm, but efficient. Don't ramble.
- Summarize information naturally — never read raw data or IDs back to the user.
- When creating tasks or events, confirm the key details before executing.
- If something fails, explain what happened simply and suggest what to try next.
- If you don't know something, say so honestly.
"""

# Tool registry — maps function names to callables
TOOLS = {
    "get_workspaces": clickup.get_workspaces,
    "get_spaces": clickup.get_spaces,
    "get_lists": clickup.get_lists,
    "get_tasks": clickup.get_tasks,
    "get_task_details": clickup.get_task_details,
    "create_task": clickup.create_task,
    "update_task": clickup.update_task,
    "add_comment": clickup.add_comment,
    "close_task": clickup.close_task,
    "get_todays_events": calendar.get_todays_events,
    "get_upcoming_events": calendar.get_upcoming_events,
    "get_event_details": calendar.get_event_details,
    "create_event": calendar.create_event,
}

# Tool declarations for Gemini (JSON schema format)
TOOL_DECLARATIONS = [
    {
        "name": "get_workspaces",
        "description": "Lists all ClickUp workspaces (teams) the user belongs to.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_spaces",
        "description": "Lists all spaces in a ClickUp workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "team_id": {"type": "string", "description": "The workspace (team) ID."},
            },
            "required": ["team_id"],
        },
    },
    {
        "name": "get_lists",
        "description": "Lists all task lists in a ClickUp space, including lists inside folders and folderless lists.",
        "parameters": {
            "type": "object",
            "properties": {
                "space_id": {"type": "string", "description": "The space ID."},
            },
            "required": ["space_id"],
        },
    },
    {
        "name": "get_tasks",
        "description": "Gets tasks from a ClickUp list.",
        "parameters": {
            "type": "object",
            "properties": {
                "list_id": {"type": "string", "description": "The list ID to fetch tasks from."},
                "status": {"type": "string", "description": "Optional status filter like 'open', 'in progress', 'closed'."},
            },
            "required": ["list_id"],
        },
    },
    {
        "name": "get_task_details",
        "description": "Gets full details of a specific ClickUp task.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The task ID."},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "create_task",
        "description": "Creates a new task in a ClickUp list.",
        "parameters": {
            "type": "object",
            "properties": {
                "list_id": {"type": "string", "description": "The list ID to create the task in."},
                "name": {"type": "string", "description": "The name/title of the new task."},
                "description": {"type": "string", "description": "Optional description."},
                "priority": {"type": "integer", "description": "Priority: 1=Urgent, 2=High, 3=Normal, 4=Low."},
            },
            "required": ["list_id", "name"],
        },
    },
    {
        "name": "update_task",
        "description": "Updates a ClickUp task's status or priority.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The task ID to update."},
                "status": {"type": "string", "description": "New status (e.g., 'open', 'in progress', 'closed')."},
                "priority": {"type": "integer", "description": "New priority: 1=Urgent, 2=High, 3=Normal, 4=Low."},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "add_comment",
        "description": "Adds a comment to a ClickUp task.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The task ID."},
                "comment_text": {"type": "string", "description": "The comment text."},
            },
            "required": ["task_id", "comment_text"],
        },
    },
    {
        "name": "close_task",
        "description": "Closes/completes a ClickUp task.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The task ID to close."},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "get_todays_events",
        "description": "Gets all Google Calendar events for today.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_upcoming_events",
        "description": "Gets Google Calendar events for the next several days.",
        "parameters": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of days to look ahead. Defaults to 7."},
            },
        },
    },
    {
        "name": "get_event_details",
        "description": "Gets full details of a specific Google Calendar event.",
        "parameters": {
            "type": "object",
            "properties": {
                "event_id": {"type": "string", "description": "The Google Calendar event ID."},
            },
            "required": ["event_id"],
        },
    },
    {
        "name": "create_event",
        "description": "Creates a new Google Calendar event.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Title of the event."},
                "start_time": {"type": "string", "description": "Start time in ISO format like '2026-03-28T14:00:00-05:00'."},
                "end_time": {"type": "string", "description": "End time in ISO format like '2026-03-28T14:30:00-05:00'."},
                "description": {"type": "string", "description": "Optional event description."},
                "attendee_emails": {"type": "string", "description": "Optional comma-separated emails to invite."},
            },
            "required": ["summary", "start_time", "end_time"],
        },
    },
]


def execute_tool(name: str, args: dict) -> dict:
    """Execute a tool function by name with the given arguments."""
    func = TOOLS.get(name)
    if not func:
        return {"status": "error", "error_message": f"Unknown tool: {name}"}
    try:
        return func(**args)
    except Exception as e:
        return {"status": "error", "error_message": str(e)}


@app.get("/")
async def serve_index():
    return FileResponse("index.html")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=SYSTEM_PROMPT,
        tools=[types.Tool(function_declarations=[
            types.FunctionDeclaration(**decl) for decl in TOOL_DECLARATIONS
        ])],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        async with client.aio.live.connect(
            model="gemini-3.1-flash-live-preview",
            config=config,
        ) as session:
            # Send status to browser
            await ws.send_json({"type": "status", "message": "Connected to Gemini"})

            async def browser_to_gemini():
                """Receive audio from browser and forward to Gemini."""
                try:
                    while True:
                        data = await ws.receive_text()
                        msg = json.loads(data)

                        if msg["type"] == "audio":
                            audio_bytes = base64.b64decode(msg["data"])
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=audio_bytes,
                                    mime_type="audio/pcm;rate=16000",
                                ),
                            )
                except WebSocketDisconnect:
                    pass

            async def gemini_to_browser():
                """Receive responses from Gemini and forward to browser."""
                try:
                    while True:
                        async for message in session.receive():
                            # Handle audio response
                            if message.server_content and message.server_content.model_turn:
                                for part in message.server_content.model_turn.parts:
                                    if part.inline_data and part.inline_data.data:
                                        audio_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                                        await ws.send_json({
                                            "type": "audio",
                                            "data": audio_b64,
                                        })

                            # Handle transcriptions
                            if message.server_content:
                                if message.server_content.input_transcription:
                                    text = message.server_content.input_transcription.text
                                    if text:
                                        await ws.send_json({
                                            "type": "input_transcript",
                                            "text": text,
                                        })
                                if message.server_content.output_transcription:
                                    text = message.server_content.output_transcription.text
                                    if text:
                                        await ws.send_json({
                                            "type": "output_transcript",
                                            "text": text,
                                        })

                                # Turn complete
                                if message.server_content.turn_complete:
                                    await ws.send_json({"type": "turn_complete"})
                                    break

                                # Interrupted (barge-in)
                                if message.server_content.interrupted:
                                    await ws.send_json({"type": "interrupted"})
                                    break

                            # Handle tool calls
                            if message.tool_call:
                                for fc in message.tool_call.function_calls:
                                    await ws.send_json({
                                        "type": "tool_call",
                                        "name": fc.name,
                                    })

                                    # Execute the tool
                                    result = execute_tool(fc.name, fc.args or {})

                                    # Send result back to Gemini
                                    await session.send_tool_response(
                                        function_responses=[
                                            types.FunctionResponse(
                                                id=fc.id,
                                                name=fc.name,
                                                response=result,
                                            )
                                        ]
                                    )

                                    await ws.send_json({
                                        "type": "tool_result",
                                        "name": fc.name,
                                        "status": result.get("status", "unknown"),
                                    })

                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    print(f"Error in gemini_to_browser: {e}")
                    await ws.send_json({"type": "error", "message": str(e)})

            # Run both directions concurrently
            await asyncio.gather(
                browser_to_gemini(),
                gemini_to_browser(),
            )

    except Exception as e:
        print(f"Session error: {e}")
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
