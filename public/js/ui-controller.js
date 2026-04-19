// Main entry point: state machine, orb animation, UI event binding
import { SessionManager } from "./session-manager.js";
import { CHECKLISTS } from "./checklist.js";

const sm = new SessionManager();

// ── App settings (localStorage, migrated from beta_settings) ──
const SETTING_DEFAULTS = { summary: true, checklist: false, help: false };
function loadSettings() {
  try {
    let stored = JSON.parse(localStorage.getItem("app_settings"));
    if (!stored) {
      const old = JSON.parse(localStorage.getItem("beta_settings"));
      if (old) {
        stored = { ...SETTING_DEFAULTS, ...old, summary: true };
        localStorage.setItem("app_settings", JSON.stringify(stored));
        localStorage.removeItem("beta_settings");
      }
    }
    return { ...SETTING_DEFAULTS, ...(stored || {}) };
  } catch { return { ...SETTING_DEFAULTS }; }
}
function saveSettings(s) { localStorage.setItem("app_settings", JSON.stringify(s)); }
let betaSettings = loadSettings();

// ── Coaching style (localStorage) ──
function loadCoachingStyle() {
  return localStorage.getItem("coaching_style") || "guide";
}
function saveCoachingStyle(s) { localStorage.setItem("coaching_style", s); }
let coachingStyle = loadCoachingStyle();

// ── State ──
let state = "idle"; // idle | connecting | listening | agentSpeaking | analyzing | complete
let rightPanelOpen = true;
let selectedScenario = "persuade";
let loadSessionCounter = 0;

// ── DOM refs ──
const $ = (sel) => document.querySelector(sel);
const chatList = $("#chatList");
const statusText = $("#statusText");
const talkBtn = $("#talkBtn");
const endPracticeBtn = $("#endPracticeBtn");
const toggleRightBtn = $("#toggleRightBtn");
const rightPanel = $("#rightPanel");
const refTextarea = $("#refTextarea");
const charCount = $("#charCount");
const transcriptArea = $("#transcriptArea");
const orbCanvas = $("#orbCanvas");
const voiceView = $("#voiceView");
const sessionStartView = $("#sessionStartView");
const chatLogView = $("#chatLogView");
const chatLogMessages = $("#chatLogMessages");
const chatLogTitle = $("#chatLogTitle");
const pulseRing1 = $("#pulseRing1");
const pulseRing2 = $("#pulseRing2");
const statusDot = $("#statusDot");
const tabReferences = $("#tabReferences");
const tabChecklist = $("#tabChecklist");
const checklistItems = $("#checklistItems");
const rightPanelTabs = $("#rightPanelTabs");
const sessionTimer = $("#sessionTimer");
const transcriptPanel = $("#transcriptPanel");
const timerDisplay = $("#timerDisplay");
const startSessionBtn = $("#startSessionBtn");
const startViewScenarioLabel = $("#startViewScenarioLabel");
const tagScenario = $("#tagScenario");
const tagMode = $("#tagMode");
const helpBtn = $("#helpBtn");
const helpPanel = $("#helpPanel");
const helpInput = $("#helpInput");
const helpSendBtn = $("#helpSendBtn");
const helpResults = $("#helpResults");
const helpPanelClose = $("#helpPanelClose");
const helpBackBtn = $("#helpBackBtn");
const orbContainer = $("#orbContainer");
const myPageView = $("#myPageView");
const myPageBtn = $("#myPageBtn");
const myPageBackBtn = $("#myPageBackBtn");
const myPageTabs = $("#myPageTabs");
const notesList = $("#notesList");
const noteEditor = $("#noteEditor");
const noteEmptyState = $("#noteEmptyState");
const noteTitleInput = $("#noteTitleInput");
const noteContentInput = $("#noteContentInput");
const noteTimestamp = $("#noteTimestamp");
const noteCopyBtn = $("#noteCopyBtn");
const noteUseBtn = $("#noteUseBtn");
const noteDeleteBtn = $("#noteDeleteBtn");
const newNoteBtn = $("#newNoteBtn");
const newNoteBtnEmpty = $("#newNoteBtnEmpty");
const myPageNotesSection = $("#myPageNotesSection");
const myPageDashboardSection = $("#myPageDashboardSection");
let myPageActive = false;
let notesCache = [];
let selectedNoteId = null;
const noteSaveBtn = $("#noteSaveBtn");

// ── Drill Expressions DOM refs ──
const drillExprInput = $("#drillExprInput");
const drillExprHintInput = $("#drillExprHintInput");
const drillExprAddBtn = $("#drillExprAddBtn");
const drillExprList = $("#drillExprList");
const drillExprCount = $("#drillExprCount");
const drillExpressionsSetup = $("#drillExpressionsSetup");
const drillExpressionsLive = $("#drillExpressionsLive");
const drillExprLiveList = $("#drillExprLiveList");

// ── Drill Expressions state ──
let drillExpressions = [];       // global library (setup panel)
let sessionDrillPool = [];       // snapshot of library for matching during this session
let sessionDrillExprs = [];      // expressions actually used in this session (bound to session)
let drillUsageCounts = {};
let userTranscriptAccum = "";

// ── Timer ──
let _timerInterval = null;
let _timerStart = 0;

function startTimer() {
  _timerStart = Date.now();
  sessionTimer.classList.remove("hidden");
  _timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - _timerStart) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = String(elapsed % 60).padStart(2, "0");
    timerDisplay.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(_timerInterval);
  _timerInterval = null;
  sessionTimer.classList.add("hidden");
}

// ── Orb animation ──
const ctx = orbCanvas.getContext("2d");
const W = orbCanvas.width, H = orbCanvas.height;
const cx = W / 2, cy = H / 2;
let isActive = false;
let smoothVolume = 0;

function drawOrb(time) {
  ctx.clearRect(0, 0, W, H);
  const t = time * 0.001;
  const rawVolume = sm.recorder?.volume || 0;
  smoothVolume += (rawVolume - smoothVolume) * 0.15;

  const volumeBoost = isActive ? smoothVolume * 30 : 0;
  const baseRadius = (isActive ? 85 : 80) + volumeBoost * 0.3;
  const amplitude = (isActive ? 12 : 6) + volumeBoost * 0.6;
  const speed = isActive ? 1.8 : 0.6;
  const glowAlpha = isActive ? 0.12 + smoothVolume * 0.15 : 0.12;

  for (let layer = 3; layer >= 0; layer--) {
    const layerOffset = layer * 0.7;
    const layerAlpha = 0.06 + (3 - layer) * 0.06 + (isActive ? smoothVolume * 0.04 : 0);
    const r = baseRadius + layer * 8;
    ctx.beginPath();
    const points = 128;
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const noise =
        Math.sin(angle * 3 + t * speed + layerOffset) * amplitude * 0.6 +
        Math.sin(angle * 5 - t * speed * 0.7 + layerOffset) * amplitude * 0.3 +
        Math.sin(angle * 7 + t * speed * 1.3 + layerOffset) * amplitude * 0.15;
      const radius = r + noise;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r + amplitude);
    gradient.addColorStop(0, `rgba(108, 92, 231, ${layerAlpha + glowAlpha})`);
    gradient.addColorStop(0.6, `rgba(108, 92, 231, ${layerAlpha + 0.04})`);
    gradient.addColorStop(1, `rgba(88, 72, 200, ${layerAlpha})`);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  const coreAlpha = isActive ? 0.15 + smoothVolume * 0.25 : 0.12;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + volumeBoost * 0.5);
  coreGrad.addColorStop(0, `rgba(180, 170, 255, ${coreAlpha})`);
  coreGrad.addColorStop(1, "rgba(108, 92, 231, 0)");
  ctx.beginPath();
  ctx.arc(cx, cy, 40 + volumeBoost * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
  ctx.fill();

  requestAnimationFrame(drawOrb);
}
requestAnimationFrame(drawOrb);

// ── Labels ──
const SCENARIO_LABELS = { persuade: "Persuade", explain: "Explain", storytelling: "Story" };
const SCENARIO_FULL_LABELS = { persuade: "Persuade / Propose", explain: "Explain / Report", storytelling: "Storytelling" };
const STYLE_LABELS = { guide: "Guide", challenger: "Challenger", listener: "Listener" };

// ── State machine ──
function setState(newState) {
  state = newState;
  isActive = !["idle", "complete", "analyzing"].includes(state);

  // Hide all center views first
  voiceView.classList.add("hidden");
  sessionStartView.classList.add("hidden");
  chatLogView.classList.add("hidden");
  myPageView.classList.add("hidden");
  myPageActive = false;
  myPageBtn.classList.remove("active");
  toggleRightBtn.classList.remove("hidden");

  if (state === "idle") {
    removeActiveSessionFromSidebar();
    stopTimer();
    cleanupDrillExpressionsLive();
    // Reset right panel
    refTextarea.disabled = false;
    refTextarea.classList.remove("opacity-60", "cursor-not-allowed");
    resetRefPanel();
    renderChecklist(selectedScenario);
    const ts = tabChecklist.querySelector(".border-t");
    if (ts) ts.classList.remove("hidden");
    switchRightTab("references");
    // Show session start view
    sessionStartView.classList.remove("hidden");
    updateStartView();
    return;
  }

  if (state === "complete") {
    removeActiveSessionFromSidebar();
    stopTimer();
    hideSessionTags();
    chatLogView.classList.remove("hidden");
    if (sm.currentSession?.id) {
      loadSession(sm.currentSession.id);
    } else {
      showChatLog();
    }
    sm.loadSessions();
    return;
  }

  // Active states: show voice view
  voiceView.classList.remove("hidden");

  if (state === "analyzing") {
    stopTimer();
    hideSessionTags();
    rightPanel.classList.add("collapsed");
    rightPanelOpen = false;
    statusText.innerHTML = `
      <div class="flex flex-col items-center gap-3">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 spinner text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          <span>Making log...</span>
        </div>
        <div class="w-48 h-1 bg-base-700/50 rounded-full overflow-hidden">
          <div class="h-full bg-accent-500/60 rounded-full" style="animation: progress 3s ease-in-out infinite; width: 0%"></div>
        </div>
      </div>`;
    talkBtn.classList.add("hidden");
    endPracticeBtn.classList.add("hidden");
    return;
  }

  if (state === "connecting") {
    statusText.textContent = "Connecting...";
    talkBtn.classList.add("hidden");
    endPracticeBtn.classList.add("hidden");
  } else {
    statusText.textContent = state === "agentSpeaking" ? "Listening..." : "Listening...";
  }

  if (state === "listening" && !_timerInterval) startTimer();

  // Show End Session + Help buttons during active states
  if (["listening", "agentSpeaking"].includes(state)) {
    talkBtn.classList.remove("hidden");
    if (betaSettings.help) helpBtn.classList.remove("hidden");
    else helpBtn.classList.add("hidden");
  } else {
    talkBtn.classList.add("hidden");
    helpBtn.classList.add("hidden");
    if (helpModeActive) exitHelpMode();
  }

  endPracticeBtn.classList.add("hidden");

  // Pulse rings
  if (isActive) {
    pulseRing1.classList.remove("hidden");
    pulseRing2.classList.remove("hidden");
  } else {
    pulseRing1.classList.add("hidden");
    pulseRing2.classList.add("hidden");
  }

  // Status dot
  if (["listening", "agentSpeaking"].includes(state)) {
    statusDot.classList.remove("hidden");
    statusDot.className = state === "agentSpeaking"
      ? "w-2 h-2 rounded-full bg-accent-400 animate-pulse"
      : "w-2 h-2 rounded-full bg-green-400 animate-pulse";
  } else if (state === "connecting") {
    statusDot.classList.remove("hidden");
    statusDot.className = "w-2 h-2 rounded-full bg-yellow-400 animate-pulse";
  } else {
    statusDot.classList.add("hidden");
  }
}

// ── Session start view ──
const scenarioImage = $("#scenarioImage");
const SCENARIO_IMAGES = {
  persuade: "/images/persuade.png",
  explain: "/images/explain.png",
  storytelling: "/images/storytelling.png",
};

function updateStartView() {
  startViewScenarioLabel.textContent = SCENARIO_FULL_LABELS[selectedScenario] || selectedScenario;
  if (scenarioImage) {
    scenarioImage.src = SCENARIO_IMAGES[selectedScenario] || SCENARIO_IMAGES.persuade;
  }
}

// ── Session tags above orb ──
function showSessionTags() {
  tagScenario.textContent = SCENARIO_LABELS[selectedScenario] || selectedScenario;
  tagScenario.classList.remove("hidden");
  tagMode.textContent = STYLE_LABELS[coachingStyle] || coachingStyle;
  tagMode.classList.remove("hidden");
}

function hideSessionTags() {
  tagScenario.classList.add("hidden");
  tagMode.classList.add("hidden");
}

// ── Session Manager callbacks ──
sm.onStateChange = (s) => {
  sm._lastState = s;
  setState(s);
};
let _speakingTimeout = null;
sm.onInputTranscript = (text) => {
  addTranscript("You", text);
  addTranscriptToPanel("You", text);
  checkDrillExpressions(text);
  if (statusText && state !== "analyzing") {
    statusText.textContent = "Speaking...";
    clearTimeout(_speakingTimeout);
    _speakingTimeout = setTimeout(() => {
      if (["listening", "agentSpeaking"].includes(state)) {
        statusText.textContent = "Listening...";
      }
    }, 2000);
  }
};
sm.onOutputTranscript = (text) => {
  sessionTranscripts.push({ role: "Coach", text });
  addTranscriptToPanel("Coach", text);
};
sm.onReportReady = () => {};
sm.onStatusMessage = (msg) => {
  statusText.textContent = msg;
};
sm.onError = (msg) => {
  statusText.textContent = `Error: ${msg}`;
  console.error("[Session Error]", msg);
};
sm.onSessionsLoaded = (sessions) => renderChatHistory(sessions);

// ── Summary (post-session, from AI) ──
sm.onSummaryReady = (summary, title) => {
  // Update title in sidebar and chat log header (always — title is not beta-gated)
  if (title) {
    chatLogTitle.textContent = title;
    const sessionId = sm.currentSession?.id;
    if (sessionId) {
      const el = chatList.querySelector(`[data-session-id="${sessionId}"] .session-title-text`);
      if (el) el.textContent = title;
    }
  }
  // Summary rendering is beta-gated
  if (!betaSettings.summary) return;
  if (state === "complete" || !chatLogView.classList.contains("hidden")) {
    renderSummary(summary, sm.currentSession?.id);
  }
};

function renderSummary(summary, sessionId) {
  if (!summary) return;
  // Remove any existing summary (inside checklistItems so it gets cleared on next load)
  clearSummary();

  const container = document.createElement("div");
  container.className = "session-summary";

  // Divider
  container.innerHTML += '<div style="border-top: 1px solid var(--border-default); margin: 16px 0;"></div>';

  // Regenerate button (if sessionId known)
  if (sessionId) {
    const regenRow = document.createElement("div");
    regenRow.style.cssText = "display:flex; justify-content:flex-end; margin-bottom:8px;";
    regenRow.innerHTML = `<button class="summary-regen-btn" style="font-size:11px; color:var(--accent); background:none; border:1px solid var(--accent); padding:3px 10px; border-radius:6px; cursor:pointer;">Regenerate</button>`;
    regenRow.querySelector(".summary-regen-btn").addEventListener("click", async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = "Regenerating...";
      btn.style.opacity = "0.6";
      try {
        const res = await fetch(`/api/sessions/${sessionId}/generate-summary`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          alert(`Regenerate failed: ${data.error || res.status}`);
          btn.disabled = false;
          btn.textContent = "Regenerate";
          btn.style.opacity = "";
          return;
        }
        if (data.title) {
          chatLogTitle.textContent = data.title;
          const el = chatList.querySelector(`[data-session-id="${sessionId}"] .session-title-text`);
          if (el) el.textContent = data.title;
        }
        renderSummary(data.summary, sessionId);
      } catch (err) {
        alert(`Regenerate failed: ${err.message}`);
        btn.disabled = false;
        btn.textContent = "Regenerate";
        btn.style.opacity = "";
      }
    });
    container.appendChild(regenRow);
  }

  // Checklist reasons section — plain text, no check icons
  if (summary.checklist_reasons?.length) {
    container.innerHTML += '<p style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:10px;">Session summary</p>';
    for (const item of summary.checklist_reasons) {
      const checked = item.checked;
      const el = document.createElement("div");
      el.style.cssText = "padding: 6px 0;";
      el.innerHTML = `
        <div style="font-size:13px; font-weight:500; color:var(--text-primary);">${escapeHtml(item.label || "")}</div>
        <div style="font-size:12px; color:${checked ? "var(--success)" : "var(--warning)"}; margin-top:3px; line-height:1.5;">${escapeHtml(item.reason || "")}</div>
      `;
      container.appendChild(el);
    }
  }

  // Feedback section
  const hasStrengths = summary.strengths?.length > 0;
  const hasImprovements = summary.improvements?.length > 0;
  if (hasStrengths || hasImprovements) {
    container.innerHTML += '<div style="border-top: 1px solid var(--border-default); margin: 16px 0;"></div>';
    container.innerHTML += '<p style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:10px;">Feedback</p>';

    const feedbackList = document.createElement("div");
    feedbackList.style.cssText = "display:flex; flex-direction:column; gap:10px;";

    for (const s of (summary.strengths || [])) {
      const item = document.createElement("div");
      item.style.cssText = "display:flex; align-items:flex-start; gap:8px;";
      item.innerHTML = `
        <div style="width:8px; height:8px; border-radius:50%; background:var(--success); flex-shrink:0; margin-top:5px;"></div>
        <span style="font-size:13px; color:var(--text-primary); line-height:1.5;">${escapeHtml(s)}</span>
      `;
      feedbackList.appendChild(item);
    }
    for (const imp of (summary.improvements || [])) {
      const item = document.createElement("div");
      item.style.cssText = "display:flex; align-items:flex-start; gap:8px;";
      item.innerHTML = `
        <div style="width:8px; height:8px; border-radius:50%; background:var(--warning); flex-shrink:0; margin-top:5px;"></div>
        <span style="font-size:13px; color:var(--text-primary); line-height:1.5;">${escapeHtml(imp)}</span>
      `;
      feedbackList.appendChild(item);
    }
    container.appendChild(feedbackList);
  }

  // Model script section
  if (summary.model_script) {
    container.innerHTML += '<div style="border-top: 1px solid var(--border-default); margin: 16px 0;"></div>';
    const scriptHeader = document.createElement("div");
    scriptHeader.style.cssText = "display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;";
    scriptHeader.innerHTML = `
      <p style="font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin:0;">Model Script</p>
      <button class="model-script-copy" style="font-size:11px; color:var(--accent); background:none; border:none; cursor:pointer; padding:2px 6px; border-radius:4px; transition:color 0.2s ease;">Copy</button>
    `;
    container.appendChild(scriptHeader);

    const scriptBlock = document.createElement("div");
    scriptBlock.style.cssText = "font-size:14px; line-height:1.8; color:var(--text-primary); padding:12px 14px; border-radius:10px; background:rgba(108,92,231,0.04); border-left:3px solid var(--accent); white-space:pre-wrap;";
    scriptBlock.textContent = summary.model_script;
    container.appendChild(scriptBlock);

    scriptHeader.querySelector(".model-script-copy").addEventListener("click", (e) => {
      navigator.clipboard.writeText(summary.model_script);
      e.target.textContent = "Copied!";
      e.target.style.color = "var(--success)";
      setTimeout(() => { e.target.textContent = "Copy"; e.target.style.color = ""; }, 1200);
    });
  }

  // Append inside checklistItems so it scrolls together and gets cleared
  checklistItems.appendChild(container);
}

function renderGenerateSummaryButton(sessionId) {
  clearSummary();
  const container = document.createElement("div");
  container.className = "session-summary";
  container.innerHTML = '<div style="border-top: 1px solid var(--border-default); margin: 16px 0;"></div>';

  const btn = document.createElement("button");
  btn.className = "ref-action-btn--accent";
  btn.style.cssText = "width:100%; padding:10px; border-radius:10px; border:1px solid var(--accent); background:rgba(108,92,231,0.08); color:var(--accent); font-size:13px; font-weight:500; cursor:pointer;";
  btn.textContent = "Generate Summary";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Generating...";
    btn.style.opacity = "0.6";
    try {
      const res = await fetch(`/api/sessions/${sessionId}/generate-summary`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        alert(`Summary generation failed: ${data.error || res.status}`);
        btn.disabled = false;
        btn.textContent = "Generate Summary";
        btn.style.opacity = "";
        return;
      }
      // Update title in sidebar if returned
      if (data.title) {
        chatLogTitle.textContent = data.title;
        const el = chatList.querySelector(`[data-session-id="${sessionId}"] .session-title-text`);
        if (el) el.textContent = data.title;
      }
      clearSummary();
      renderSummary(data.summary, sessionId);
    } catch (e) {
      alert(`Summary generation failed: ${e.message}`);
      btn.disabled = false;
      btn.textContent = "Generate Summary";
      btn.style.opacity = "";
    }
  });
  container.appendChild(btn);
  checklistItems.appendChild(container);
}

function clearSummary() {
  const existing = checklistItems.querySelector(".session-summary");
  if (existing) existing.remove();
  // Also check parent (legacy placement)
  const legacy = checklistItems.parentElement.querySelector(".session-summary");
  if (legacy) legacy.remove();
}

// ── Transcript display (live, small area during session) ──
let sessionTranscripts = [];
let _lastTranscriptEl = null;
let _lastTranscriptRole = null;
let _lastTranscriptText = "";

function addTranscript(role, text) {
  if (role === _lastTranscriptRole && _lastTranscriptEl) {
    _lastTranscriptText += " " + text;
    _lastTranscriptEl.innerHTML = `<span class="font-medium">${role}:</span> ${escapeHtml(_lastTranscriptText.trim())}`;
  } else {
    if (_lastTranscriptRole && _lastTranscriptText) {
      sessionTranscripts.push({ role: _lastTranscriptRole, text: _lastTranscriptText.trim() });
    }
    _lastTranscriptRole = role;
    _lastTranscriptText = text;
    const el = document.createElement("div");
    el.className = `text-xs mb-2 ${role === "You" ? "text-[color:var(--text-secondary)]" : "text-accent-400"}`;
    el.innerHTML = `<span class="font-medium">${role}:</span> ${escapeHtml(text)}`;
    transcriptArea.appendChild(el);
    _lastTranscriptEl = el;
  }
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

function clearTranscripts() {
  transcriptArea.innerHTML = "";
  sessionTranscripts = [];
  _lastTranscriptEl = null;
  _lastTranscriptRole = null;
  _lastTranscriptText = "";
  clearTranscriptPanel();
}

function finalizeTranscripts() {
  if (_lastTranscriptRole && _lastTranscriptText) {
    sessionTranscripts.push({ role: _lastTranscriptRole, text: _lastTranscriptText.trim() });
    _lastTranscriptEl = null;
    _lastTranscriptRole = null;
    _lastTranscriptText = "";
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Right panel transcript ──
let _lastPanelRole = null;
let _lastPanelTextEl = null;

function addTranscriptToPanel(role, text) {
  if (!transcriptPanel) return;
  if (role === _lastPanelRole && _lastPanelTextEl) {
    _lastPanelTextEl.textContent += " " + text;
  } else {
    const block = document.createElement("div");
    const label = document.createElement("div");
    label.className = `text-[11px] font-semibold mb-0.5 ${role === "You" ? "text-accent-400" : "text-green-400"}`;
    label.textContent = role;
    const content = document.createElement("div");
    content.className = "text-[13px] text-[color:var(--text-secondary)] leading-relaxed";
    content.textContent = text;
    block.appendChild(label);
    block.appendChild(content);
    transcriptPanel.appendChild(block);
    _lastPanelRole = role;
    _lastPanelTextEl = content;
  }
  transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
}

function clearTranscriptPanel() {
  if (transcriptPanel) transcriptPanel.innerHTML = "";
  _lastPanelRole = null;
  _lastPanelTextEl = null;
}

// ── Right panel tabs ──
function switchRightTab(tab) {
  rightPanelTabs.querySelectorAll(".right-tab").forEach(t => t.classList.remove("active"));
  rightPanelTabs.querySelector(`[data-tab="${tab}"]`).classList.add("active");
  if (tab === "references") {
    tabReferences.classList.remove("hidden");
    tabChecklist.classList.add("hidden");
  } else {
    tabReferences.classList.add("hidden");
    tabChecklist.classList.remove("hidden");
  }
}
rightPanelTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".right-tab");
  if (btn) switchRightTab(btn.dataset.tab);
});

// ── Checklist ──
function renderChecklist(scenario) {
  const items = CHECKLISTS[scenario] || [];
  checklistItems.innerHTML = "";
  for (const item of items) {
    const el = document.createElement("div");
    el.className = "checklist-item";
    el.innerHTML = `
      <div>
        <div class="checklist-title">${escapeHtml(item.title)}</div>
        <div class="checklist-hint">${escapeHtml(item.hint)}</div>
      </div>
    `;
    checklistItems.appendChild(el);
  }
}

// ── Chat Log View (full chat-app style) ──
function showChatLog() {
  finalizeTranscripts();
  renderChatBubbles(sessionTranscripts);
}

function renderChatBubbles(transcripts) {
  chatLogMessages.innerHTML = "";
  if (!transcripts.length) {
    chatLogMessages.innerHTML = '<p class="text-center text-base-600 text-sm mt-10">No messages in this session.</p>';
    return;
  }

  const merged = [];
  for (const t of transcripts) {
    const role = t.role === "user" ? "You" : (t.role === "You" ? "You" : (t.role === "Coach" ? "Coach" : (t.role === "agent" ? "Coach" : t.role)));
    const text = (t.text || t.content || "").trim();
    if (!text) continue;
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      merged[merged.length - 1].text += " " + text;
    } else {
      merged.push({ role, text });
    }
  }

  for (const t of merged) {
    const isUser = t.role === "You";
    const wrapper = document.createElement("div");
    wrapper.className = `flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`;

    const icon = document.createElement("div");
    icon.className = `w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-base-700/40 ${isUser ? "order-2" : ""}`;
    icon.innerHTML = '<svg class="w-3.5 h-3.5 text-base-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>';

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-agent"}`;
    bubble.textContent = t.text;

    wrapper.appendChild(icon);
    wrapper.appendChild(bubble);
    chatLogMessages.appendChild(wrapper);
  }
  chatLogMessages.scrollTop = chatLogMessages.scrollHeight;
}

// ── Chat history ──
function renderChatHistory(sessions) {
  chatList.innerHTML = "";
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "chat-item rounded-xl px-3 py-2.5 cursor-pointer relative group";
    item.dataset.sessionId = s.id;
    const title = s.title || "Untitled";
    const d = s.created_at ? new Date(s.created_at) : null;
    const dateStr = d ? `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` : "";
    const scenarioTag = SCENARIO_LABELS[s.scenario] || "";
    const styleTag = STYLE_LABELS[s.coaching_style] || "";
    const meta = [dateStr, scenarioTag, styleTag].filter(Boolean).join(" · ");

    const titleSpan = document.createElement("p");
    titleSpan.className = "text-sm font-medium text-[color:var(--text-secondary)] truncate pr-5 session-title-text";
    titleSpan.textContent = title;

    const metaP = document.createElement("p");
    metaP.className = "text-[11px] text-base-600 mt-0.5";
    metaP.textContent = meta;

    // Delete button (visible on hover)
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "session-delete-btn";
    deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this session? This cannot be undone.")) return;
      await sm.deleteSession(s.id);
      item.remove();
      // If this session is currently viewed, reset to idle
      if (!chatLogView.classList.contains("hidden")) {
        exitLogViewMode();
        setState("idle");
        clearTranscripts();
      }
    });

    item.appendChild(titleSpan);
    item.appendChild(metaP);
    item.appendChild(deleteBtn);

    // Click to view session
    item.addEventListener("click", () => {
      chatList.querySelectorAll(".chat-item").forEach(el => el.classList.remove("bg-base-800/60"));
      item.classList.add("bg-base-800/60");
      loadSession(s.id);
    });

    // Double-click title to rename
    titleSpan.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.type = "text";
      input.value = titleSpan.textContent;
      input.className = "session-rename-input";
      input.maxLength = 100;

      const finish = async (save) => {
        const newTitle = input.value.trim();
        if (save && newTitle && newTitle !== titleSpan.textContent) {
          await sm.renameSession(s.id, newTitle);
          titleSpan.textContent = newTitle;
          s.title = newTitle;
        }
        input.replaceWith(titleSpan);
      };

      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
        if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
      });
      input.addEventListener("blur", () => finish(true));
      titleSpan.replaceWith(input);
      input.focus();
      input.select();
    });

    chatList.appendChild(item);
  }
}

async function loadSession(id) {
  const myLoad = ++loadSessionCounter;
  const data = await sm.getSession(id);
  if (!data || myLoad !== loadSessionCounter) return;

  const mapped = (data.transcripts || []).map((t) => ({
    role: t.role === "user" ? "You" : "Coach",
    text: t.content,
  }));
  sessionTranscripts = mapped;
  chatLogTitle.textContent = data.title || "Session Log";
  voiceView.classList.add("hidden");
  sessionStartView.classList.add("hidden");
  myPageView.classList.add("hidden");
  myPageActive = false;
  myPageBtn.classList.remove("active");
  toggleRightBtn.classList.remove("hidden");
  chatLogView.classList.remove("hidden");
  renderChatBubbles(mapped);

  if (!rightPanelOpen) {
    rightPanelOpen = true;
    rightPanel.classList.remove("collapsed");
  }

  // Reference tab: read-only with version badge if transformed
  const hasTransform = data.reference_text_transformed && data.reference_transform_mode;
  if (hasTransform) {
    // Show transformed view read-only
    refEditView.classList.add("hidden");
    refTransformedView.classList.remove("hidden");
    refVersionBadge.textContent = data.reference_transform_mode === "easy" ? "Easy version" : "Professional version";
    refVersionBadge.className = `ref-version-badge ${data.reference_transform_mode === "easy" ? "easy" : "professional"}`;
    refTransformedText.textContent = data.reference_text || "";
    refToggleOriginal.textContent = "Show original";
    // Set up toggle for log view
    let showingOrig = false;
    refToggleOriginal.onclick = () => {
      showingOrig = !showingOrig;
      refTransformedText.textContent = showingOrig ? (data.reference_text_original || "") : (data.reference_text || "");
      refToggleOriginal.textContent = showingOrig ? "Show transformed" : "Show original";
      const len = refTransformedText.textContent.length;
      charCountTransformed.textContent = len.toLocaleString() + " / 8,000";
    };
    const len = (data.reference_text || "").length;
    charCountTransformed.textContent = len.toLocaleString() + " / 8,000";
    // Hide action buttons in log view
    refBackToOriginal.classList.add("hidden");
    refUseTransformed.classList.add("hidden");
  } else {
    refEditView.classList.remove("hidden");
    refTransformedView.classList.add("hidden");
    refTextarea.value = data.reference_text || "";
    refTextarea.disabled = true;
    refTextarea.classList.add("opacity-60", "cursor-not-allowed");
    // Hide transform controls in log view
    const controls = document.getElementById("refTransformControls");
    if (controls) controls.classList.add("hidden");
    updateCharCount();
  }

  // Checklist tab: log view with metadata + frozen state
  const checklist = data.checklist || [];
  const scenario = data.scenario || "persuade";
  const checkedCount = checklist.filter(c => c.checked).length;
  const totalCount = checklist.length;

  checklistItems.innerHTML = "";

  // Metadata header
  const meta = document.createElement("div");
  meta.className = "mb-3 pb-3 border-b border-base-700/40";
  const duration = data.duration_seconds;
  const durStr = duration ? `${Math.floor(duration / 60)}m ${duration % 60}s` : "";
  const d = data.created_at ? new Date(data.created_at) : null;
  const dateStr = d ? `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` : "";
  const scenarioLabel = SCENARIO_LABELS[scenario] || scenario;
  const styleLabel = STYLE_LABELS[data.coaching_style] || "";
  const metaParts = [dateStr, scenarioLabel, styleLabel, durStr].filter(Boolean).join(" · ");
  meta.innerHTML = `
    <div class="flex items-center gap-1.5 mb-1">
      <div class="w-2 h-2 rounded-full bg-green-400"></div>
      <span class="text-xs font-medium text-green-400">Completed</span>
    </div>
    <p class="text-[11px] text-base-600">${metaParts}</p>
    <div class="mt-2 flex items-center justify-between">
      <span class="text-[10px] text-base-600">Checklist progress</span>
      <span class="text-[11px] text-base-600 tabular-nums">${checkedCount} / ${totalCount}</span>
    </div>
    <div class="mt-1 h-1 bg-base-700/50 rounded-full overflow-hidden">
      <div class="h-full bg-accent-500 rounded-full" style="width: ${totalCount ? (checkedCount / totalCount * 100) : 0}%"></div>
    </div>
  `;
  checklistItems.appendChild(meta);

  for (const item of checklist) {
    const el = document.createElement("div");
    const isChecked = !!item.checked;
    el.className = `checklist-item ${isChecked ? "checklist-item--checked" : "checklist-item--unchecked"} ${!isChecked ? "opacity-50" : ""}`;
    el.innerHTML = `
      <div class="checklist-icon">
        <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
      </div>
      <div>
        <div class="checklist-title">${escapeHtml(item.label)}</div>
        <div class="checklist-hint">${escapeHtml(item.description || "")}</div>
      </div>
    `;
    checklistItems.appendChild(el);
  }

  // Render drill expression results in history
  renderDrillExpressionsHistory(data.drill_expressions || []);

  // Render summary or show generate button
  if (data.summary && betaSettings.summary) {
    renderSummary(data.summary, id);
  } else if (betaSettings.summary && data.transcripts?.length > 0) {
    renderGenerateSummaryButton(id);
  }

  const transcriptSection = tabChecklist.querySelector(".border-t");
  if (transcriptSection) transcriptSection.classList.add("hidden");
  switchRightTab("checklist");
}

function exitLogViewMode() {
  loadSessionCounter++;
  refTextarea.disabled = false;
  refTextarea.classList.remove("opacity-60", "cursor-not-allowed");
  // Restore hidden elements from log view
  refBackToOriginal.classList.remove("hidden");
  refUseTransformed.classList.remove("hidden");
  const controls = document.getElementById("refTransformControls");
  if (controls) controls.classList.remove("hidden");
  resetRefPanel();
  renderChecklist(selectedScenario);
  const transcriptSection = tabChecklist.querySelector(".border-t");
  if (transcriptSection) transcriptSection.classList.remove("hidden");
  switchRightTab("references");
}

// ── Active session indicator in sidebar ──
let _activeSessionEl = null;

function addActiveSessionToSidebar() {
  removeActiveSessionFromSidebar();
  const item = document.createElement("div");
  item.className = "chat-item rounded-xl px-3 py-3 bg-base-800/60";
  item.id = "_activeSession";
  item.innerHTML = `
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-lg bg-accent-500/20 flex items-center justify-center flex-shrink-0">
        <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
      </div>
      <div class="min-w-0">
        <p class="text-sm font-medium text-[color:var(--text-primary)] truncate">New chat</p>
        <p class="text-xs text-accent-400 mt-0.5">In progress...</p>
      </div>
    </div>
  `;
  chatList.prepend(item);
  _activeSessionEl = item;
}

function removeActiveSessionFromSidebar() {
  if (_activeSessionEl) {
    _activeSessionEl.remove();
    _activeSessionEl = null;
  }
  const existing = document.getElementById("_activeSession");
  if (existing) existing.remove();
}

// ── Event bindings ──

// Start session from mode select
startSessionBtn.addEventListener("click", async () => {
  clearTranscripts();
  renderChecklist(selectedScenario);
  switchRightTab("checklist");
  showSessionTags();
  initDrillExpressionsLive();
  try {
    const refData = getRefSessionData();
    // New sessions start with no bound drill expressions; users add/use them during the session
    const drillIds = [];
    addActiveSessionToSidebar();
    await sm.startSession(selectedScenario, refData, coachingStyle, betaSettings, drillIds);
  } catch (e) {
    console.error("Failed to start session:", e);
    removeActiveSessionFromSidebar();
    hideSessionTags();
    setState("idle");
    statusText.textContent = `Error: ${e.message}`;
  }
});

// End Session button
talkBtn.addEventListener("click", () => {
  if (["listening", "agentSpeaking"].includes(state)) {
    sm.endSession();
  }
});

// End Practice (Full Run)
endPracticeBtn.addEventListener("click", () => {
  sm.endPractice();
});

// Back to voice view
document.getElementById("backToVoiceBtn").addEventListener("click", () => {
  sm.cleanup();
  exitLogViewMode();
  setState("idle");
  clearTranscripts();
});

// New Conversation (from chat log view)
document.getElementById("newConversationBtn").addEventListener("click", () => {
  sm.cleanup();
  exitLogViewMode();
  setState("idle");
  clearTranscripts();
});

// Right panel toggle
toggleRightBtn.addEventListener("click", () => {
  rightPanelOpen = !rightPanelOpen;
  if (rightPanelOpen) {
    rightPanel.classList.remove("collapsed");
  } else {
    rightPanel.classList.add("collapsed");
  }
});
rightPanel.querySelector("button[data-close]")?.addEventListener("click", () => {
  rightPanelOpen = false;
  rightPanel.classList.add("collapsed");
});

// Character counter
function updateCharCount() {
  const len = refTextarea.value.length;
  charCount.textContent = len.toLocaleString() + " / 8,000";
  charCount.className = "text-xs tabular-nums " +
    (len >= 8000 ? "text-red-400" : len >= 7000 ? "text-yellow-400" : "text-base-600");
}
const translateBtn = $("#translateBtn");
const translateBtnLabel = $("#translateBtnLabel");

function updateTranslateBtn() {
  const hasText = refTextarea.value.trim().length > 0;
  if (hasText) translateBtn.classList.remove("hidden");
  else translateBtn.classList.add("hidden");
}

refTextarea.addEventListener("input", () => {
  updateCharCount();
  updateTransformBtnState();
  updateTranslateBtn();
});
refTextarea.addEventListener("paste", () => {
  // paste event fires before value updates, so defer
  setTimeout(() => { updateCharCount(); updateTransformBtnState(); updateTranslateBtn(); }, 0);
});

translateBtn.addEventListener("mousedown", (e) => {
  // Prevent textarea blur when clicking translate
  e.preventDefault();
});
translateBtn.addEventListener("click", async () => {
  const text = refTextarea.value.trim();
  if (!text) return;
  // Keep textarea expanded during translation
  refTextarea.classList.add("expanded");
  translateBtn.disabled = true;
  translateBtnLabel.textContent = "Translating...";
  try {
    const res = await fetch("/api/reference/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_lang: "English" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const msg = data.error || `Translation failed (${res.status})`;
      console.error("Translation failed:", msg);
      alert(`Translation failed: ${msg}`);
      return;
    }
    if (data.translated_text) {
      refTextarea.value = data.translated_text;
      updateCharCount();
      updateTransformBtnState();
    }
  } catch (e) {
    console.error("Translation failed:", e);
    alert(`Translation failed: ${e.message || e}`);
  } finally {
    translateBtn.disabled = false;
    translateBtnLabel.textContent = "Translate to English";
    refTextarea.classList.remove("expanded");
  }
});

// ── Reference text transformation ──
const refEditView = $("#refEditView");
const refTransformedView = $("#refTransformedView");
const transformModePills = $("#transformModePills");
const transformBtn = $("#transformBtn");
const refVersionBadge = $("#refVersionBadge");
const refToggleOriginal = $("#refToggleOriginal");
const refTransformedText = $("#refTransformedText");
const charCountTransformed = $("#charCountTransformed");
const refBackToOriginal = $("#refBackToOriginal");
const refUseTransformed = $("#refUseTransformed");

let refState = {
  originalText: "",
  transformedText: null,
  activeVersion: "original", // "original" | "transformed"
  transformMode: null,       // "easy" | "professional"
  showingOriginal: false,    // toggle in transformed view
};

const useAsIsBtn = $("#useAsIsBtn");

function updateTransformBtnState() {
  const hasText = refTextarea.value.trim().length > 0;
  const hasMode = refState.transformMode !== null;
  transformBtn.disabled = !(hasText && hasMode);
  // Show "Use this version" when there's text
  if (hasText) useAsIsBtn.classList.remove("hidden");
  else useAsIsBtn.classList.add("hidden");
}

useAsIsBtn.addEventListener("click", () => {
  refState.originalText = refTextarea.value.trim();
  refState.activeVersion = "original";
  // Collapse right panel and focus on start
  rightPanelOpen = false;
  rightPanel.classList.add("collapsed");
  if (state === "idle") {
    sessionStartView.classList.remove("hidden");
    sessionStartView.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

// Mode pills
transformModePills.addEventListener("click", (e) => {
  const pill = e.target.closest(".ref-mode-pill");
  if (!pill) return;
  transformModePills.querySelectorAll(".ref-mode-pill").forEach(p => p.classList.remove("selected"));
  pill.classList.add("selected");
  refState.transformMode = pill.dataset.transformMode;
  updateTransformBtnState();
});

// Generate button
transformBtn.addEventListener("click", async () => {
  const text = refTextarea.value.trim();
  if (!text || !refState.transformMode) return;

  refState.originalText = text;

  // Loading state
  transformBtn.disabled = true;
  refTextarea.disabled = true;
  refTextarea.value = "";
  refTextarea.style.minHeight = "200px";
  refTextarea.style.display = "flex";
  refTextarea.style.alignItems = "center";
  refTextarea.style.justifyContent = "center";
  // Show loading in textarea area
  const loadingHtml = `<div style="display:flex; flex-direction:column; align-items:center; gap:8px; padding:40px 0;">
    <div class="ref-spinner"></div>
    <span style="font-size:13px; color:var(--text-muted);">Rewriting for ${refState.transformMode === "easy" ? "easy" : "professional"} speaking...</span>
  </div>`;
  refTextarea.style.display = "none";
  const loadingDiv = document.createElement("div");
  loadingDiv.id = "_refLoading";
  loadingDiv.className = "w-full rounded-xl bg-base-800/80 border border-base-700/50 px-4 py-3";
  loadingDiv.style.cssText = "min-height:200px; display:flex; align-items:center; justify-content:center;";
  loadingDiv.innerHTML = loadingHtml;
  refTextarea.parentElement.insertBefore(loadingDiv, refTextarea);

  try {
    const res = await fetch("/api/reference/transform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: refState.originalText, mode: refState.transformMode, scenario: selectedScenario }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    refState.transformedText = data.transformed_text;
    refState.activeVersion = "transformed";
    refState.showingOriginal = false;
    showTransformedView();
  } catch (e) {
    console.error("Transform failed:", e);
    // Revert to edit view
    refTextarea.value = refState.originalText;
    refTextarea.disabled = false;
    refTextarea.style.display = "";
    updateCharCount();
  } finally {
    const ld = document.getElementById("_refLoading");
    if (ld) ld.remove();
    refTextarea.style.display = "";
    refTextarea.disabled = false;
    transformBtn.disabled = false;
  }
});

function showTransformedView() {
  refEditView.classList.add("hidden");
  refTransformedView.classList.remove("hidden");

  // Badge
  refVersionBadge.textContent = refState.transformMode === "easy" ? "Easy version" : "Professional version";
  refVersionBadge.className = `ref-version-badge ${refState.transformMode === "easy" ? "easy" : "professional"}`;

  // Show transformed text
  refTransformedText.textContent = refState.transformedText;
  refToggleOriginal.textContent = "Show original";
  refState.showingOriginal = false;

  // Char count
  const len = refState.transformedText.length;
  charCountTransformed.textContent = len.toLocaleString() + " / 8,000";
  charCountTransformed.className = "text-xs tabular-nums text-base-600";
}

function showEditView() {
  refTransformedView.classList.add("hidden");
  refEditView.classList.remove("hidden");
  refTextarea.value = refState.originalText;
  refTextarea.disabled = false;
  updateCharCount();
  refState.activeVersion = "original";
  refState.transformedText = null;
  refState.transformMode = null;
  transformModePills.querySelectorAll(".ref-mode-pill").forEach(p => p.classList.remove("selected"));
  updateTransformBtnState();
}

// Toggle original/transformed in transformed view
refToggleOriginal.addEventListener("click", () => {
  refState.showingOriginal = !refState.showingOriginal;
  if (refState.showingOriginal) {
    refTransformedText.textContent = refState.originalText;
    refToggleOriginal.textContent = "Show transformed";
    const len = refState.originalText.length;
    charCountTransformed.textContent = len.toLocaleString() + " / 8,000";
  } else {
    refTransformedText.textContent = refState.transformedText;
    refToggleOriginal.textContent = "Show original";
    const len = refState.transformedText.length;
    charCountTransformed.textContent = len.toLocaleString() + " / 8,000";
  }
});

// Back to original
refBackToOriginal.addEventListener("click", showEditView);

// Use this version — confirm and keep transformed as active
refUseTransformed.addEventListener("click", () => {
  refState.activeVersion = "transformed";
  // Collapse right panel and focus on mode selection
  rightPanelOpen = false;
  rightPanel.classList.add("collapsed");
  if (state === "idle") {
    sessionStartView.classList.remove("hidden");
    sessionStartView.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

// Get active reference text (called when starting session)
function getActiveReferenceText() {
  if (refState.activeVersion === "transformed" && refState.transformedText) {
    return refState.transformedText;
  }
  return refTextarea.value.trim();
}

function getRefSessionData() {
  const active = getActiveReferenceText();
  return {
    reference_text: active || null,
    reference_text_original: refState.originalText || refTextarea.value.trim() || null,
    reference_text_transformed: refState.transformedText || null,
    reference_transform_mode: refState.transformedText ? refState.transformMode : null,
  };
}

// Reset ref panel to edit view (called on session end/back)
function resetRefPanel() {
  refState = { originalText: "", transformedText: null, activeVersion: "original", transformMode: null, showingOriginal: false };
  showEditView();
  refTextarea.value = "";
  updateCharCount();
}

// ── Help me say this ──
let helpModeActive = false;

function enterHelpMode() {
  if (helpModeActive) return;
  helpModeActive = true;
  helpBtn.classList.add("active");
  helpPanel.classList.remove("hidden");
  orbContainer.classList.add("dimmed");
  statusText.textContent = "Paused — getting expression help";
  helpInput.focus();
  helpResults.innerHTML = "";
  // Notify server to suppress audio
  sm.wsClient?.sendHelpMode(true);
}

function exitHelpMode() {
  if (!helpModeActive) return;
  helpModeActive = false;
  helpBtn.classList.remove("active");
  helpPanel.classList.add("hidden");
  orbContainer.classList.remove("dimmed");
  helpInput.value = "";
  helpResults.innerHTML = "";
  // Resume audio
  sm.wsClient?.sendHelpMode(false);
  // Restore status text
  if (["listening", "agentSpeaking"].includes(state)) {
    statusText.textContent = "Listening...";
  }
}

async function submitHelpQuery() {
  const query = helpInput.value.trim();
  if (!query) return;
  helpSendBtn.disabled = true;
  helpResults.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">...</div>';
  try {
    const res = await fetch("/api/expression-help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, session_id: sm.currentSession?.id }),
    });
    const data = await res.json();
    if (data.expressions?.length) {
      helpResults.innerHTML = data.expressions.map(e =>
        `<div class="help-result-item"><span class="arrow">&rarr;</span><span>${escapeHtml(e)}</span></div>`
      ).join("");
    } else {
      helpResults.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">No suggestions found</div>';
    }
  } catch (e) {
    helpResults.innerHTML = '<div style="color:var(--danger); font-size:13px;">Error getting suggestions</div>';
  } finally {
    helpSendBtn.disabled = false;
  }
}

helpBtn.addEventListener("click", () => {
  if (helpModeActive) exitHelpMode();
  else enterHelpMode();
});
helpPanelClose.addEventListener("click", exitHelpMode);
helpBackBtn.addEventListener("click", exitHelpMode);
helpSendBtn.addEventListener("click", submitHelpQuery);
helpInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); submitHelpQuery(); }
  if (e.key === "Escape") { e.preventDefault(); exitHelpMode(); }
});

// Keyboard shortcut: Ctrl+H / Cmd+H to toggle help
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "h") {
    e.preventDefault();
    if (!["listening", "agentSpeaking"].includes(state)) return;
    if (helpModeActive) exitHelpMode();
    else enterHelpMode();
  }
  // Esc closes help panel if open
  if (e.key === "Escape" && helpModeActive) {
    exitHelpMode();
  }
});

// ── Scenario selection ──
document.getElementById("scenarioList").addEventListener("click", (e) => {
  const card = e.target.closest(".scenario-card");
  if (!card) return;
  document.querySelectorAll(".scenario-card").forEach(c => c.classList.remove("active"));
  card.classList.add("active");
  selectedScenario = card.dataset.scenario;

  // If viewing a log, go back to start view
  if (state === "complete" || chatLogView.classList.contains("hidden") === false) {
    sm.cleanup();
    exitLogViewMode();
    setState("idle");
    clearTranscripts();
  } else if (state === "idle") {
    renderChecklist(selectedScenario);
    updateStartView();
  }
});

// ── Settings modal ──
const settingsModal = $("#settingsModal");
const settingsBtn = $("#settingsBtn");
const settingsClose = $("#settingsClose");
const betaSummaryToggle = $("#betaSummaryToggle");
const betaChecklistToggle = $("#betaChecklistToggle");
const betaHelpToggle = $("#betaHelpToggle");
const coachingStyleSelect = $("#coachingStyleSelect");

function openSettings() {
  betaSummaryToggle.checked = betaSettings.summary;
  betaChecklistToggle.checked = betaSettings.checklist;
  betaHelpToggle.checked = betaSettings.help;
  coachingStyleSelect.value = coachingStyle;
  settingsModal.classList.add("active");
}

function closeSettings() {
  settingsModal.classList.remove("active");
}

settingsBtn.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Toggle handlers — save immediately
betaSummaryToggle.addEventListener("change", () => {
  betaSettings.summary = betaSummaryToggle.checked;
  saveSettings(betaSettings);
});
betaChecklistToggle.addEventListener("change", () => {
  betaSettings.checklist = betaChecklistToggle.checked;
  saveSettings(betaSettings);
});
betaHelpToggle.addEventListener("change", () => {
  betaSettings.help = betaHelpToggle.checked;
  saveSettings(betaSettings);
});
coachingStyleSelect.addEventListener("change", () => {
  coachingStyle = coachingStyleSelect.value;
  saveCoachingStyle(coachingStyle);
});

// ── My Page ──

function enterMyPage() {
  // Clean up if viewing log
  if (state === "complete" || !chatLogView.classList.contains("hidden")) {
    sm.cleanup();
    exitLogViewMode();
  }

  myPageActive = true;
  myPageBtn.classList.add("active");

  // Hide all center views, show My Page
  voiceView.classList.add("hidden");
  sessionStartView.classList.add("hidden");
  chatLogView.classList.add("hidden");
  myPageView.classList.remove("hidden");

  // Hide right sidebar
  rightPanel.classList.add("collapsed");
  rightPanelOpen = false;
  toggleRightBtn.classList.add("hidden");

  loadNotes();
}

function exitMyPage() {
  myPageActive = false;
  myPageBtn.classList.remove("active");
  myPageView.classList.add("hidden");
  toggleRightBtn.classList.remove("hidden");
  selectedNoteId = null;
  setState("idle");
}

async function loadNotes() {
  try {
    const res = await fetch("/api/notes");
    notesCache = await res.json();
    renderNotesList();
  } catch (e) {
    console.error("Failed to load notes:", e);
  }
}

async function createNote() {
  try {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", content: "" }),
    });
    const note = await res.json();
    notesCache.unshift(note);
    renderNotesList();
    selectNote(note.id);
    noteTitleInput.focus();
  } catch (e) {
    console.error("Failed to create note:", e);
  }
}

async function saveNote() {
  if (!selectedNoteId) return;
  const title = noteTitleInput.value;
  const content = noteContentInput.value;
  try {
    const res = await fetch(`/api/notes/${selectedNoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    const updated = await res.json();
    const idx = notesCache.findIndex(n => n.id === selectedNoteId);
    if (idx >= 0) notesCache[idx] = updated;
    renderNotesList();
    // Update timestamp display
    noteTimestamp.textContent = `Updated just now`;
    // Save feedback
    noteSaveBtn.innerHTML = `<svg class="w-3.5 h-3.5 inline -mt-px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Saved`;
    noteSaveBtn.classList.add("saved");
    setTimeout(() => {
      noteSaveBtn.textContent = "Save";
      noteSaveBtn.classList.remove("saved");
    }, 1500);
  } catch (e) {
    console.error("Failed to save note:", e);
  }
}

async function deleteNote(noteId) {
  if (!confirm("Delete this note?")) return;
  try {
    await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    notesCache = notesCache.filter(n => n.id !== noteId);
    if (selectedNoteId === noteId) {
      selectedNoteId = null;
      noteEditor.classList.add("hidden");
      noteEmptyState.classList.remove("hidden");
    }
    renderNotesList();
  } catch (e) {
    console.error("Failed to delete note:", e);
  }
}

function renderNotesList() {
  notesList.innerHTML = "";
  if (notesCache.length === 0) {
    notesList.innerHTML = '<p class="text-center text-base-600 text-xs mt-8 px-4">No notes yet</p>';
    return;
  }
  for (const note of notesCache) {
    const el = document.createElement("div");
    el.className = `note-item ${note.id === selectedNoteId ? "active" : ""}`;
    el.dataset.noteId = note.id;
    const title = note.title || "Untitled";
    const preview = (note.content || "").slice(0, 60).replace(/\n/g, " ");
    const d = note.updated_at ? new Date(note.updated_at) : null;
    const dateStr = d && !isNaN(d) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    el.innerHTML = `
      <div class="note-item-title">${escapeHtml(title)}</div>
      ${preview ? `<div class="note-item-preview">${escapeHtml(preview)}</div>` : ""}
      <div class="note-item-date">${dateStr}</div>
    `;
    el.addEventListener("click", () => selectNote(note.id));
    notesList.appendChild(el);
  }
}

function selectNote(noteId) {
  selectedNoteId = noteId;
  const note = notesCache.find(n => n.id === noteId);
  if (!note) return;

  noteEmptyState.classList.add("hidden");
  noteEditor.classList.remove("hidden");

  noteTitleInput.value = note.title || "";
  noteContentInput.value = note.content || "";

  const d = note.updated_at ? new Date(note.updated_at) : null;
  noteTimestamp.textContent = d && !isNaN(d) ? `Updated ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "";

  notesList.querySelectorAll(".note-item").forEach(el => el.classList.remove("active"));
  const active = notesList.querySelector(`[data-note-id="${noteId}"]`);
  if (active) active.classList.add("active");
}

// My Page event bindings
myPageBtn.addEventListener("click", enterMyPage);
myPageBackBtn.addEventListener("click", exitMyPage);
newNoteBtn.addEventListener("click", createNote);
newNoteBtnEmpty.addEventListener("click", createNote);
noteSaveBtn.addEventListener("click", saveNote);
noteDeleteBtn.addEventListener("click", () => { if (selectedNoteId) deleteNote(selectedNoteId); });

noteCopyBtn.addEventListener("click", () => {
  if (!selectedNoteId) return;
  const note = notesCache.find(n => n.id === selectedNoteId);
  if (!note) return;
  navigator.clipboard.writeText(note.content || "");
  noteCopyBtn.style.color = "var(--success)";
  setTimeout(() => { noteCopyBtn.style.color = ""; }, 1000);
});

noteUseBtn.addEventListener("click", () => {
  if (!selectedNoteId) return;
  const note = notesCache.find(n => n.id === selectedNoteId);
  if (!note?.content) return;
  exitMyPage();
  refTextarea.value = note.content;
  updateCharCount();
  updateTransformBtnState();
  updateTranslateBtn();
  rightPanelOpen = true;
  rightPanel.classList.remove("collapsed");
  switchRightTab("references");
});

myPageTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".mypage-tab");
  if (!tab || tab.disabled) return;
  myPageTabs.querySelectorAll(".mypage-tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");
  const tabName = tab.dataset.mypageTab;
  myPageNotesSection.classList.toggle("hidden", tabName !== "notes");
  myPageDashboardSection.classList.toggle("hidden", tabName !== "dashboard");
});

// ── Logo: back to root ──
document.getElementById("logoBtn").addEventListener("click", (e) => {
  e.preventDefault();
  sm.cleanup();
  if (!chatLogView.classList.contains("hidden")) {
    exitLogViewMode();
  }
  setState("idle");
  clearTranscripts();
});

// ── Drill Expressions ──


function renderDrillExprSetup() {
  drillExprList.innerHTML = "";
  drillExprCount.textContent = drillExpressions.length ? `${drillExpressions.length}` : "";
  for (const expr of drillExpressions) {
    const card = document.createElement("div");
    card.className = "drill-setup-card";
    card.innerHTML = `
      <div class="drill-card-content">
        <span class="drill-card-expression text-sm text-[color:var(--text-primary)]">${escapeHtml(expr.expression)}</span>
        ${expr.hint ? `<span class="drill-card-hint">${escapeHtml(expr.hint)}</span>` : ""}
      </div>
      <button class="drill-delete-btn" data-id="${expr.id}" title="Remove">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    `;
    card.querySelector(".drill-delete-btn").addEventListener("click", async () => {
      await sm.deleteDrillExpression(expr.id);
      drillExpressions = drillExpressions.filter(e => e.id !== expr.id);
      renderDrillExprSetup();
    });
    drillExprList.appendChild(card);
  }
}

drillExprAddBtn.addEventListener("click", async () => {
  const expr = drillExprInput.value.trim();
  if (!expr) return;
  const hint = drillExprHintInput.value.trim() || null;
  const created = await sm.createDrillExpression(expr, hint);
  drillExprInput.value = "";
  drillExprHintInput.value = "";
  drillExprHintInput.classList.add("hidden");
  if (created) {
    drillExpressions.push(created);
    renderDrillExprSetup();
  }
});

drillExprInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") drillExprAddBtn.click();
});

drillExprInput.addEventListener("input", () => {
  if (drillExprInput.value.trim()) {
    drillExprHintInput.classList.remove("hidden");
  } else {
    drillExprHintInput.classList.add("hidden");
  }
});

function initDrillExpressionsLive() {
  // Session starts with empty bound list; match against a snapshot of the global library.
  sessionDrillPool = drillExpressions.map(e => ({ ...e, _lastDetected: 0 }));
  sessionDrillExprs = [];
  drillUsageCounts = {};
  userTranscriptAccum = "";
  drillExprLiveList.innerHTML = "";
  // Hide section until the first detected use.
  drillExpressionsLive.classList.add("hidden");
}

function addDrillToLiveSession(expr) {
  sessionDrillExprs.push(expr);
  drillUsageCounts[expr.id] = 0;
  drillExpressionsLive.classList.remove("hidden");
  const card = document.createElement("div");
  card.className = "drill-card drill-card--unused";
  card.dataset.drillId = expr.id;
  card.innerHTML = `
    <div class="drill-card-content">
      <span class="drill-card-expression">${escapeHtml(expr.expression)}</span>
      ${expr.hint ? `<span class="drill-card-hint">${escapeHtml(expr.hint)}</span>` : ""}
    </div>
    <span class="drill-count-badge"></span>
  `;
  drillExprLiveList.appendChild(card);
}

function checkDrillExpressions(text) {
  if (sessionDrillPool.length === 0) return;
  userTranscriptAccum += " " + text;
  const lower = userTranscriptAccum.toLowerCase();
  const now = Date.now();
  for (const expr of sessionDrillPool) {
    const exprLower = expr.expression.toLowerCase();
    if (lower.includes(exprLower) && now - (expr._lastDetected || 0) > 5000) {
      expr._lastDetected = now;
      // First detected use this session → bind it to the session
      if (!(expr.id in drillUsageCounts)) {
        addDrillToLiveSession(expr);
      }
      drillUsageCounts[expr.id] = (drillUsageCounts[expr.id] || 0) + 1;
      sm.wsClient?.sendDrillExpressionUsed(expr.id);
      updateDrillCardLive(expr.id);
    }
  }
}

function updateDrillCardLive(exprId) {
  const card = drillExprLiveList.querySelector(`[data-drill-id="${exprId}"]`);
  if (!card) return;
  const count = drillUsageCounts[exprId] || 0;
  const badge = card.querySelector(".drill-count-badge");
  badge.textContent = count > 0 ? `x${count}` : "";
  if (count > 0) {
    card.classList.remove("drill-card--unused");
    card.classList.add("drill-card--used");
  }
  card.classList.add("drill-card--flash");
  setTimeout(() => card.classList.remove("drill-card--flash"), 800);
}

function cleanupDrillExpressionsLive() {
  sessionDrillPool = [];
  sessionDrillExprs = [];
  drillUsageCounts = {};
  userTranscriptAccum = "";
  drillExpressionsLive.classList.add("hidden");
  drillExprLiveList.innerHTML = "";
}

function renderDrillExpressionsHistory(drillExprs) {
  // Remove any previous drill history section
  const prev = checklistItems.querySelector(".drill-history-section");
  if (prev) prev.remove();
  if (!drillExprs || drillExprs.length === 0) return;

  const section = document.createElement("div");
  section.className = "drill-history-section mb-3 pb-3 border-b border-base-700/40";
  section.innerHTML = `<p class="text-[10px] font-semibold uppercase tracking-widest text-base-600 mb-2">Drill Expressions</p>`;
  for (const de of drillExprs) {
    const used = de.use_count > 0;
    const card = document.createElement("div");
    card.className = `drill-card ${used ? "drill-card--used" : "drill-card--unused"} ${!used ? "opacity-50" : ""} mb-1.5`;
    card.innerHTML = `
      <div class="drill-card-content">
        <span class="drill-card-expression">${escapeHtml(de.expression_text)}</span>
        ${de.hint ? `<span class="drill-card-hint">${escapeHtml(de.hint)}</span>` : ""}
      </div>
      <span class="drill-count-badge">${de.use_count > 0 ? "x" + de.use_count : ""}</span>
    `;
    section.appendChild(card);
  }
  // Insert after metadata, before checklist items
  const firstChecklist = checklistItems.querySelector(".checklist-item");
  if (firstChecklist) {
    checklistItems.insertBefore(section, firstChecklist);
  } else {
    checklistItems.appendChild(section);
  }
}

// ── Init ──
sm.loadSessions();
// Drill expressions start empty each fresh page load; users add per-session.
renderDrillExprSetup();
setState("idle");
