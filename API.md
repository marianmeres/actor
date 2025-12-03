# API Reference

Complete API documentation for `@marianmeres/actor`.

## Table of Contents

- [Factory Functions](#factory-functions)
  - [createActor](#createactoroptions)
  - [createStateActor](#createstateactorinitialstate-handler)
  - [defineMessage](#definemessagetype)
- [Types](#types)
  - [Actor](#actortstate-tmessage-tresponse)
  - [ActorOptions](#actoroptionsststate-tmessage-tresponse)
  - [MessageHandler](#messagehandlertstate-tmessage-tresponse)
  - [StateReducer](#statereducertstate-tresponse)
  - [Subscriber](#subscribertstate)
  - [Unsubscribe](#unsubscribe)
  - [MessageCreator](#messagecreatorttpayload-tmessage)

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

### `createStateActor(initialState, handler)`

Creates a simplified actor where the handler directly returns the new state.

This is a convenience wrapper around `createActor` for the common case where the handler's return value IS the new state (no separate reducer needed).

```typescript
function createStateActor<TState, TMessage>(
  initialState: TState,
  handler: (state: TState, message: TMessage) => TState | Promise<TState>
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

## Types

### `Actor<TState, TMessage, TResponse>`

The Actor interface - a message-driven stateful computation unit.

An actor processes messages sequentially through a mailbox, ensuring thread-safe state mutations. Messages are processed in FIFO order, and each message is fully processed before the next one begins.

```typescript
interface Actor<TState, TMessage, TResponse = void> {
  send: (message: TMessage) => Promise<TResponse>;
  subscribe: (fn: Subscriber<TState>) => Unsubscribe;
  getState: () => TState;
  destroy: () => void;
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

The subscriber is called immediately with the current state, and then whenever the state changes. Subscribers are only notified when the state reference changes (shallow comparison).

```typescript
subscribe(fn: Subscriber<TState>): Unsubscribe
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `Subscriber<TState>` | Callback function that receives the current state |

**Returns:** `Unsubscribe` - A function to remove the subscription

**Example:**

```typescript
const unsubscribe = actor.subscribe((state) => {
  console.log("State changed:", state);
});

// Later, to stop receiving updates:
unsubscribe();
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

---

### `ActorOptions<TState, TMessage, TResponse>`

Configuration options for creating an actor.

```typescript
interface ActorOptions<TState, TMessage, TResponse> {
  initialState: TState;
  handler: MessageHandler<TState, TMessage, TResponse>;
  reducer?: StateReducer<TState, TResponse>;
  onError?: (error: Error, message: TMessage) => void;
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `initialState` | `TState` | Yes | The initial state of the actor |
| `handler` | `MessageHandler<TState, TMessage, TResponse>` | Yes | The message handler function. Receives the current state and a message, returns a response. Can be sync or async. |
| `reducer` | `StateReducer<TState, TResponse>` | No | Transforms handler response into new state. When omitted, state is not automatically updated. |
| `onError` | `(error: Error, message: TMessage) => void` | No | Called when the message handler throws. The error is still propagated (the `send()` promise will reject), but this callback allows for logging or other side effects. |

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

### `Subscriber<TState>`

A callback function that receives state updates.

Subscribers are called immediately upon subscription with the current state, and subsequently whenever the state changes.

```typescript
type Subscriber<TState> = (state: TState) => void;
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
