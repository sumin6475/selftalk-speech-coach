# prompts/speech_coach.py
# System prompt builder — assembles base + scenario + coaching style + checklist

from pathlib import Path

from db.database import CHECKLIST_DEFS

PROMPTS_DIR = Path(__file__).parent

# Load prompt files
BASE_PROMPT = (PROMPTS_DIR / "prompt_base.md").read_text(encoding="utf-8")

SCENARIO_PROMPTS = {
    "persuade": (PROMPTS_DIR / "prompt_persuade.md").read_text(encoding="utf-8"),
    "explain": (PROMPTS_DIR / "prompt_explain.md").read_text(encoding="utf-8"),
    "storytelling": (PROMPTS_DIR / "prompt_storytelling.md").read_text(encoding="utf-8"),
}

STYLE_PROMPTS = {
    "guide": (PROMPTS_DIR / "style_guide.md").read_text(encoding="utf-8"),
    "challenger": (PROMPTS_DIR / "style_challenger.md").read_text(encoding="utf-8"),
    "listener": (PROMPTS_DIR / "style_listener.md").read_text(encoding="utf-8"),
}


def _build_checklist_section(scenario: str) -> str:
    """Build the checklist items section for the system prompt."""
    items = CHECKLIST_DEFS.get(scenario, [])
    if not items:
        return ""

    lines = ["\n---\n", "## Checklist Items for This Session\n"]
    lines.append("You have access to the update_checklist tool. Call update_checklist(item_index=N) when the user covers item N.\n")

    for i, (label, desc) in enumerate(items):
        lines.append(f"[{i}] {label} — {desc}")

    return "\n".join(lines) + "\n"


def build_system_prompt(
    scenario: str,              # "persuade" | "explain" | "storytelling"
    reference_text: str | None = None,
    coaching_style: str = "guide",  # "guide" | "challenger" | "listener"
    # Legacy compat
    practice_mode: str | None = None,
    mode: str | None = None,
) -> str:
    """
    Assemble the full system prompt for a Gemini session.

    Structure:
      1. Base prompt (role, framework, feedback format, coaching tone)
      2. Scenario-specific prompt (template, examples, coaching focus)
      3. Coaching style prompt (guide / challenger / listener)
      4. Checklist items for this session
      5. Reference text (if provided)
    """
    # 1. Base
    prompt = BASE_PROMPT

    # 2. Scenario
    scenario_prompt = SCENARIO_PROMPTS.get(scenario)
    if scenario_prompt:
        prompt += "\n\n" + scenario_prompt
    else:
        raise ValueError(f"Unknown scenario: {scenario}. Expected: persuade, explain, storytelling")

    # 3. Coaching style
    style = coaching_style if coaching_style in STYLE_PROMPTS else "guide"
    prompt += "\n\n" + STYLE_PROMPTS[style]

    # 4. Checklist items
    prompt += _build_checklist_section(scenario)

    # 5. Reference text
    if reference_text:
        prompt += f"""
---

## Reference Material

The user provided the following material for this practice session.
Use this as context for coaching. The user wants to practice presenting or discussing this content.

---
{reference_text}
---
"""

    return prompt
