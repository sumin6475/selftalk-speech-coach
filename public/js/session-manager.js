// Session lifecycle, API calls, audio pipeline orchestration
import { AudioRecorder } from "./audio-recorder.js";
import { AudioStreamer } from "./audio-streamer.js";
import { WebSocketClient } from "./websocket-client.js";

export class SessionManager {
  constructor() {
    this.recorder = new AudioRecorder();
    this.streamer = new AudioStreamer();
    this.wsClient = new WebSocketClient();

    this.currentSession = null;
    this._lastState = "idle";

    // Event callbacks — set by UIController
    this.onStateChange = null;
    this.onInputTranscript = null;
    this.onOutputTranscript = null;
    this.onReportReady = null;
    this.onStatusMessage = null;
    this.onError = null;
    this.onSessionsLoaded = null;
    this.onChecklistUpdate = null;
    this.onSummaryReady = null;
  }

  // ── API calls ──

  async createSession(scenario, refData, coachingStyle, betaFlags, drillExpressionIds) {
    const body = {
      scenario: scenario || "persuade",
      coaching_style: coachingStyle || "guide",
    };
    if (typeof refData === "string") {
      body.reference_text = refData || null;
    } else if (refData && typeof refData === "object") {
      Object.assign(body, refData);
    }
    if (betaFlags) body.beta_flags = betaFlags;
    if (drillExpressionIds?.length) body.drill_expression_ids = drillExpressionIds;
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  }

  async loadSessions() {
    const res = await fetch("/api/sessions");
    const sessions = await res.json();
    this.onSessionsLoaded?.(sessions);
    return sessions;
  }

  async renameSession(id, title) {
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return await res.json();
  }

  async deleteSession(id) {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  }

  async getSession(id) {
    const res = await fetch(`/api/sessions/${id}`);
    return await res.json();
  }

  getReportUrl(sessionId) {
    return `/api/sessions/${sessionId}/report`;
  }

  // ── Drill Expressions ──

  async listDrillExpressions() {
    const res = await fetch("/api/drill-expressions");
    return await res.json();
  }

  async createDrillExpression(expression, hint) {
    const res = await fetch("/api/drill-expressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression, hint: hint || null }),
    });
    return await res.json();
  }

  async deleteDrillExpression(id) {
    await fetch(`/api/drill-expressions/${id}`, { method: "DELETE" });
  }

  // ── Voice session ──

  async startSession(scenario, refData, coachingStyle, betaFlags, drillExpressionIds) {
    // Create session via API
    this.currentSession = await this.createSession(scenario, refData, coachingStyle, betaFlags, drillExpressionIds);
    const sessionId = this.currentSession.id;

    // Set up WebSocket callbacks
    this.wsClient.onAudio = (data) => {
      this.streamer.addChunk(data);
      this.onStateChange?.("agentSpeaking");
    };
    this.wsClient.onInputTranscript = (text) => {
      this.onInputTranscript?.(text);
    };
    this.wsClient.onOutputTranscript = (text) => {
      this.onOutputTranscript?.(text);
    };
    this.wsClient.onTurnComplete = () => {
      this.onStateChange?.("listening");
    };
    this.wsClient.onInterrupted = () => {
      this.streamer.clearQueue();
      this.onStateChange?.("listening");
    };
    this.wsClient.onSessionEnded = () => {
      this.stopRecording();
      this.onStateChange?.("complete");
    };
    this.wsClient.onReportReady = (url) => {
      this.onReportReady?.(url);
    };
    this.wsClient.onStatus = (message) => {
      this.onStatusMessage?.(message);
    };
    this.wsClient.onChecklistUpdate = (itemIndex, checked) => {
      this.onChecklistUpdate?.(itemIndex, checked);
    };
    this.wsClient.onSummaryReady = (summary, title) => {
      this.onSummaryReady?.(summary, title);
    };
    this._hadError = false;
    this._userEndedSession = false;
    this.wsClient.onError = (message) => {
      this._hadError = true;
      this.onError?.(message);
    };
    this.wsClient.onClose = () => {
      clearTimeout(this._endTimeout);
      this.stopRecording();
      if (this._hadError || this._lastState === "connecting") {
        this.onStateChange?.("idle");
      } else if (this._userEndedSession) {
        this.onStateChange?.("complete");
      } else {
        this.onStatusMessage?.("Session disconnected. Your progress has been saved.");
        this.onStateChange?.("idle");
      }
    };

    // Connect WebSocket
    this.onStateChange?.("connecting");
    this._lastState = "connecting";

    await new Promise((resolve, reject) => {
      this.wsClient.connect(sessionId);
      this.wsClient.ws.addEventListener("open", () => resolve(), { once: true });
      this.wsClient.ws.addEventListener("error", (e) => reject(e), { once: true });
    });

    // Start audio
    this.streamer.init();
    this.recorder.onAudioData = (base64) => {
      this.wsClient.sendAudio(base64);
    };
    await this.recorder.start();

    this.onStateChange?.("listening");
  }

  endPractice() {
    this.wsClient.sendEndPractice();
    this.onStateChange?.("analyzing");
  }

  endSession() {
    this._userEndedSession = true;
    this.onStateChange?.("analyzing");
    this.stopRecording();
    this.wsClient.sendEndSession();
    this._endTimeout = setTimeout(() => {
      this.wsClient.close();
      this.onStateChange?.("complete");
    }, 5000);
  }

  stopRecording() {
    this.recorder.stop();
    this.streamer.stop();
  }

  cleanup() {
    this.stopRecording();
    this.wsClient.close();
    this.currentSession = null;
  }
}
