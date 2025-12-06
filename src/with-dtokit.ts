// ============================================================================
// DTOKit Integration - Type-Safe Actor with Exhaustive Message Handling
// ============================================================================
//
// This module provides integration with @marianmeres/dtokit for actors that
// benefit from compile-time exhaustive message handling.
//
// Usage:
//   import { createTypedStateActor } from "@marianmeres/actor/with-dtokit";
//
// ============================================================================

import { createDtoFactory, type DtoFactory } from "@marianmeres/dtokit";
import {
	createActor,
	createStateActor,
	type Actor,
	type Logger,
} from "./actor.ts";

/**
 * A schema object where each key maps to a message type with a literal discriminator.
 *
 * The key MUST match the discriminator value for proper exhaustive checking.
 *
 * @example
 * ```typescript
 * type CounterSchemas = {
 *   INC: { type: "INC" };
 *   DEC: { type: "DEC" };
 *   ADD: { type: "ADD"; amount: number };
 * };
 * ```
 */
export type MessageSchemas = Record<string, { type: string }>;

/**
 * Extracts the union of all message types from a schemas object.
 *
 * @example
 * ```typescript
 * type Schemas = { INC: { type: "INC" }; DEC: { type: "DEC" } };
 * type Message = MessageUnion<Schemas>;
 * // = { type: "INC" } | { type: "DEC" }
 * ```
 */
export type MessageUnion<TSchemas extends MessageSchemas> =
	TSchemas[keyof TSchemas];

/**
 * Exhaustive handler mapping for typed actors.
 *
 * Each handler receives:
 * - `msg`: The correctly-typed message for that discriminator value
 * - `state`: The current actor state
 *
 * And returns the result (or Promise of result).
 *
 * TypeScript enforces that ALL schema keys have handlers - missing
 * any handler causes a compile-time error.
 *
 * @template TSchemas - The message schemas object type
 * @template TState - The actor's state type
 * @template TResult - The return type of handlers
 */
export type ExhaustiveHandlers<
	TSchemas extends MessageSchemas,
	TState,
	TResult,
> = {
	[K in keyof TSchemas]: (
		msg: TSchemas[K],
		state: TState
	) => TResult | Promise<TResult>;
};

/**
 * Creates a state actor with compile-time exhaustive message handling.
 *
 * This is the recommended way to create actors when you have multiple message types
 * and want TypeScript to enforce that all message types are handled.
 *
 * ## Key Benefits
 *
 * - **Exhaustive checking**: TypeScript errors if you forget to handle a message type
 * - **Single source of truth**: Message types are defined once in the schemas object
 * - **Type inference**: Each handler receives correctly-typed message and state
 * - **Refactoring safety**: Rename/remove a message type → compiler shows all places to update
 *
 * ## Comparison with createStateActor
 *
 * **Before (manual switch, no exhaustiveness):**
 * ```typescript
 * type Message = { type: "INC" } | { type: "DEC" } | { type: "ADD"; amount: number };
 *
 * const counter = createStateActor<number, Message>(0, (state, msg) => {
 *   switch (msg.type) {
 *     case "INC": return state + 1;
 *     case "DEC": return state - 1;
 *     // Oops! Forgot "ADD" - no TypeScript error!
 *   }
 * });
 * ```
 *
 * **After (exhaustive, compiler-enforced):**
 * ```typescript
 * type Schemas = {
 *   INC: { type: "INC" };
 *   DEC: { type: "DEC" };
 *   ADD: { type: "ADD"; amount: number };
 * };
 *
 * const counter = createTypedStateActor<Schemas, number>(0, {
 *   INC: (_, state) => state + 1,
 *   DEC: (_, state) => state - 1,
 *   // TypeScript ERROR: Property 'ADD' is missing!
 * });
 * ```
 *
 * @template TSchemas - Object mapping message keys to their types (with "type" discriminator)
 * @template TState - The actor's state type
 *
 * @param initialState - The initial state of the actor
 * @param handlers - Object with handler for each message type (exhaustive)
 * @param options - Optional configuration for debug logging
 * @returns An Actor instance
 *
 * @example
 * ```typescript
 * // Define all message types in one place
 * type TodoSchemas = {
 *   ADD: { type: "ADD"; text: string };
 *   REMOVE: { type: "REMOVE"; id: number };
 *   TOGGLE: { type: "TOGGLE"; id: number };
 *   CLEAR_DONE: { type: "CLEAR_DONE" };
 * };
 *
 * type Todo = { id: number; text: string; done: boolean };
 *
 * const todos = createTypedStateActor<TodoSchemas, Todo[]>([], {
 *   ADD: (msg, state) => [...state, { id: Date.now(), text: msg.text, done: false }],
 *   REMOVE: (msg, state) => state.filter(t => t.id !== msg.id),
 *   TOGGLE: (msg, state) => state.map(t =>
 *     t.id === msg.id ? { ...t, done: !t.done } : t
 *   ),
 *   CLEAR_DONE: (_, state) => state.filter(t => !t.done),
 * });
 *
 * // Full type safety on send()
 * await todos.send({ type: "ADD", text: "Buy milk" });
 * await todos.send({ type: "TOGGLE", id: 123 });
 * ```
 *
 * @example
 * ```typescript
 * // Async handlers work too
 * type ApiSchemas = {
 *   FETCH: { type: "FETCH"; url: string };
 *   CLEAR: { type: "CLEAR" };
 * };
 *
 * const api = createTypedStateActor<ApiSchemas, { data: unknown }>(
 *   { data: null },
 *   {
 *     FETCH: async (msg, state) => {
 *       const res = await fetch(msg.url);
 *       return { data: await res.json() };
 *     },
 *     CLEAR: (_, state) => ({ data: null }),
 *   }
 * );
 * ```
 *
 * @example
 * ```typescript
 * // With debug logging
 * const counter = createTypedStateActor<Schemas, number>(
 *   0,
 *   { INC: (_, s) => s + 1, DEC: (_, s) => s - 1 },
 *   { debug: true }
 * );
 * ```
 */
export function createTypedStateActor<TSchemas extends MessageSchemas, TState>(
	initialState: TState,
	handlers: ExhaustiveHandlers<TSchemas, TState, TState>,
	options?: { debug?: boolean; logger?: Logger }
): Actor<TState, MessageUnion<TSchemas>, TState> {
	return createStateActor<TState, MessageUnion<TSchemas>>(
		initialState,
		(state, msg) => {
			const handler = handlers[msg.type as keyof TSchemas];
			// deno-lint-ignore no-explicit-any
			return handler(msg as any, state);
		},
		options
	);
}

/**
 * Configuration options for createTypedActor.
 *
 * @template TSchemas - The message schemas object type
 * @template TState - The actor's state type
 * @template TResponse - The response type from handlers
 */
export interface TypedActorOptions<
	TSchemas extends MessageSchemas,
	TState,
	TResponse,
> {
	/**
	 * The initial state of the actor.
	 */
	initialState: TState;

	/**
	 * Exhaustive handlers for each message type.
	 *
	 * Each handler receives `(msg, state)` and returns `TResponse`.
	 */
	handlers: ExhaustiveHandlers<TSchemas, TState, TResponse>;

	/**
	 * Optional reducer to transform handler response into new state.
	 *
	 * When provided, the handler's response is passed to the reducer to produce
	 * the new state. When omitted, state is not automatically updated.
	 */
	reducer?: (state: TState, response: TResponse) => TState;

	/**
	 * Optional error handler called when a message handler throws.
	 */
	onError?: (error: Error, message: MessageUnion<TSchemas>) => void;

	/**
	 * Enable debug logging for this actor.
	 *
	 * When true, logs important actor lifecycle events and message processing
	 * to the provided logger (or console if no logger specified).
	 *
	 * @default false
	 */
	debug?: boolean;

	/**
	 * Custom logger to use for debug output.
	 *
	 * Must implement the Logger interface (debug, log, warn, error methods).
	 * Falls back to console if not provided.
	 */
	logger?: Logger;
}

/**
 * Creates an actor with exhaustive message handling and full control over response/reducer.
 *
 * This is the full-featured version of `createTypedStateActor`, allowing you to:
 * - Return rich response data from handlers (different from state type)
 * - Use a reducer to extract state updates from responses
 * - Handle errors with `onError` callback
 *
 * Use this when handlers need to return data to the caller that differs from state updates.
 *
 * @template TSchemas - Object mapping message keys to their types
 * @template TState - The actor's state type
 * @template TResponse - The response type returned by handlers
 *
 * @param options - Configuration options
 * @returns An Actor instance
 *
 * @example
 * ```typescript
 * type Schemas = {
 *   PROCESS: { type: "PROCESS"; data: string };
 *   RESET: { type: "RESET" };
 * };
 *
 * // Handler returns { result, metadata }, but state only stores result
 * const processor = createTypedActor<
 *   Schemas,
 *   { result: string | null },
 *   { result: string; metadata: { processedAt: number } }
 * >({
 *   initialState: { result: null },
 *   handlers: {
 *     PROCESS: (msg, state) => ({
 *       result: msg.data.toUpperCase(),
 *       metadata: { processedAt: Date.now() }
 *     }),
 *     RESET: (_, state) => ({ result: "", metadata: { processedAt: 0 } }),
 *   },
 *   reducer: (state, response) => ({ result: response.result }),
 * });
 *
 * const response = await processor.send({ type: "PROCESS", data: "hello" });
 * // response = { result: "HELLO", metadata: { processedAt: 1701234567890 } }
 * // state = { result: "HELLO" }
 * ```
 */
export function createTypedActor<
	TSchemas extends MessageSchemas,
	TState,
	TResponse,
>(
	options: TypedActorOptions<TSchemas, TState, TResponse>
): Actor<TState, MessageUnion<TSchemas>, TResponse> {
	const { initialState, handlers, reducer, onError, debug, logger } = options;

	return createActor<TState, MessageUnion<TSchemas>, TResponse>({
		initialState,
		handler: (state, msg) => {
			const handler = handlers[msg.type as keyof TSchemas];
			// deno-lint-ignore no-explicit-any
			return handler(msg as any, state);
		},
		reducer,
		onError,
		debug,
		logger,
	});
}

/**
 * Creates a DTOKit factory for validating messages from external sources.
 *
 * Use this when messages arrive from untyped sources (WebSocket, postMessage, API responses)
 * and need runtime validation before being sent to the actor.
 *
 * @template TSchemas - The message schemas type
 * @returns A DtoFactory instance with parse(), is(), getId(), and isValid() methods
 *
 * @example
 * ```typescript
 * type Schemas = {
 *   INC: { type: "INC" };
 *   ADD: { type: "ADD"; amount: number };
 * };
 *
 * const factory = createMessageFactory<Schemas>();
 * const actor = createTypedStateActor<Schemas, number>(0, { ... });
 *
 * // WebSocket message handling
 * socket.onmessage = (event) => {
 *   const msg = factory.parse(JSON.parse(event.data));
 *   if (msg) {
 *     actor.send(msg); // Type-safe!
 *   }
 * };
 * ```
 */
export function createMessageFactory<
	TSchemas extends MessageSchemas,
>(): DtoFactory<TSchemas, "type"> {
	return createDtoFactory<TSchemas>()("type");
}

// Re-export useful types from dtokit for convenience
export type { DtoFactory } from "@marianmeres/dtokit";
