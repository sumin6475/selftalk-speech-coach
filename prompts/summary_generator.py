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
- model_script: Write a COMPLETE, read-aloud-ready speech script the user can practice by speaking it aloud as-is. The goal is a polished final version of everything they worked on in the session. Rules:
  - Follow the structural framework the coach guided through (for this scenario, the checklist items above define that structure — cover each checked/discussed element in order).
  - Use the USER'S OWN content and examples (their app name, their reasons, their specific data points, their story details) as the substance. Do NOT invent new facts, numbers, or claims the user did not provide.
  - Use the COACH'S specific suggested wordings verbatim where the coach offered them (e.g., "I'm proposing ___", "Let's finalize ___ by ___", specific transition phrases, analogies the coach crafted).
  - Clean up the user's delivery: remove fillers ("um", "uh", "like"), false starts, repeated phrases, and fragmentary grammar. Produce fluent, natural spoken English at a native-speaker level, while preserving the user's voice and intent.
  - Match the scenario's register (persuade = confident and benefit-framed; explain = clear and structured; storytelling = scene-driven and vivid).
  - Length: aim for a speech that takes ~60–120 seconds to deliver aloud (roughly 150–300 words). Longer is OK if the content warrants it, but do not pad.
  - Output plain prose only. No section labels like "Proposal:" or "Reason 1:". No markdown. No bullet points. Just the speech text.
  - If the conversation was too short to build any meaningful content (e.g., user only said a few words), set model_script to null.
- Total output must be valid JSON only. No markdown, no explanation, no preamble.
"""
