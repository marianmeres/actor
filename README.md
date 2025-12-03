# @marianmeres/actor

[![NPM Version](https://img.shields.io/npm/v/@marianmeres/actor)](https://www.npmjs.com/package/@marianmeres/actor)
[![JSR Version](https://jsr.io/badges/@marianmeres/actor)](https://jsr.io/@marianmeres/actor)

A lightweight, type-safe Actor Model implementation for TypeScript/JavaScript.

## What is an Actor?

An actor is a message-driven stateful computation unit. It processes messages sequentially
through a mailbox, ensuring thread-safe state mutations without locks or complex
synchronization.

**Key benefits:**
- **Sequential processing**: Messages are queued and processed one at a time (FIFO)
- **No race conditions**: Concurrent sends are serialized automatically
- **Reactive subscriptions**: Subscribe to state changes
- **Error isolation**: Handler errors don't break the mailbox
- **Framework-agnostic**: Works with any UI framework or Node.js

## Installation

```bash
# Deno
deno add jsr:@marianmeres/actor
```

```bash
# npm
npm install @marianmeres/actor
```

## Quick Start

```typescript
import { createStateActor } from "@marianmeres/actor";

// Define message types
type Message =
  | { type: "INCREMENT" }
  | { type: "DECREMENT" }
  | { type: "ADD"; payload: number };

// Create a counter actor
const counter = createStateActor<number, Message>(0, (state, msg) => {
  switch (msg.type) {
    case "INCREMENT": return state + 1;
    case "DECREMENT": return state - 1;
    case "ADD": return state + msg.payload;
  }
});

// Send messages
await counter.send({ type: "INCREMENT" });
await counter.send({ type: "ADD", payload: 10 });

console.log(counter.getState()); // 11

// Subscribe to changes
const unsubscribe = counter.subscribe((state) => {
  console.log("Counter:", state);
});

// Cleanup
counter.destroy();
```

## API Reference

### `createActor<TState, TMessage, TResponse>(options)`

Creates an actor with full control over state updates.

**Type Parameters:**
- `TState` - The type of the actor's state
- `TMessage` - The type of messages the actor can receive
- `TResponse` - The type of response the handler returns (defaults to `void`)

**Options:**
- `initialState: TState` - The initial state
- `handler: (state, message) => TResponse | Promise<TResponse>` - Message handler
- `reducer?: (state, response) => TState` - Transforms handler response to new state
- `onError?: (error, message) => void` - Called when handler throws

**Returns:** `Actor<TState, TMessage, TResponse>`

### `createStateActor<TState, TMessage>(initialState, handler)`

Simplified actor where the handler directly returns the new state.

```typescript
const actor = createStateActor<number, { delta: number }>(
  0,
  (state, msg) => state + msg.delta
);
```

### `defineMessage<TType, TPayload?>(type)`

Creates typed message factory functions (like Redux action creators).

```typescript
const increment = defineMessage("INCREMENT");
const add = defineMessage<"ADD", number>("ADD");

await counter.send(increment());  // { type: "INCREMENT" }
await counter.send(add(5));       // { type: "ADD", payload: 5 }
```

### Actor Methods

#### `send(message): Promise<TResponse>`

Sends a message to the actor. Messages are queued and processed sequentially.
Returns a promise that resolves with the handler's response.

```typescript
const result = await actor.send({ type: "ADD", value: 5 });
```

#### `subscribe(fn): Unsubscribe`

Subscribes to state changes. The callback is called immediately with the current
state, then whenever state changes.

```typescript
const unsubscribe = actor.subscribe((state) => console.log(state));
// Later:
unsubscribe();
```

#### `getState(): TState`

Returns the current state synchronously.

#### `destroy(): void`

Destroys the actor, clearing the mailbox and all subscribers. After destruction,
`send()` will reject with "Actor has been destroyed".

## Understanding the Reducer

The `reducer` option separates **what the handler returns** from **how state is updated**.

### Without reducer (simple case)

When using `createStateActor`, the handler's return value IS the new state:

```typescript
const counter = createStateActor<number, { delta: number }>(
  0,
  (state, msg) => state + msg.delta  // Returns new state directly
);
```

### With reducer (advanced case)

When you need the handler to return something different from the state:

```typescript
const actor = createActor<
  number,                              // State type
  string,                              // Message type
  { delta: number; log: string }       // Response type (different from state!)
>({
  initialState: 0,
  handler: (state, msg) => {
    // Handler returns rich response data
    return { delta: msg.length, log: `Processed: ${msg}` };
  },
  reducer: (state, response) => {
    // Reducer extracts only what's needed for state
    return state + response.delta;
  },
});

const result = await actor.send("hello");
// result = { delta: 5, log: "Processed: hello" }  ← caller gets full response
// state = 5                                        ← but state only stores delta
```

**Use cases for reducers:**
- **Async operations**: Handler fetches data, returns `{ data, metadata }`. Reducer stores only `data`.
- **Validation**: Handler validates, returns `{ valid, errors }`. Reducer updates state only if valid.
- **Side effects**: Handler performs action, returns status. Reducer decides what to persist.

## Examples

### Form State Management

```typescript
interface FormState {
  fields: Record<string, { value: string; error: string | null; touched: boolean }>;
  isSubmitting: boolean;
  submitError: string | null;
}

type FormMessage =
  | { type: "SET_FIELD"; name: string; value: string }
  | { type: "TOUCH_FIELD"; name: string }
  | { type: "SUBMIT" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_ERROR"; error: string }
  | { type: "RESET" };

const form = createStateActor<FormState, FormMessage>(
  {
    fields: {
      email: { value: "", error: null, touched: false },
      password: { value: "", error: null, touched: false },
    },
    isSubmitting: false,
    submitError: null,
  },
  (state, msg) => {
    switch (msg.type) {
      case "SET_FIELD":
        return {
          ...state,
          fields: {
            ...state.fields,
            [msg.name]: { ...state.fields[msg.name], value: msg.value },
          },
        };
      case "SUBMIT":
        return { ...state, isSubmitting: true, submitError: null };
      case "SUBMIT_SUCCESS":
        return { ...state, isSubmitting: false };
      case "SUBMIT_ERROR":
        return { ...state, isSubmitting: false, submitError: msg.error };
      case "RESET":
        return { ...state, isSubmitting: false, submitError: null };
      default:
        return state;
    }
  }
);
```

### Async Data Fetching

```typescript
interface DataState {
  data: unknown | null;
  loading: boolean;
  error: string | null;
}

type FetchMessage = { type: "FETCH"; url: string };

const fetcher = createActor<DataState, FetchMessage, DataState>({
  initialState: { data: null, loading: false, error: null },
  handler: async (state, msg) => {
    try {
      const res = await fetch(msg.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { data, loading: false, error: null };
    } catch (e) {
      return { data: null, loading: false, error: String(e) };
    }
  },
  reducer: (_, response) => response,
});

// Multiple rapid fetches are serialized - no race conditions!
fetcher.send({ type: "FETCH", url: "/api/data" });
fetcher.send({ type: "FETCH", url: "/api/data" });
fetcher.send({ type: "FETCH", url: "/api/data" });
// Only the responses arrive in order, one at a time
```

## When to Use Actors

**Good fit:**
- Complex async workflows needing serialization
- Shared state with multiple async writers
- WebSocket/SSE message handling
- Form submission with validation
- Background task queues
- Undo/redo stacks
- Game state machines

**Probably overkill:**
- Simple component state (use signals/stores instead)
- Synchronous state updates only
- Single-writer scenarios

## Full API Documentation

For complete API documentation including all types and detailed parameter descriptions, see [API.md](API.md).

## License

MIT
