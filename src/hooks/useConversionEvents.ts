/**
 * Subscribes to all conversion Tauri events for a given project and returns
 * a single state object.
 *
 * Keeps event wiring and state derivation out of the render component so
 * ConversionProgress stays a pure presenter.
 */

import { useEffect, useReducer } from "react";
import { onConversionProgress, onConversionDone, onConversionError } from "../ipc";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConversionStatus = "running" | "done" | "error";

export interface PhaseState {
  phase1Pct: number;
  phase2Pct: number;
  /** Which phase is actively progressing right now. */
  activePhase: 1 | 2 | null;
}

export interface ConversionState {
  status: ConversionStatus;
  phases: PhaseState;
  /** Last N log messages, newest at the end. */
  messages: string[];
}

// ── Reducer ───────────────────────────────────────────────────────────────────

const MAX_MESSAGES = 50;

type Action =
  | { type: "PROGRESS"; phase?: 1 | 2; percent?: number; message: string }
  | { type: "DONE" }
  | { type: "ERROR"; message: string };

const initialState: ConversionState = {
  status: "running",
  phases: { phase1Pct: 0, phase2Pct: 0, activePhase: null },
  messages: [],
};

function append(messages: string[], next: string): string[] {
  return [...messages.slice(-(MAX_MESSAGES - 1)), next];
}

function reducer(state: ConversionState, action: Action): ConversionState {
  switch (action.type) {
    case "PROGRESS": {
      const phases = { ...state.phases };
      if (action.phase === 1 && action.percent != null) {
        phases.phase1Pct = action.percent;
        phases.activePhase = 1;
      } else if (action.phase === 2 && action.percent != null) {
        phases.phase2Pct = action.percent;
        phases.activePhase = 2;
      }
      return {
        ...state,
        phases,
        messages: append(state.messages, action.message),
      };
    }
    case "DONE":
      return {
        ...state,
        status: "done",
        phases: { phase1Pct: 100, phase2Pct: 100, activePhase: null },
      };
    case "ERROR":
      return {
        ...state,
        status: "error",
        phases: { ...state.phases, activePhase: null },
        messages: append(state.messages, `ERROR: ${action.message}`),
      };
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * @param projectId  The project whose conversion events to listen to.
 * @param onDone     Called 1.2 s after conversion succeeds (allows the UI to
 *                   show the "complete" state briefly before transitioning).
 */
export function useConversionEvents(
  projectId: string,
  onDone: () => void,
): ConversionState {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const unlisten: Array<() => void> = [];

    onConversionProgress((payload) => {
      if (payload.project_id !== projectId) return;
      dispatch({
        type: "PROGRESS",
        phase: payload.phase,
        percent: payload.percent,
        message: payload.message,
      });
    }).then((u) => unlisten.push(u));

    onConversionDone((payload) => {
      if (payload.project_id !== projectId) return;
      dispatch({ type: "DONE" });
      setTimeout(onDone, 1200);
    }).then((u) => unlisten.push(u));

    onConversionError((payload) => {
      if (payload.project_id !== projectId) return;
      dispatch({ type: "ERROR", message: payload.message });
    }).then((u) => unlisten.push(u));

    return () => unlisten.forEach((u) => u());
  }, [projectId, onDone]);

  return state;
}
