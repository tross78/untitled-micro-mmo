// @ts-check

/**
 * @typedef {{
 *   showToast?: (message: string) => void,
 *   showDialogue?: (npcName: string, text: string) => void,
 *   requestText?: (options: { title: string, initialValue?: string, maxLength?: number, placeholder?: string }) => Promise<string | null>
 * }} UiPort
 *
 * @typedef {{
 *   send?: (type: string, payload?: Record<string, unknown>) => void
 * }} NetworkPort
 *
 * @typedef {{
 *   save?: (player: unknown, flush?: boolean) => Promise<void> | void
 * }} StoragePort
 *
 * @typedef {{
 *   play?: (cue: string) => void
 * }} AudioPort
 *
 * @typedef {{
 *   ports: {
 *     ui?: UiPort,
 *     network?: NetworkPort,
 *     storage?: StoragePort,
 *     audio?: AudioPort
 *   }
 * }} AppPorts
 */

export {};
