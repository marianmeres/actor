# AGENTS.md - Machine-Readable Package Documentation

## Package Identity

- **Name**: `@marianmeres/actor`
- **Version**: 1.0.0
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
├── mod.ts          # Entry point, re-exports from actor.ts
└── actor.ts        # Core implementation (~490 lines)

tests/
└── actor.test.ts   # Test suite (~530 lines, 26 tests)

scripts/
└── build-npm.ts    # NPM build script
```

## Public API

### Factory Functions

#### `createActor<TState, TMessage, TResponse>(options)`
- **Purpose**: Creates a full-featured actor with reducer support
- **Location**: `src/actor.ts:286-365`
- **Parameters**:
  - `options.initialState: TState` - Initial state
  - `options.handler: (state, message) => TResponse | Promise<TResponse>` - Message processor
  - `options.reducer?: (state, response) => TState` - State transformer
  - `options.onError?: (error, message) => void` - Error callback
- **Returns**: `Actor<TState, TMessage, TResponse>`

#### `createStateActor<TState, TMessage>(initialState, handler)`
- **Purpose**: Simplified actor where handler returns new state directly
- **Location**: `src/actor.ts:410-419`
- **Parameters**:
  - `initialState: TState` - Initial state
  - `handler: (state, message) => TState | Promise<TState>` - State transformer
- **Returns**: `Actor<TState, TMessage, TState>`

#### `defineMessage<TType, TPayload?>(type)`
- **Purpose**: Creates typed message factory functions
- **Location**: `src/actor.ts:459-490`
- **Overloads**:
  - Without payload: `defineMessage<TType>(type)` → `() => { type: TType }`
  - With payload: `defineMessage<TType, TPayload>(type)` → `(payload) => { type: TType; payload: TPayload }`

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
}

type MessageCreator<TPayload, TMessage> = TPayload extends undefined
  ? () => TMessage
  : (payload: TPayload) => TMessage;
```

## Dependencies

### Runtime
- `@marianmeres/pubsub` (^2.4.1) - Internal subscription management

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
deno task test

# Build for NPM
deno task npm:build

# Publish to NPM
deno task npm:publish
```

## Common Patterns

### Counter Actor
```typescript
const counter = createStateActor<number, { type: "INC" } | { type: "DEC" }>(
  0,
  (state, msg) => msg.type === "INC" ? state + 1 : state - 1
);
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

## Key Behaviors

1. **Sequential Processing**: Messages are always processed one at a time, in order
2. **Error Isolation**: Handler errors reject the send() promise but don't break the mailbox
3. **Shallow Comparison**: Subscribers only notified when state reference changes
4. **Immediate Emission**: subscribe() calls the callback immediately with current state
5. **Graceful Destruction**: destroy() clears mailbox and rejects pending sends
6. **Async Support**: Handlers can be sync or async (Promise-returning)

## Testing

- 26 tests covering all functionality
- Test categories: Core, Subscriptions, Error Handling, Destroy, Counter Example, Form Example, Concurrency
- Uses Deno's native test framework

## Use Cases

**Good fit:**
- Complex async workflows requiring serialization
- Shared state with multiple async writers
- WebSocket/SSE message handling
- Form submission with validation
- Background task queues
- Undo/redo stacks
- Game state machines

**Not recommended:**
- Simple component state (use signals/stores)
- Synchronous-only state updates
- Single-writer scenarios
