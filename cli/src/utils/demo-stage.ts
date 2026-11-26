// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

export type {
  DemoDone,
  DemoPhase,
  DemoPhaseStatus,
  DemoState,
  FrameRow,
  Segment,
} from "./demo-stage/frame.js";
/**
 * Public entry point for the demo progress UI.
 *
 * The pure frame renderer lives in `./demo-stage/frame.js` and the driver in
 * `./demo-stage/stage.js`; this module only re-exports both, so callers that import
 * `./demo-stage.js` keep working unchanged.
 */
export {
  DEMO_DISCORD_URL,
  DEMO_PROOF,
  DEMO_STAR_URL,
  FRAME_ROWS,
  formatElapsed,
  frameToPlain,
  renderDemoFrame,
  sanitizeCell,
  styleRow,
} from "./demo-stage/frame.js";
export type { DemoStage, RepaintScheduler } from "./demo-stage/stage.js";
export { createDemoStage } from "./demo-stage/stage.js";
