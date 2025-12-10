# API Reference

Complete API documentation for `@marianmeres/actor`.

## Table of Contents

- [Factory Functions](#factory-functions)
  - [createActor](#createactoroptions)
  - [createStateActor](#createstateactorinitialstate-handler-options)
  - [defineMessage](#definemessagetype)
- [DTOKit Integration](#dtokit-integration)
  - [createTypedStateActor](#createtypedstateactorinitialstate-handlers-options)
  - [createTypedActor](#createtypedactoroptions)
  - [createMessageFactory](#createmessagefactory)
- [Types](#types)
  - [Actor](#actortstate-tmessage-tresponse)
  - [ActorOptions](#actoroptionsststate-tmessage-tresponse)
  - [Logger](#logger)
  - [MessageHandler](#messagehandlertstate-tmessage-tresponse)
  - [StateReducer](#statereducertstate-tresponse)
  - [SubscriberValue](#subscribervaluetstate)
  - [Subscriber](#subscribertstate)
  - [Unsubscribe](#unsubscribe)
  - [MessageCreator](#messagecreatorttpayload-tmessage)
- [DTOKit Types](#dtokit-types)
  - [MessageSchemas](#messageschemas)
  - [MessageUnion](#messageuniontschemas)
  - [ExhaustiveHandlers](#exhaustivehandlerstschemas-tstate-tresult)
  - [TypedActorOptions](#typedactoroptionsschemas-tstate-tresponse)

---

## Factory Functions

### `createActor(options)`

Creates an actor with full control over state updates via a reducer function.

```typescript
function createActor<TState, TMessage, TResponse = void>(
  options: ActorOptions<TState, TMessage, TResponse>
): Actor<TState, TMessage, TResponse>
```

**Type Parameters:**

| Parameter | Description |
|-----------|-------------|
| `TState` | The type of the actor's state |
| `TMessage` | The type of messages the actor can receive |
| `TResponse` | The type of response the handler returns (defaults to `void`) |

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `options` | `ActorOptions<TState, TMessage, TResponse>` | Configuration options for the actor |

**Returns:** `Actor<TState, TMessage, TResponse>`

**Example:**

```typescript
// Basic actor with state updates
const counter = createActor<number, { type: "INC" } | { type: "DEC" }, number>({
  initialState: 0,
  handler: (state, msg) => msg.type === "INC" ? state + 1 : state - 1,
  reducer: (_, newState) => newState,
});

await counter.send({ type: "INC" }); // Returns 1
console.log(counter.getState());     // 1
```

```typescript
// Async handler with rich response
const fetcher = createActor<
  { data: unknown; loading: boolean },
  { url: string },
  { data: unknown; timestamp: number }
>({
  initialState: { data: null, loading: false },
  handler: async (state, msg) => {
    const res = await fetch(msg.url);
    return { data: await res.json(), timestamp: Date.now() };
  },
  reducer: (state, response) => ({ ...state, data: response.data, loading: false }),
});
```

---

### `createStateActor(initialState, handler, options?)`

Creates a simplified actor where the handler directly returns the new state.

This is a convenience wrapper around `createActor` for the common case where the handler's return value IS the new state (no separate reducer needed).

```typescript
function createStateActor<TState, TMessage>(
  initialState: TState,
  handler: (state: TState, message: TMessage) => TState | Promise<TState>,
  options?: { debug?: boolean; logger?: Logger }
): Actor<TState, TMessage, TState>
```

**Type Parameters:**

| Parameter | Description |
|-----------|-------------|
| `TState` | The type of the actor's state |
| `TMessage` | The type of messages the actor can receive |

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `initialState` | `TState` | The initial state |
| `handler` | `(state: TState, message: TMessage) => TState \| Promise<TState>` | Function that receives state and message, returns new state |
| `options` | `{ debug?: boolean; logger?: Logger }` | Optional configuration for debug logging |

**Returns:** `Actor<TState, TMessage, TState>`

**Example:**

```typescript
const counter = createStateActor<number, { type: "INC" } | { type: "DEC" }>(
  0,
  (state, msg) => msg.type === "INC" ? state + 1 : state - 1
);

await counter.send({ type: "INC" });
console.log(counter.getState()); // 1
```

```typescript
// With discriminated union messages
type Message =
  | { type: "SET"; value: string }
  | { type: "CLEAR" };

const input = createStateActor<string, Message>("", (state, msg) => {
  switch (msg.type) {
    case "SET": return msg.value;
    case "CLEAR": return "";
  }
});
```

---

### `defineMessage(type)`

Creates typed message factory functions (similar to Redux action creators).

**Overload 1: Without payload**

```typescript
function defineMessage<TType extends string>(
  type: TType
): () => { type: TType }
```

**Overload 2: With payload**

```typescript
function defineMessage<TType extends string, TPayload>(
  type: TType
): (payload: TPayload) => { type: TType; payload: TPayload }
```

**Type Parameters:**

| Parameter | Description |
|-----------|-------------|
| `TType` | The literal string type for the message type |
| `TPayload` | The payload type (when using overload 2) |

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `type` | `TType` | The message type string |

**Returns:** A function that creates the message object

**Example:**

```typescript
// Without payload
const increment = defineMessage("INCREMENT");
const decrement = defineMessage("DECREMENT");

await counter.send(increment()); // { type: "INCREMENT" }
await counter.send(decrement()); // { type: "DECREMENT" }
```

```typescript
// With payload
const add = defineMessage<"ADD", number>("ADD");
const setName = defineMessage<"SET_NAME", string>("SET_NAME");

await counter.send(add(5));           // { type: "ADD", payload: 5 }
await user.send(setName("Alice"));    // { type: "SET_NAME", payload: "Alice" }
```

---

## DTOKit Integration

These functions provide compile-time exhaustive message handling using [@marianmeres/dtokit](https://github.com/marianmeres/dtokit). TypeScript will error if you forget to handle any message type.

### `createTypedStateActor(initialState, handlers, options?)`

Creates a state actor with compile-time exhaustive message handling.

This is the recommended way to create actors when you have multiple message types and want TypeScript to enforce that all message types are handled.

```typescript
function createTypedStateActor<TSchemas extends MessageSchemas, TState>(
  initialState: TState,
  handlers: ExhaustiveHandlers<TSchemas, TState, TState>,
  options?: { debug?: boolean; logger?: Logger }
): Actor<TState, MessageUnion<TSchemas>, TState>
```

**Type Parameters:**

| Parameter | Description |
|-----------|-------------|
| `TSchemas` | Object mapping message keys to their types (with "type" discriminator) |
| `TState` | The actor's state type |

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `initialState` | `TState` | The initial state of the actor |
| `handlers` | `ExhaustiveHandlers<TSchemas, TState, TState>` | Object with handler for each message type (exhaustive) |
| `options` | `{ debug?: boolean; logger?: Logger }` | Optional configuration for debug logging |

**Returns:** `Actor<TState, MessageUnion<TSchemas>, TState>`

**Key Benefits:**

- **Exhaustive checking**: TypeScript errors if you forget to handle a message type
- **Single source of truth**: Message types are defined once in the schemas object
- **Type inference**: Each handler receives correctly-typed message and state
- **Refactoring safety**: Rename/remove a message type → compiler shows all places to update

**Example:**

```typescript
// Define all message types in one place
type TodoSchemas = {
  ADD: { type: "ADD"; text: string };
  REMOVE: { type: "REMOVE"; id: number };
  TOGGLE: { type: "TOGGLE"; id: number };
  CLEAR_DONE: { type: "CLEAR_DONE" };
};

type Todo = { id: number; text: string; done: boolean };

const todos = createTypedStateActor<TodoSchemas, Todo[]>([], {
  ADD: (msg, state) => [...state, { id: Date.now(), text: msg.text, done: false }],
  REMOVE: (msg, state) => state.filter(t => t.id !== msg.id),
  TOGGLE: (msg, state) => state.map(t =>
    t.id === msg.id ? { ...t, done: !t.done } : t
  ),
  CLEAR_DONE: (_, state) => state.filter(t => !t.done),
});

// Full type safety on send()
await todos.send({ type: "ADD", text: "Buy milk" });
await todos.send({ type: "TOGGLE", id: 123 });
// await todos.send({ type: "TYPO" }); // TypeScript error!
```

```typescript
// Async handlers work too
type ApiSchemas = {
  FETCH: { type: "FETCH"; url: string };
  CLEAR: { type: "CLEAR" };
};

const api = createTypedStateActor<ApiSchemas, { data: unknown }>(
  { data: null },
  {
    FETCH: async (msg, state) => {
      const res = await fetch(msg.url);
      return { data: await res.json() };
    },
    CLEAR: (_, state) => ({ data: null }),
  }
);
```

---

### `createTypedActor(options)`

Creates an actor with exhaustive message handling and full control over response/reducer.

This is the full-featured version of `createTypedStateActor`, allowing you to:
- Return rich response data from handlers (different from state type)
- Use a reducer to extract state updates from responses
- Handle errors with `onError` callback

```typescript
function createTypedActor<TSchemas extends MessageSchemas, TState, TResponse>(
  options: TypedActorOptions<TSchemas, TState, TResponse>
): Actor<TState, MessageUnion<TSchemas>, TResponse>
```

**Type Parameters:**

| Parameter | Description |
|-----------|-------------|
| `TSchemas` | Object mapping message keys to their types |
| `TState` | The actor's state type |
| `TResponse` | The response type returned by handlers |

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `options` | `TypedActorOptions<TSchemas, TState, TResponse>` | Configuration options |

**Returns:** `Actor<TState, MessageUnion<TSchemas>, TResponse>`

**Example:**

```typescript
type Schemas = {
  PROCESS: { type: "PROCESS"; data: string };
  RESET: { type: "RESET" };
};

// Handler returns { result, metadata }, but state only stores result
const processor = createTypedActor<
  Schemas,
  { result: string | null },
  { result: string; metadata: { processedAt: number } }
>({
  initialState: { result: null },
  handlers: {
    PROCESS: (msg, state) => ({
      result: msg.data.toUpperCase(),
      metadata: { processedAt: Date.now() }
    }),
    RESET: (_, state) => ({ result: "", metadata: { processedAt: 0 } }),
  },
  reducer: (state, response) => ({ result: response.result }),
});

const response = await processor.send({ type: "PROCESS", data: "hello" });
// response = { result: "HELLO", metadata: { processedAt: 1701234567890 } }
// state = { result: "HELLO" }
```

---

### `createMessageFactory()`

Creates a DTOKit factory for validating messages from external sources.

Use this when messages arrive from untyped sources (WebSocket, postMessage, API responses) and need runtime validation before being sent to the actor.

```typescript
function createMessageFactory<TSchemas extends MessageSchemas>(): DtoFactory<TSchemas, "type">
```

**Type Parameters:**

| Parameter | Description |
|-----------|-------------|
| `TSchemas` | The message schemas type |

**Returns:** `DtoFactory<TSchemas, "type">` with `parse()`, `is()`, `getId()`, and `isValid()` methods

**Example:**

```typescript
type Schemas = {
  INC: { type: "INC" };
  ADD: { type: "ADD"; amount: number };
};

const factory = createMessageFactory<Schemas>();
const actor = createTypedStateActor<Schemas, number>(0, { ... });

// WebSocket message handling
socket.onmessage = (event) => {
  const msg = factory.parse(JSON.parse(event.data));
  if (msg) {
    actor.send(msg); // Type-safe after validation!
  }
};

// Factory methods
factory.isValid({ type: "INC" });           // true
factory.isValid({ type: "UNKNOWN" });       // false
factory.getId({ type: "ADD", amount: 5 });  // "ADD"
factory.parse({ type: "ADD", amount: 5 });  // { type: "ADD", amount: 5 } (typed)
factory.parse({ type: "BAD" });             // undefined
```

---

## Types

### `Actor<TState, TMessage, TResponse>`

The Actor interface - a message-driven stateful computation unit.

An actor processes messages sequentially through a mailbox, ensuring thread-safe state mutations. Messages are processed in FIFO order, and each message is fully processed before the next one begins.

```typescript
interface Actor<TState, TMessage, TResponse = void> {
  send: (message: TMessage) => Promise<TResponse>;
  subscribe: (fn: Subscriber<TState>) => Unsubscribe;  // fn receives (state, previous?)
  getState: () => TState;
  destroy: () => void;
  readonly debug: boolean | undefined;
  readonly logger: Logger;
}
```

#### Methods

##### `send(message)`

Sends a message to the actor for processing.

Messages are queued in a mailbox and processed sequentially in FIFO order. The returned promise resolves with the handler's response once the message is processed, or rejects if the handler throws an error.

```typescript
send(message: TMessage): Promise<TResponse>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `TMessage` | The message to send to the actor |

**Returns:** `Promise<TResponse>` - Resolves with the handler's response

**Throws:** `Error` if the actor has been destroyed

**Example:**

```typescript
const result = await actor.send({ type: "ADD", value: 5 });
```

##### `subscribe(fn)`

Subscribes to state changes.

The subscriber is called immediately with `{ current, previous: undefined }`, and then whenever the state changes with `{ current, previous }`. Subscribers are only notified when the state reference changes (shallow comparison).

Uses a single object parameter for Svelte store compatibility.

```typescript
subscribe(fn: Subscriber<TState>): Unsubscribe
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `Subscriber<TState>` | Callback function that receives `{ current, previous? }` |

**Returns:** `Unsubscribe` - A function to remove the subscription

**Example:**

```typescript
const unsubscribe = actor.subscribe(({ current, previous }) => {
  if (previous === undefined) {
    console.log("Initial state:", current);
  } else {
    console.log("State changed from", previous, "to", current);
  }
});

// Later, to stop receiving updates:
unsubscribe();
```

**Previous State Use Cases:**

```typescript
// React only to specific property changes
actor.subscribe(({ current, previous }) => {
  if (previous && current.email !== previous.email) {
    sendEmailVerification(current.email);
  }
});
```

##### `getState()`

Returns the current state synchronously.

Useful for debugging, testing, or when you need an immediate snapshot of the state without subscribing.

```typescript
getState(): TState
```

**Returns:** `TState` - The current state

##### `destroy()`

Destroys the actor, cleaning up all resources.

After destruction:
- All pending messages in the mailbox are discarded
- All subscribers are removed
- New messages will be rejected with "Actor has been destroyed" error
- The state remains accessible via `getState()` but will no longer update

```typescript
destroy(): void
```

#### Properties

##### `debug`

The current debug flag value.

Returns the debug setting passed to the actor options, or `undefined` if not specified. Useful for inspecting whether debug logging is enabled.

```typescript
readonly debug: boolean | undefined
```

**Returns:** `boolean | undefined` - The debug flag value

##### `logger`

The logger instance used by this actor.

Returns the custom logger if one was provided in options, otherwise returns `console`. Useful for accessing the actor's logger for additional logging or debugging purposes.

```typescript
readonly logger: Logger
```

**Returns:** `Logger` - The logger instance (custom or console)

---

### `ActorOptions<TState, TMessage, TResponse>`

Configuration options for creating an actor.

```typescript
interface ActorOptions<TState, TMessage, TResponse> {
  initialState: TState;
  handler: MessageHandler<TState, TMessage, TResponse>;
  reducer?: StateReducer<TState, TResponse>;
  onError?: (error: Error, message: TMessage) => void;
  debug?: boolean;
  logger?: Logger;
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `initialState` | `TState` | Yes | The initial state of the actor |
| `handler` | `MessageHandler<TState, TMessage, TResponse>` | Yes | The message handler function. Receives the current state and a message, returns a response. Can be sync or async. |
| `reducer` | `StateReducer<TState, TResponse>` | No | Transforms handler response into new state. When omitted, state is not automatically updated. |
| `onError` | `(error: Error, message: TMessage) => void` | No | Called when the message handler throws. The error is still propagated (the `send()` promise will reject), but this callback allows for logging or other side effects. |
| `debug` | `boolean` | No | Enable debug logging for this actor. Logs lifecycle events and message processing. Default: `false`. |
| `logger` | `Logger` | No | Custom logger to use for debug output. Falls back to `console` if not provided. |

**Example:**

```typescript
{
  initialState: { data: null, loading: false },
  handler: async (state, msg) => {
    const res = await fetch(msg.url);
    return { data: await res.json(), metadata: { timestamp: Date.now() } };
  },
  reducer: (state, response) => ({ ...state, ...response.data }),
  onError: (error, message) => {
    console.error(`Failed to process ${message.type}:`, error);
  }
}
```

---

### `Logger`

Logger interface compatible with both `console` and `@marianmeres/clog`.

When using a custom logger, it will be used for debug output. Falls back to `console` if not provided.

```typescript
interface Logger {
  debug: (...args: any[]) => any;
  log: (...args: any[]) => any;
  warn: (...args: any[]) => any;
  error: (...args: any[]) => any;
}
```

**Example:**

```typescript
import { createClog } from "@marianmeres/clog";

const actor = createActor({
  initialState: 0,
  handler: (state, msg) => state + 1,
  debug: true,
  logger: createClog("my-actor"),
});
```

---

### `MessageHandler<TState, TMessage, TResponse>`

A function that processes messages and returns a response.

The handler receives the current state and a message, and returns a response (or a Promise that resolves to a response). The response type can differ from the state type when using a reducer.

```typescript
type MessageHandler<TState, TMessage, TResponse = void> = (
  state: TState,
  message: TMessage
) => TResponse | Promise<TResponse>;
```

**Example:**

```typescript
// Simple handler that returns new state
const handler: MessageHandler<number, { delta: number }, number> =
  (state, msg) => state + msg.delta;

// Async handler
const asyncHandler: MessageHandler<Data, FetchCommand, Data> =
  async (state, msg) => {
    const result = await fetch(msg.url);
    return { ...state, data: await result.json() };
  };
```

---

### `StateReducer<TState, TResponse>`

A function that transforms the handler's response into a new state.

The reducer receives the current state and the handler's response, and returns the new state. This allows the handler to return rich response data while the reducer extracts only what's needed for state updates.

```typescript
type StateReducer<TState, TResponse> = (
  state: TState,
  response: TResponse
) => TState;
```

**Example:**

```typescript
// Handler returns { value: number, metadata: object }
// Reducer extracts only the value for state
const reducer: StateReducer<number, { value: number; metadata: object }> =
  (state, response) => response.value;
```

---

### `SubscriberValue<TState>`

The value passed to subscribers on state changes.

```typescript
type SubscriberValue<TState> = {
  current: TState;
  previous?: TState;
};
```

---

### `Subscriber<TState>`

A callback function that receives state updates.

Subscribers are called immediately upon subscription with `{ current, previous: undefined }`, and subsequently whenever the state changes with `{ current, previous }`.

Uses a single object parameter for Svelte store compatibility.

```typescript
type Subscriber<TState> = (value: SubscriberValue<TState>) => void;
```

**Example:**

```typescript
actor.subscribe(({ current, previous }) => {
  if (previous === undefined) {
    // Initial subscription - no previous state
    console.log("Initial state:", current);
  } else {
    // Subsequent updates - previous state available
    console.log("Changed from", previous, "to", current);
  }
});
```

---

### `Unsubscribe`

A function that removes a subscription when called.

```typescript
type Unsubscribe = () => void;
```

---

### `MessageCreator<TPayload, TMessage>`

Type helper for message creator functions.

Maps payload type to the appropriate function signature:
- `undefined` payload → function with no arguments
- Other payload → function requiring the payload argument

```typescript
type MessageCreator<TPayload, TMessage> = TPayload extends undefined
  ? () => TMessage
  : (payload: TPayload) => TMessage;
```

---

## DTOKit Types

### `MessageSchemas`

A schema object where each key maps to a message type with a literal discriminator.

The key MUST match the discriminator value for proper exhaustive checking.

```typescript
type MessageSchemas = Record<string, { type: string }>;
```

**Example:**

```typescript
type CounterSchemas = {
  INC: { type: "INC" };
  DEC: { type: "DEC" };
  ADD: { type: "ADD"; amount: number };
};
```

---

### `MessageUnion<TSchemas>`

Extracts the union of all message types from a schemas object.

```typescript
type MessageUnion<TSchemas extends MessageSchemas> = TSchemas[keyof TSchemas];
```

**Example:**

```typescript
type Schemas = { INC: { type: "INC" }; DEC: { type: "DEC" } };
type Message = MessageUnion<Schemas>;
// = { type: "INC" } | { type: "DEC" }
```

---

### `ExhaustiveHandlers<TSchemas, TState, TResult>`

Exhaustive handler mapping for typed actors.

Each handler receives:
- `msg`: The correctly-typed message for that discriminator value
- `state`: The current actor state

And returns the result (or Promise of result).

TypeScript enforces that ALL schema keys have handlers - missing any handler causes a compile-time error.

```typescript
type ExhaustiveHandlers<TSchemas extends MessageSchemas, TState, TResult> = {
  [K in keyof TSchemas]: (
    msg: TSchemas[K],
    state: TState
  ) => TResult | Promise<TResult>;
};
```

---

### `TypedActorOptions<TSchemas, TState, TResponse>`

Configuration options for `createTypedActor`.

```typescript
interface TypedActorOptions<TSchemas extends MessageSchemas, TState, TResponse> {
  initialState: TState;
  handlers: ExhaustiveHandlers<TSchemas, TState, TResponse>;
  reducer?: (state: TState, response: TResponse) => TState;
  onError?: (error: Error, message: MessageUnion<TSchemas>) => void;
  debug?: boolean;
  logger?: Logger;
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `initialState` | `TState` | Yes | The initial state of the actor |
| `handlers` | `ExhaustiveHandlers<TSchemas, TState, TResponse>` | Yes | Exhaustive handlers for each message type. Each handler receives `(msg, state)` and returns `TResponse`. |
| `reducer` | `(state: TState, response: TResponse) => TState` | No | Transforms handler response into new state. When omitted, state is not automatically updated. |
| `onError` | `(error: Error, message: MessageUnion<TSchemas>) => void` | No | Error handler called when a message handler throws. |
| `debug` | `boolean` | No | Enable debug logging for this actor. Logs lifecycle events and message processing. Default: `false`. |
| `logger` | `Logger` | No | Custom logger to use for debug output. Falls back to `console` if not provided. |
