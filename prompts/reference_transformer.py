# prompts/reference_transformer.py
# Transforms reference text into speech-friendly language (Easy or Professional)

import os
from google import genai


def build_transform_prompt(text: str, mode: str, scenario: str | None = None) -> str:
    if mode == "easy":
        return f"""Extract the key points from the following notes and list them as short, plain-language bullet points.

Rules:
- Output a SHORT list of key talking points, not full sentences or paragraphs
- Each bullet: max 10 words. Use fragments, not complete sentences
- Replace jargon with everyday words. If a technical term must stay (e.g. method name), add a plain phrase after it
- Group related points under short topic labels
- Use "→" to show cause/effect or connections
- The speaker will look at these points and say them in their own words — do NOT write a script for them
- Total output must be MUCH shorter than the input — aim for 30-50% of the original length
- Plain text only. Use "- " for bullets. No markdown formatting, no bold, no headers with #

Example output style:
Miller's paper: AI should explain like humans do

Three key ideas:
- Contrastive: "why this instead of that?" not just "why this"
- Selective: pick 1-2 best reasons, not all 10
- Causal: give a cause, not just numbers

My connection:
- Old AI just listed numbers → not real explanation
- I use these rules to design AI that actually explains

Notes to extract from:
---
{text}
---

Key points (plain text, short bullets):"""

    else:  # professional
        word_count = len(text.split())
        max_words = max(80, int(word_count * 0.7))

        return f"""Rewrite the following notes for spoken delivery in a professional/academic setting.

HARD LIMIT: Maximum {max_words} words. Count before outputting. Cut anything redundant to stay under.

Rules:
- Keep domain-specific terminology — the audience knows the field
- Restructure for spoken flow: key point first, then support
- Shorter sentences. Cut filler phrases ("it is important to note that" → cut)
- Weave references naturally ("Miller argues..." not "Miller (2019)")
- Convert lists to spoken signposting ("Three key ideas. First...")
- Sound like a confident speaker, not a paper read aloud
- NEVER use markdown: no **, no *, no #, no backticks. Plain text only. For emphasis, the speaker uses their voice — not formatting.

Notes to rewrite:
---
{text}
---

Rewritten version (plain text only, under {max_words} words):"""


def transform_reference(text: str, mode: str, scenario: str | None = None) -> str:
    prompt = build_transform_prompt(text, mode, scenario)
    client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )
    return response.text.strip()
