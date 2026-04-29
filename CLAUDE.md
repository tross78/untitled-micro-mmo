# Hearthwick Input Model & Development Guidelines

## Input Model Decision (Phase 7.8)

*   **Primary Input:** The game uses a Canvas-native input model. Interaction is driven by keyboard (WASD/Arrows), Gamepad, and Canvas clicks/taps.
*   **Secondary Input (Buttons):** The "Action Buttons" (chips) are mobile-friendly shortcuts for common tasks and should be preserved as long as they don't clutter the UI.
*   **CLI (Debug Console):** The text-based command interface is now officially a **debug and power-user tool**.
    *   It is **hidden by default**.
    *   Use the backtick (`` ` ``) or tilde (`~`) key to toggle the debug console and log.
    *   Moment-to-moment gameplay should never *require* the CLI.

## Codebase Standards

*   **No Dependencies:** Strictly adhere to ADR-009. No new npm dependencies. Use native browser APIs (Web Audio, Canvas, IndexedDB, Ed25519).
*   **Procedural Assets:** All graphics and audio must be generated at runtime. No external image or sound files.
*   **P2P Architecture:** The game is serverless (Arbiter on Pi Zero). Player state lives on the client. Trust is established via Ed25519 signatures and deterministic simulation.
*   **Event-Driven:** Use the `bus` (`src/eventbus.js`) for all cross-module communication.
*   **Renderer Integrity:** All visual output should go through the `renderer.js` interface. Do not manipulate the DOM directly for game visuals.
