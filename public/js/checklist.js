// Checklist definitions per scenario (patterns removed — checking is now AI-driven via Gemini tool calls)

export const CHECKLISTS = {
  persuade: [
    { id: "proposal", title: "State your proposal", hint: '"I propose / suggest..."' },
    { id: "reason_1", title: "Reason 1", hint: "Frame as listener benefit" },
    { id: "reason_2", title: "Reason 2", hint: "Frame as listener benefit" },
    { id: "objection", title: "Preempt objection", hint: '"You might worry about..."' },
    { id: "cta", title: "Call to action", hint: '"Let\'s decide on ~ by ~"' },
  ],
  explain: [
    { id: "summary", title: "One-line summary", hint: '"In short, it\'s..."' },
    { id: "background", title: "Background / context", hint: '"Why this matters..."' },
    { id: "core", title: "Core explanation", hint: "Use analogy or contrast" },
    { id: "so_what", title: "So what?", hint: '"What this means is..."' },
  ],
  storytelling: [
    { id: "scene", title: "Open with a scene", hint: "Time, place, situation" },
    { id: "tension", title: "Tension / problem", hint: '"That\'s when ~ became..."' },
    { id: "action", title: "Action and turning point", hint: '"So what I did was..."' },
    { id: "lesson", title: "Lesson / transformation", hint: '"Since then, I..."' },
  ],
};
