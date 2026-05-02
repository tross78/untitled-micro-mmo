// @ts-check

/**
 * @typedef {{ kind: string, payload?: Record<string, unknown> }} Intent
 * @typedef {{ type: string, payload?: Record<string, unknown> }} DomainEvent
 * @typedef {{ type: string, payload?: Record<string, unknown> }} UiIntent
 * @typedef {{ type: string, payload?: Record<string, unknown> }} NetworkIntent
 * @typedef {{ type: string, payload?: Record<string, unknown> }} PersistenceIntent
 *
 * @typedef {{
 *   id: string,
 *   aliases?: string[],
 *   category?: string,
 *   description?: string,
 *   parse?: (raw: string) => { commandId: string, args: string[], raw: string },
 *   canExecute?: (ctx: unknown, parsed: { commandId: string, args: string[], raw: string }) => boolean,
 *   execute?: (ctx: unknown, parsed: { commandId: string, args: string[], raw: string }) => Promise<unknown> | unknown,
 *   ui?: Record<string, unknown>,
 *   tests?: string[]
 * }} CommandDefinition
 *
 * @typedef {{
 *   id: string,
 *   kind: 'item' | 'enemy' | 'room' | 'npc' | 'quest' | 'recipe'
 * }} ContentDefinition
 */

export {};
