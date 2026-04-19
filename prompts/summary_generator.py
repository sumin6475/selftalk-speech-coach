# prompts/summary_generator.py
# Builds the prompt for post-session summary + title generation


def build_summary_prompt(
    scenario: str,
    practice_mode: str,
    checklist_items: list[dict],
    transcript: str,
    reference_text: str | None,
) -> str:
    checklist_str = ""
    for item in checklist_items:
        status = "CHECKED" if item["checked"] else "UNCHECKED"
        checklist_str += f"[{status}] {item['label']} — {item['description']}\n"

    return f"""You are analyzing a speech practice session. The user practiced a "{scenario}" speech in "{practice_mode}" mode.

## Checklist state after the session:
{checklist_str}

## Reference material the user was working from:
{reference_text or "(none provided)"}

## Full transcript of the session:
{transcript}

---

Generate a session summary in JSON format. Follow this structure exactly:

{{
  "title": "Short descriptive title, max 6 words",
  "checklist_reasons": [
    {{
      "item_index": 0,
      "label": "The checklist item label",
      "checked": true,
      "reason": "One sentence explaining why this item was/wasn't covered."
    }}
  ],
  "strengths": [
    "One sentence about something the user did well."
  ],
  "improvements": [
    "One sentence about something to work on next. Be specific and actionable."
  ],
  "model_script": "A complete read-aloud speech script assembled from the coach's suggested expressions. See rules below."
}}

Rules:
- title: A short, descriptive title for this practice session (max 6 words). Base it on what the user was practicing, not what the coach said. Examples: "Miller paper presentation practice", "Investor pitch — CS chatbot", "Team offsite proposal rehearsal". Do NOT use generic titles like "Speech practice session" or "Coaching session".
- checklist_reasons must have exactly one entry per checklist item, in order.
- Each reason is 1 sentence, max 20 words. Be specific, not generic.
- For checked items: reference what the user actually said (paraphrased, not quoted).
- For unchecked items: explain what structural element was missing or weak.
- strengths: 1-2 items. Reference specific moments from the transcript.
- improvements: 1-2 items. Give concrete, actionable advice (not just "do better").
- model_script: **WRITE THE COMPLETE SPEECH FROM START TO FINISH** — a full, polished, read-aloud-ready speech script on the user's actual topic. The user MUST be able to open this script, read it aloud from the first word to the last, and deliver a complete speech without adding or changing anything. This is the single most important field in the output. Rules:
  - **Write the entire speech, not just fragments.** Include the opening (hook/greeting/scene-setting), ALL middle sections (every structural element from the checklist above — proposal, reasons, objections, examples, etc.), and the closing. Every beat of a real speech on this topic must be present.
  - **Start from the very first word** a speaker would say (e.g., "Good morning, everyone." / "Let me tell you about..." / "I'm proposing...") and **end with the final word** (e.g., a clear call to action, a closing line, a question to the audience).
  - Use the USER'S OWN content and examples (their app name, their reasons, their specific data points, their story details) as the substance. Do NOT invent new facts, numbers, or claims the user did not provide.
  - Use the COACH'S specific suggested wordings verbatim where the coach offered them (e.g., "I'm proposing ___", "Let's finalize ___ by ___", specific transition phrases, analogies the coach crafted).
  - Clean up the user's delivery: remove fillers ("um", "uh", "like"), false starts, repeated phrases, and fragmentary grammar. Produce fluent, natural spoken English at a native-speaker level, while preserving the user's voice and intent.
  - If the user's content is incomplete for a section the coach discussed (e.g., they skipped giving numbers), write a plausible placeholder in the user's voice based on what they did say, OR fill with a natural transition — but never leave a section empty.
  - Match the scenario's register (persuade = confident and benefit-framed; explain = clear and structured; storytelling = scene-driven and vivid).
  - **Minimum length: 200 words.** Target: 250–400 words (~90–150 seconds spoken). A 2–3 sentence script is NOT acceptable — that is a failure of this instruction.
  - Output plain prose only. No section labels like "Proposal:" or "Reason 1:". No markdown. No bullet points. No line breaks between sections — use paragraph breaks naturally. Just the speech text as one flowing deliverable.
  - Only set model_script to null if the user said essentially nothing in the session (e.g., literally just "hi" with no topic discussed). If a topic was discussed, you MUST write the full script, even if you need to flesh out thin areas based on the direction of the conversation.
- Total output must be valid JSON only. No markdown, no explanation, no preamble.
"""
