//! Filesystem-based two-phase progress watcher for `pdal translate`.
//!
//! PDAL's `translate` kernel exposes no streaming progress API, so we derive
//! percentages entirely from filesystem observations:
//!
//! ## Phase 1 — reading / octree indexing
//!
//! PDAL accumulates all points in memory before writing a single byte, so
//! there is nothing filesystem-observable to hook into.  We show an
//! asymptotic time curve:
//!
//! ```text
//! pct = PHASE1_CAP × (1 − e^(−t / τ))
//! ```
//!
//! The curve moves quickly at first and slows toward [`PHASE1_CAP`], which
//! is honest — we don't claim 100 % until phase 2 actually starts.
//!
//! ## Phase 2 — writing the COPC file
//!
//! Once the output file appears on disk with non-zero length, we switch to
//! real byte-count progress.  The expected output size is approximated by the
//! input LAZ size; COPC-LAZ output is typically within ±20 % of the source,
//! so we cap at [`PHASE2_CAP`] to avoid overshooting before `done` fires.

use super::emitter::ConversionEmitter;
use std::path::PathBuf;

// ── Tuning constants ──────────────────────────────────────────────────────────

/// Polling interval.
const POLL_MS: u64 = 250;

/// Time constant for the phase-1 curve (seconds).
/// The curve reaches ~63 % at t = τ and ~95 % at t = 3τ.
/// Tune toward your typical COPC indexing time.
const TAU_SECS: f64 = 30.0;

/// Maximum percentage emitted during phase 1.
const PHASE1_CAP: f64 = 95.0;

/// Maximum percentage emitted during phase 2.
/// Headroom for COPC output being slightly larger than the source LAZ.
const PHASE2_CAP: f64 = 97.0;

// ── Watcher ───────────────────────────────────────────────────────────────────

/// Runs until the spawning task calls `JoinHandle::abort()`.
///
/// Intended usage:
/// ```rust,ignore
/// let handle = tokio::spawn(watcher::run(emitter, input, output));
/// let status = child.wait().await?;
/// handle.abort();
/// ```
pub async fn run(emitter: ConversionEmitter, input: PathBuf, output: PathBuf) {
    let input_size = input_file_size(&input).await;
    let started = tokio::time::Instant::now();
    let mut phase1_done = false;

    loop {
        tokio::time::sleep(tokio::time::Duration::from_millis(POLL_MS)).await;

        match output_bytes_written(&output).await {
            Some(written) if written > 0 => {
                // Phase 2: output file is being written.
                if !phase1_done {
                    phase1_done = true;
                    emitter.phase_percent(1, 100.0);
                }
                let pct = (written as f64 / input_size as f64 * 100.0).min(PHASE2_CAP);
                emitter.phase_percent(2, pct);
            }
            _ => {
                // Phase 1: output file not yet created — show time-based curve.
                if !phase1_done {
                    let elapsed = started.elapsed().as_secs_f64();
                    let pct = PHASE1_CAP * (1.0 - (-elapsed / TAU_SECS).exp());
                    emitter.phase_percent(1, pct);
                }
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn input_file_size(path: &PathBuf) -> u64 {
    tokio::fs::metadata(path)
        .await
        .map(|m| m.len())
        .unwrap_or(1)
        .max(1) // guard against division by zero
}

async fn output_bytes_written(path: &PathBuf) -> Option<u64> {
    tokio::fs::metadata(path).await.ok().map(|m| m.len())
}
