//! Typed Tauri event emission for a single COPC conversion job.
//!
//! All raw `AppHandle::emit` calls are isolated here so the rest of the
//! conversion code never constructs payload structs manually.
//!
//! [`ConversionEmitter`] is cheap to clone — the inner `AppHandle` is an
//! `Arc`-wrapped handle.

use tauri::Emitter;

// ── Event names ───────────────────────────────────────────────────────────────

pub const EVT_PROGRESS: &str = "conversion_progress";
pub const EVT_DONE: &str = "conversion_done";
pub const EVT_ERROR: &str = "conversion_error";

// ── Payload types ─────────────────────────────────────────────────────────────

/// Emitted on `EVT_PROGRESS` and `EVT_ERROR`.
#[derive(serde::Serialize, Clone)]
pub struct ProgressPayload {
    pub project_id: String,
    pub message: String,
    /// 0–100, or `None` for indeterminate log lines.
    pub percent: Option<f64>,
    /// 1 = reading/indexing, 2 = writing.  `None` = plain log line.
    pub phase: Option<u8>,
}

/// Emitted on `EVT_DONE`.
#[derive(serde::Serialize, Clone)]
pub struct DonePayload {
    pub project_id: String,
}

// ── Emitter ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct ConversionEmitter {
    app: tauri::AppHandle,
    project_id: String,
}

impl ConversionEmitter {
    pub fn new(app: tauri::AppHandle, project_id: impl Into<String>) -> Self {
        Self { app, project_id: project_id.into() }
    }

    /// Emit a plain log line with no phase or percentage.
    pub fn log(&self, message: impl Into<String>) {
        self.emit_progress(message.into(), None, None);
    }

    /// Emit a phase-specific percentage update.
    pub fn phase_percent(&self, phase: u8, percent: f64) {
        let message = match phase {
            1 => format!("Reading… {:.0}%", percent),
            _ => format!("Writing… {:.0}%", percent),
        };
        self.emit_progress(message, Some(percent), Some(phase));
    }

    /// Signal successful completion.
    pub fn done(&self) {
        let _ = self.app.emit(
            EVT_DONE,
            DonePayload { project_id: self.project_id.clone() },
        );
    }

    /// Signal a fatal error.  The message is surfaced in the UI log panel.
    pub fn error(&self, message: impl Into<String>) {
        let _ = self.app.emit(
            EVT_ERROR,
            ProgressPayload {
                project_id: self.project_id.clone(),
                message: message.into(),
                percent: None,
                phase: None,
            },
        );
    }

    // ── Private ──────────────────────────────────────────────────────────────

    fn emit_progress(&self, message: String, percent: Option<f64>, phase: Option<u8>) {
        let _ = self.app.emit(
            EVT_PROGRESS,
            ProgressPayload {
                project_id: self.project_id.clone(),
                message,
                percent,
                phase,
            },
        );
    }
}
