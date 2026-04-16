// WebSocket client for /ws/{sessionId}
export class WebSocketClient {
  constructor() {
    this.ws = null;
    // Callbacks — set by consumer
    this.onAudio = null;
    this.onInputTranscript = null;
    this.onOutputTranscript = null;
    this.onTurnComplete = null;
    this.onInterrupted = null;
    this.onSessionEnded = null;
    this.onReportReady = null;
    this.onStatus = null;
    this.onError = null;
    this.onClose = null;
    this.onChecklistUpdate = null;
    this.onSummaryReady = null;
  }

  connect(sessionId) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws/${sessionId}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[WS] Connected");
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "audio":
          this.onAudio?.(msg.data);
          break;
        case "input_transcript":
          this.onInputTranscript?.(msg.text);
          break;
        case "output_transcript":
          this.onOutputTranscript?.(msg.text);
          break;
        case "turn_complete":
          this.onTurnComplete?.();
          break;
        case "interrupted":
          this.onInterrupted?.();
          break;
        case "session_ended":
          this.onSessionEnded?.();
          break;
        case "report_ready":
          this.onReportReady?.(msg.url);
          break;
        case "status":
          this.onStatus?.(msg.message);
          break;
        case "error":
          this.onError?.(msg.message);
          break;
        case "checklist_update":
          this.onChecklistUpdate?.(msg.item_index, msg.checked);
          break;
        case "summary_ready":
          this.onSummaryReady?.(msg.summary, msg.title);
          break;
      }
    };

    this.ws.onclose = () => {
      console.log("[WS] Closed");
      this.onClose?.();
    };

    this.ws.onerror = (err) => {
      console.error("[WS] Error:", err);
    };
  }

  sendAudio(base64) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "audio", data: base64 }));
    }
  }

  sendEndPractice() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "end_practice" }));
    }
  }

  sendEndSession() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "end_session" }));
    }
  }

  sendChecklistManual(itemIndex, checked) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "checklist_manual", item_index: itemIndex, checked }));
    }
  }

  sendHelpMode(active) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "help_mode", active }));
    }
  }

  sendDrillExpressionUsed(expressionId) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "drill_expression_used", expression_id: expressionId }));
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
