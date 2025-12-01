// ============================================================================
// Actor Pattern Implementation
// ============================================================================

import { createPubSub, type PubSub } from "@marianmeres/pubsub";

/**
 * A function that processes messages and returns a response.
 *
 * The handler receives the current state and a message, and returns a response
 * (or a Promise that resolves to a response). The response type can differ from
 * the state type when using a reducer.
 *
 * @template TState - The type of the actor's state
 * @template TMessage - The type of messages the actor can receive
 * @template TResponse - The type of response the handler returns (defaults to void)
 *
 * @example
 * ```typescript
 * // Simple handler that returns new state
 * const handler: MessageHandler<number, { delta: number }, number> =
 *   (state, msg) => state + msg.delta;
 *
 * // Async handler
 * const asyncHandler: MessageHandler<Data, FetchCommand, Data> =
 *   async (state, msg) => {
 *     const result = await fetch(msg.url);
 *     return { ...state, data: await result.json() };
 *   };
 * ```
 */
export type MessageHandler<TState, TMessage, TResponse = void> = (
	state: TState,
	message: TMessage
) => TResponse | Promise<TResponse>;

/**
 * A function that transforms the handler's response into a new state.
 *
 * The reducer receives the current state and the handler's response, and returns
 * the new state. This allows the handler to return rich response data while the
 * reducer extracts only what's needed for state updates.
 *
 * @template TState - The type of the actor's state
 * @template TResponse - The type of response from the handler
 *
 * @example
 * ```typescript
 * // Handler returns { value: number, metadata: object }
 * // Reducer extracts only the value for state
 * const reducer: StateReducer<number, { value: number; metadata: object }> =
 *   (state, response) => response.value;
 * ```
 */
export type StateReducer<TState, TResponse> = (
	state: TState,
	response: TResponse
) => TState;

/**
 * A callback function that receives state updates.
 *
 * Subscribers are called immediately upon subscription with the current state,
 * and subsequently whenever the state changes.
 *
 * @template TState - The type of the actor's state
 */
export type Subscriber<TState> = (state: TState) => void;

/**
 * A function that removes a subscription when called.
 *
 * @returns void
 */
export type Unsubscribe = () => void;

interface QueuedMessage<TMessage, TResponse> {
	message: TMessage;
	resolve: (value: TResponse) => void;
	reject: (error: Error) => void;
}

/**
 * The Actor interface - a message-driven stateful computation unit.
 *
 * An actor processes messages sequentially through a mailbox, ensuring thread-safe
 * state mutations. Messages are processed in FIFO order, and each message is fully
 * processed before the next one begins.
 *
 * @template TState - The type of the actor's state
 * @template TMessage - The type of messages the actor can receive
 * @template TResponse - The type of response returned by send() (defaults to void)
 *
 * @example
 * ```typescript
 * const counter: Actor<number, { type: "INC" } | { type: "DEC" }, number> = createStateActor(
 *   0,
 *   (state, msg) => msg.type === "INC" ? state + 1 : state - 1
 * );
 *
 * await counter.send({ type: "INC" }); // Returns 1
 * counter.subscribe(console.log);      // Logs current and future states
 * counter.getState();                  // Returns 1
 * counter.destroy();                   // Cleanup
 * ```
 */
export interface Actor<TState, TMessage, TResponse = void> {
	/**
	 * Sends a message to the actor for processing.
	 *
	 * Messages are queued in a mailbox and processed sequentially in FIFO order.
	 * The returned promise resolves with the handler's response once the message
	 * is processed, or rejects if the handler throws an error.
	 *
	 * @param message - The message to send to the actor
	 * @returns A promise that resolves with the handler's response
	 * @throws Error if the actor has been destroyed
	 *
	 * @example
	 * ```typescript
	 * const result = await actor.send({ type: "ADD", value: 5 });
	 * ```
	 */
	send: (message: TMessage) => Promise<TResponse>;

	/**
	 * Subscribes to state changes.
	 *
	 * The subscriber is called immediately with the current state, and then
	 * whenever the state changes. Subscribers are only notified when the state
	 * reference changes (shallow comparison).
	 *
	 * @param fn - Callback function that receives the current state
	 * @returns An unsubscribe function
	 *
	 * @example
	 * ```typescript
	 * const unsubscribe = actor.subscribe((state) => {
	 *   console.log("State changed:", state);
	 * });
	 *
	 * // Later, to stop receiving updates:
	 * unsubscribe();
	 * ```
	 */
	subscribe: (fn: Subscriber<TState>) => Unsubscribe;

	/**
	 * Returns the current state synchronously.
	 *
	 * Useful for debugging, testing, or when you need an immediate snapshot
	 * of the state without subscribing.
	 *
	 * @returns The current state
	 */
	getState: () => TState;

	/**
	 * Destroys the actor, cleaning up all resources.
	 *
	 * After destruction:
	 * - All pending messages in the mailbox are discarded
	 * - All subscribers are removed
	 * - New messages will be rejected with "Actor has been destroyed" error
	 * - The state remains accessible via getState() but will no longer update
	 */
	destroy: () => void;
}

/**
 * Configuration options for creating an actor.
 *
 * @template TState - The type of the actor's state
 * @template TMessage - The type of messages the actor can receive
 * @template TResponse - The type of response the handler returns
 */
export interface ActorOptions<TState, TMessage, TResponse> {
	/**
	 * The initial state of the actor.
	 */
	initialState: TState;

	/**
	 * The message handler function.
	 *
	 * Receives the current state and a message, returns a response.
	 * Can be sync or async.
	 */
	handler: MessageHandler<TState, TMessage, TResponse>;

	/**
	 * Optional reducer to transform handler response into new state.
	 *
	 * When provided, the handler's response is passed to the reducer along with
	 * the current state to produce the new state. This allows the handler to
	 * return rich response data while the reducer extracts state updates.
	 *
	 * When omitted, state is not automatically updated - you would need to
	 * manage state updates within the handler itself.
	 *
	 * @example
	 * ```typescript
	 * // Handler returns { data, metadata }
	 * // Reducer stores only data in state
	 * {
	 *   handler: async (state, msg) => {
	 *     const res = await fetch(msg.url);
	 *     return { data: await res.json(), metadata: { timestamp: Date.now() } };
	 *   },
	 *   reducer: (state, response) => ({ ...state, ...response.data })
	 * }
	 * ```
	 */
	reducer?: StateReducer<TState, TResponse>;

	/**
	 * Optional error handler called when the message handler throws.
	 *
	 * Receives the error and the message that caused it. Note that the error
	 * is still propagated (the send() promise will reject), but this callback
	 * allows for logging or other side effects.
	 *
	 * @example
	 * ```typescript
	 * {
	 *   onError: (error, message) => {
	 *     console.error(`Failed to process ${message.type}:`, error);
	 *     errorTracker.capture(error);
	 *   }
	 * }
	 * ```
	 */
	onError?: (error: Error, message: TMessage) => void;
}

const STATE_CHANGE_TOPIC = "state";

const _onSubscriberError = (e: Error) => console.error("Subscriber error:", e);

/**
 * Creates an actor - a message-driven stateful computation unit.
 *
 * The actor pattern provides:
 * - **Sequential message processing**: Messages are queued and processed one at a time
 * - **Thread-safe state**: No race conditions from concurrent updates
 * - **Reactive subscriptions**: Subscribe to state changes
 * - **Error isolation**: Handler errors don't break the mailbox
 *
 * @template TState - The type of the actor's state
 * @template TMessage - The type of messages the actor can receive
 * @template TResponse - The type of response the handler returns (defaults to void)
 *
 * @param options - Configuration options for the actor
 * @returns An Actor instance
 *
 * @example
 * ```typescript
 * // Basic actor with state updates
 * const counter = createActor<number, { type: "INC" } | { type: "DEC" }, number>({
 *   initialState: 0,
 *   handler: (state, msg) => msg.type === "INC" ? state + 1 : state - 1,
 *   reducer: (_, newState) => newState,
 * });
 *
 * await counter.send({ type: "INC" }); // Returns 1
 * console.log(counter.getState());     // 1
 * ```
 *
 * @example
 * ```typescript
 * // Async handler with rich response
 * const fetcher = createActor<
 *   { data: unknown; loading: boolean },
 *   { url: string },
 *   { data: unknown; timestamp: number }
 * >({
 *   initialState: { data: null, loading: false },
 *   handler: async (state, msg) => {
 *     const res = await fetch(msg.url);
 *     return { data: await res.json(), timestamp: Date.now() };
 *   },
 *   reducer: (state, response) => ({ ...state, data: response.data, loading: false }),
 * });
 * ```
 */
export function createActor<TState, TMessage, TResponse = void>(
	options: ActorOptions<TState, TMessage, TResponse>
): Actor<TState, TMessage, TResponse> {
	const { initialState, handler, reducer, onError } = options;

	let state = initialState;
	let processing = false;
	let destroyed = false;

	const mailbox: QueuedMessage<TMessage, TResponse>[] = [];
	const pubsub: PubSub = createPubSub({ onError: _onSubscriberError });

	function notifySubscribers() {
		pubsub.publish(STATE_CHANGE_TOPIC, state);
	}

	async function processMailbox() {
		if (processing || destroyed) return;
		processing = true;

		while (mailbox.length > 0 && !destroyed) {
			const { message, resolve, reject } = mailbox.shift()!;

			try {
				const response = await handler(state, message);

				// Update state if reducer provided
				if (reducer) {
					const newState = reducer(state, response);
					if (newState !== state) {
						state = newState;
						notifySubscribers();
					}
				}

				resolve(response);
			} catch (error) {
				const err =
					error instanceof Error ? error : new Error(String(error));
				onError?.(err, message);
				reject(err);
			}
		}

		processing = false;
	}

	return {
		send(message: TMessage): Promise<TResponse> {
			if (destroyed) {
				return Promise.reject(new Error("Actor has been destroyed"));
			}

			return new Promise((resolve, reject) => {
				mailbox.push({ message, resolve, reject });
				processMailbox();
			});
		},

		subscribe(fn: Subscriber<TState>): Unsubscribe {
			const unsubscribe = pubsub.subscribe(STATE_CHANGE_TOPIC, fn);
			try {
				fn(state); // Emit current state immediately
			} catch (e) {
				_onSubscriberError(e instanceof Error ? e : new Error(String(e)));
			}
			return unsubscribe;
		},

		getState(): TState {
			return state;
		},

		destroy() {
			destroyed = true;
			mailbox.length = 0;
			pubsub.unsubscribeAll();
		},
	};
}

// ============================================================================
// Helper: Create actor with simpler message-to-state pattern
// ============================================================================

/**
 * Creates a simplified actor where the handler directly returns the new state.
 *
 * This is a convenience wrapper around `createActor` for the common case where
 * the handler's return value IS the new state (no separate reducer needed).
 *
 * @template TState - The type of the actor's state
 * @template TMessage - The type of messages the actor can receive
 *
 * @param initialState - The initial state
 * @param handler - Function that receives state and message, returns new state
 * @returns An Actor instance
 *
 * @example
 * ```typescript
 * const counter = createStateActor<number, { type: "INC" } | { type: "DEC" }>(
 *   0,
 *   (state, msg) => msg.type === "INC" ? state + 1 : state - 1
 * );
 *
 * await counter.send({ type: "INC" });
 * console.log(counter.getState()); // 1
 * ```
 *
 * @example
 * ```typescript
 * // With discriminated union messages
 * type Message =
 *   | { type: "SET"; value: string }
 *   | { type: "CLEAR" };
 *
 * const input = createStateActor<string, Message>("", (state, msg) => {
 *   switch (msg.type) {
 *     case "SET": return msg.value;
 *     case "CLEAR": return "";
 *   }
 * });
 * ```
 */
export function createStateActor<TState, TMessage>(
	initialState: TState,
	handler: (state: TState, message: TMessage) => TState | Promise<TState>
): Actor<TState, TMessage, TState> {
	return createActor({
		initialState,
		handler,
		reducer: (_, newState) => newState,
	});
}

// ============================================================================
// Helper: Typed message creators (like Redux action creators)
// ============================================================================

/**
 * Type helper for message creator functions.
 *
 * Maps payload type to the appropriate function signature:
 * - `undefined` payload → function with no arguments
 * - Other payload → function requiring the payload argument
 *
 * @template TPayload - The payload type
 * @template TMessage - The resulting message type
 */
export type MessageCreator<TPayload, TMessage> = TPayload extends undefined
	? () => TMessage
	: (payload: TPayload) => TMessage;

/**
 * Creates a typed message factory function (no payload).
 *
 * Similar to Redux action creators, this helper creates functions that
 * produce properly typed message objects.
 *
 * @template TType - The literal string type for the message type
 *
 * @param type - The message type string
 * @returns A function that creates the message object
 *
 * @example
 * ```typescript
 * const increment = defineMessage("INCREMENT");
 * const decrement = defineMessage("DECREMENT");
 *
 * await counter.send(increment()); // { type: "INCREMENT" }
 * await counter.send(decrement()); // { type: "DECREMENT" }
 * ```
 */
export function defineMessage<TType extends string>(
	type: TType
): () => { type: TType };

/**
 * Creates a typed message factory function (with payload).
 *
 * @template TType - The literal string type for the message type
 * @template TPayload - The payload type
 *
 * @param type - The message type string
 * @returns A function that takes a payload and creates the message object
 *
 * @example
 * ```typescript
 * const add = defineMessage<"ADD", number>("ADD");
 * const setName = defineMessage<"SET_NAME", string>("SET_NAME");
 *
 * await counter.send(add(5));           // { type: "ADD", payload: 5 }
 * await user.send(setName("Alice"));    // { type: "SET_NAME", payload: "Alice" }
 * ```
 */
export function defineMessage<TType extends string, TPayload>(
	type: TType
): (payload: TPayload) => { type: TType; payload: TPayload };

export function defineMessage<TType extends string, TPayload = undefined>(
	type: TType
) {
	return (payload?: TPayload) =>
		payload === undefined ? { type } : { type, payload };
}
