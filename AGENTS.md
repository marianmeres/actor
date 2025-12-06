# AGENTS.md - Machine-Readable Package Documentation

## Package Identity

- **Name**: `@marianmeres/actor`
- **Version**: 1.1.0
- **Type**: Library
- **Runtime**: Deno, Node.js, Browser
- **Language**: TypeScript
- **License**: MIT

## Purpose

Implements the Actor Model pattern for TypeScript/JavaScript. Provides a message-driven stateful computation unit with sequential message processing through a mailbox, ensuring thread-safe state mutations without locks.

## Architecture

### Core Concepts

1. **Actor**: Stateful computation unit with a mailbox
2. **Message**: Data sent to an actor for processing
3. **Handler**: Function that processes messages and returns responses
4. **Reducer**: Optional function that transforms handler responses into state
5. **Mailbox**: FIFO queue for pending messages

### Message Flow

```
send(message) -> mailbox.enqueue -> processMailbox -> handler(state, message) -> reducer(state, response) -> notifySubscribers -> resolve(response)
```

### State Management

- State is immutable from the consumer's perspective
- Updates only occur through the reducer (if provided)
- Shallow comparison determines if subscribers are notified
- State remains accessible after destroy (but no longer updates)

## File Structure

```
src/
├── mod.ts           # Entry point, re-exports from actor.ts and with-dtokit.ts
├── actor.ts         # Core implementation (~490 lines)
└── with-dtokit.ts   # DTOKit integration for exhaustive handlers (~320 lines)

tests/
└── actor.test.ts    # Test suite (~815 lines, 38 tests)

scripts/
└── build-npm.ts     # NPM build script
```

## Public API

### Core Factory Functions (actor.ts)

#### `createActor<TState, TMessage, TResponse>(options)`
- **Purpose**: Creates a full-featured actor with reducer support
- **Location**: `src/actor.ts:345-444`
- **Parameters**:
  - `options.initialState: TState` - Initial state
  - `options.handler: (state, message) => TResponse | Promise<TResponse>` - Message processor
  - `options.reducer?: (state, response) => TState` - State transformer
  - `options.onError?: (error, message) => void` - Error callback
  - `options.debug?: boolean` - Enable debug logging (default: false)
  - `options.logger?: Logger` - Custom logger (falls back to console)
- **Returns**: `Actor<TState, TMessage, TResponse>`

#### `createStateActor<TState, TMessage>(initialState, handler, options?)`
- **Purpose**: Simplified actor where handler returns new state directly
- **Location**: `src/actor.ts:500-512`
- **Parameters**:
  - `initialState: TState` - Initial state
  - `handler: (state, message) => TState | Promise<TState>` - State transformer
  - `options?: { debug?: boolean; logger?: Logger }` - Optional debug logging configuration
- **Returns**: `Actor<TState, TMessage, TState>`

#### `defineMessage<TType, TPayload?>(type)`
- **Purpose**: Creates typed message factory functions
- **Location**: `src/actor.ts:459-490`
- **Overloads**:
  - Without payload: `defineMessage<TType>(type)` → `() => { type: TType }`
  - With payload: `defineMessage<TType, TPayload>(type)` → `(payload) => { type: TType; payload: TPayload }`

### DTOKit Integration Functions (with-dtokit.ts)

#### `createTypedStateActor<TSchemas, TState>(initialState, handlers, options?)`
- **Purpose**: State actor with compile-time exhaustive message handling
- **Location**: `src/with-dtokit.ts:184-198`
- **Parameters**:
  - `initialState: TState` - Initial state
  - `handlers: ExhaustiveHandlers<TSchemas, TState, TState>` - Handler for each message type
  - `options?: { debug?: boolean; logger?: Logger }` - Optional debug logging configuration
- **Returns**: `Actor<TState, MessageUnion<TSchemas>, TState>`
- **Key benefit**: TypeScript errors if any message type handler is missing

#### `createTypedActor<TSchemas, TState, TResponse>(options)`
- **Purpose**: Full-featured typed actor with reducer and error handling
- **Location**: `src/with-dtokit.ts:289-310`
- **Parameters**:
  - `options.initialState: TState`
  - `options.handlers: ExhaustiveHandlers<TSchemas, TState, TResponse>`
  - `options.reducer?: (state, response) => TState`
  - `options.onError?: (error, message) => void`
  - `options.debug?: boolean` - Enable debug logging (default: false)
  - `options.logger?: Logger` - Custom logger (falls back to console)
- **Returns**: `Actor<TState, MessageUnion<TSchemas>, TResponse>`

#### `createMessageFactory<TSchemas>()`
- **Purpose**: DTOKit factory for runtime message validation
- **Location**: `src/with-dtokit.ts:315-319`
- **Returns**: `DtoFactory<TSchemas, "type">` with `parse()`, `is()`, `getId()`, `isValid()` methods
- **Use case**: Validating messages from WebSocket, postMessage, API responses

### Actor Interface Methods

#### `send(message): Promise<TResponse>`
- **Purpose**: Enqueue message for processing
- **Behavior**: FIFO order, sequential processing, resolves when message processed
- **Throws**: `Error("Actor has been destroyed")` if destroyed

#### `subscribe(fn): Unsubscribe`
- **Purpose**: Subscribe to state changes
- **Behavior**: Immediate emission of current state, then on each change
- **Note**: Uses shallow comparison to detect changes

#### `getState(): TState`
- **Purpose**: Synchronous state access
- **Behavior**: Works even after destroy

#### `destroy(): void`
- **Purpose**: Cleanup actor resources
- **Behavior**: Clears mailbox, removes subscribers, rejects future sends

### Types

```typescript
// Core types (actor.ts)
interface Logger {
  debug: (...args: any[]) => any;
  log: (...args: any[]) => any;
  warn: (...args: any[]) => any;
  error: (...args: any[]) => any;
}

type MessageHandler<TState, TMessage, TResponse = void> =
  (state: TState, message: TMessage) => TResponse | Promise<TResponse>;

type StateReducer<TState, TResponse> =
  (state: TState, response: TResponse) => TState;

type Subscriber<TState> = (state: TState) => void;

type Unsubscribe = () => void;

interface Actor<TState, TMessage, TResponse = void> {
  send: (message: TMessage) => Promise<TResponse>;
  subscribe: (fn: Subscriber<TState>) => Unsubscribe;
  getState: () => TState;
  destroy: () => void;
}

interface ActorOptions<TState, TMessage, TResponse> {
  initialState: TState;
  handler: MessageHandler<TState, TMessage, TResponse>;
  reducer?: StateReducer<TState, TResponse>;
  onError?: (error: Error, message: TMessage) => void;
  debug?: boolean;
  logger?: Logger;
}

type MessageCreator<TPayload, TMessage> = TPayload extends undefined
  ? () => TMessage
  : (payload: TPayload) => TMessage;

// DTOKit types (with-dtokit.ts)
type MessageSchemas = Record<string, { type: string }>;

type MessageUnion<TSchemas extends MessageSchemas> = TSchemas[keyof TSchemas];

type ExhaustiveHandlers<TSchemas extends MessageSchemas, TState, TResult> = {
  [K in keyof TSchemas]: (msg: TSchemas[K], state: TState) => TResult | Promise<TResult>;
};

interface TypedActorOptions<TSchemas extends MessageSchemas, TState, TResponse> {
  initialState: TState;
  handlers: ExhaustiveHandlers<TSchemas, TState, TResponse>;
  reducer?: (state: TState, response: TResponse) => TState;
  onError?: (error: Error, message: MessageUnion<TSchemas>) => void;
  debug?: boolean;
  logger?: Logger;
}
```

## Dependencies

### Runtime
- `@marianmeres/pubsub` (^2.4.4) - Internal subscription management
- `@marianmeres/dtokit` (^1.0.4) - Exhaustive type checking for typed actors

### Development
- `@marianmeres/npmbuild` - NPM build tooling
- `@std/assert` - Test assertions
- `@std/fs` - File system utilities
- `@std/path` - Path utilities

## Commands

```bash
# Run tests
deno test

# Run tests with watch mode
deno task test:watch

# Build for NPM
deno task npm:build

# Publish to NPM
deno task npm:publish

# Release (JSR + NPM)
deno task publish
```

## Common Patterns

### Counter Actor
```typescript
const counter = createStateActor<number, { type: "INC" } | { type: "DEC" }>(
  0,
  (state, msg) => msg.type === "INC" ? state + 1 : state - 1
);
```

### Typed Counter (Exhaustive)
```typescript
type Schemas = {
  INC: { type: "INC" };
  DEC: { type: "DEC" };
  ADD: { type: "ADD"; amount: number };
};

const counter = createTypedStateActor<Schemas, number>(0, {
  INC: (_, state) => state + 1,
  DEC: (_, state) => state - 1,
  ADD: (msg, state) => state + msg.amount,
});
```

### Form State Actor
```typescript
interface FormState {
  fields: Record<string, { value: string; error: string | null; touched: boolean }>;
  isSubmitting: boolean;
}

const form = createStateActor<FormState, FormMessage>(initialState, handler);
```

### Async Data Fetcher
```typescript
const fetcher = createActor<DataState, FetchMessage, DataState>({
  initialState: { data: null, loading: false, error: null },
  handler: async (state, msg) => {
    const res = await fetch(msg.url);
    return { data: await res.json(), loading: false, error: null };
  },
  reducer: (_, response) => response,
});
```

### External Message Validation
```typescript
const factory = createMessageFactory<Schemas>();

socket.onmessage = (event) => {
  const msg = factory.parse(JSON.parse(event.data));
  if (msg) actor.send(msg);
};
```

## Key Behaviors

1. **Sequential Processing**: Messages are always processed one at a time, in order
2. **Error Isolation**: Handler errors reject the send() promise but don't break the mailbox
3. **Shallow Comparison**: Subscribers only notified when state reference changes
4. **Immediate Emission**: subscribe() calls the callback immediately with current state
5. **Graceful Destruction**: destroy() clears mailbox and rejects pending sends
6. **Async Support**: Handlers can be sync or async (Promise-returning)
7. **Exhaustive Handling**: Typed actors enforce handlers for all message types at compile-time
8. **Debug Logging**: Optional `debug` flag enables verbose logging via custom `Logger` or console

## Testing

- 44 tests covering all functionality
- Test categories: Core, Subscriptions, Error Handling, Destroy, Counter Example, Form Example, Concurrency, DTOKit Integration, Debug Logging
- Uses Deno's native test framework

## Design Philosophy

This library implements a **single-actor pattern** intentionally:
- No actor addresses, hierarchies, or spawning
- Each actor is self-contained
- Focuses on serialized message processing with encapsulated state

For distributed actor systems, consider Erlang/Elixir OTP, Akka, or xstate.

## Use Cases

**Good fit:**
- Complex async workflows requiring serialization
- Shared state with multiple async writers
- WebSocket/SSE message handling
- Form submission with validation
- Background task queues
- Undo/redo stacks
- Game state machines
- Event sourcing patterns

**Not recommended:**
- Simple component state (use signals/stores)
- Synchronous-only state updates
- Single-writer scenarios
