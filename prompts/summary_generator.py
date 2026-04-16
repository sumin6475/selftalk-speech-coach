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
- model_script: Compile ONLY the specific phrases, sentences, and expressions the coach explicitly suggested during the session into one cohesive read-aloud script. Rules:
  - Use the coach's suggested wording VERBATIM — do not paraphrase or rewrite.
  - Arrange suggestions in the logical speech order (not conversation order).
  - Omit all coaching commentary (e.g. "try saying...", "you could say...") — include only the suggested speech content itself.
  - Connect suggestions with minimal bridging words if needed for flow, but do not add new content.
  - If the coach made no specific expression suggestions, set to null.
- Total output must be valid JSON only. No markdown, no explanation, no preamble.
"""
