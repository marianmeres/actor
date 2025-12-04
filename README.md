# @marianmeres/actor

[![NPM Version](https://img.shields.io/npm/v/@marianmeres/actor)](https://www.npmjs.com/package/@marianmeres/actor)
[![JSR Version](https://jsr.io/badges/@marianmeres/actor)](https://jsr.io/@marianmeres/actor)

A lightweight, type-safe Actor Model implementation for TypeScript/JavaScript.

## What is an Actor?

An actor is a message-driven stateful computation unit. It processes messages sequentially
through a mailbox, ensuring safe state mutations without complex async coordination.

**Key benefits:**
- **Sequential processing**: Messages are queued and processed one at a time (FIFO)
- **No async race conditions**: Concurrent sends are serialized automatically
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

For complete API documentation, see [API.md](API.md).

| Function | Description |
|----------|-------------|
| `createStateActor(initial, handler)` | Simple actor where handler returns the new state |
| `createActor(options)` | Full control with optional `reducer` and `onError` |
| `defineMessage(type)` | Creates typed message factories (like Redux action creators) |

| Actor Method | Description |
|--------------|-------------|
| `send(msg)` | Queue message, returns `Promise<TResponse>` |
| `subscribe(fn)` | Subscribe to state changes (called immediately + on change) |
| `getState()` | Get current state synchronously |
| `destroy()` | Clear mailbox and subscribers |

### Understanding the Reducer

The `reducer` option separates **what the handler returns** from **how state is updated**.

**Without reducer** (`createStateActor`): handler's return value IS the new state.

**With reducer**: handler can return rich data, reducer extracts what goes into state:

```typescript
const actor = createActor<
  number,                              // State type
  string,                              // Message type
  { delta: number; log: string }       // Response type (different from state!)
>({
  initialState: 0,
  handler: (state, msg) => {
    return { delta: msg.length, log: `Processed: ${msg}` };
  },
  reducer: (state, response) => state + response.delta,
});

const result = await actor.send("hello");
// result = { delta: 5, log: "Processed: hello" }  ← caller gets full response
// state = 5                                        ← but state only stores delta
```

**Use cases:** async operations returning `{ data, metadata }`, validation returning
`{ valid, errors }`, side effects returning status while reducer decides what to persist.

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

## Design Philosophy: Single-Actor Simplicity

This library intentionally implements a **single-actor pattern** without actor addresses,
hierarchies, or spawning capabilities. This is a deliberate design choice.

### What's NOT included (and why)

In the traditional Actor Model (Erlang/Elixir OTP, Akka), actors have:

- **Addresses** - unique identifiers allowing actors to send messages to each other
- **Spawning** - actors can create child actors and receive their addresses
- **Supervision** - parent actors monitor and restart failed children

These features are essential for building distributed, fault-tolerant systems with many
coordinating actors. However, they add significant complexity.

### What this library provides instead

A focused, lightweight primitive for the most common use case: **serialized message
processing with encapsulated state**. Each actor is self-contained and handles:

- Sequential (FIFO) message processing via mailbox
- Safe state mutations without complex async coordination
- Reactive subscriptions for state changes
- Error isolation within the handler

### When you might need the full Actor Model

If your use case requires actors communicating with each other, building actor hierarchies,
or distributed fault-tolerance, consider:

- [xstate](https://xstate.js.org/) - State machines with actor spawning
- [Comlink](https://github.com/GoogleChromeLabs/comlink) - Web Workers as actors
- A backend runtime like Elixir/Erlang for true distributed actors

For most frontend and simple backend scenarios, this single-actor approach provides the
core benefits (serialization, isolation, reactivity) without the cognitive overhead of
a full actor system.

## Examples

### Async Data Fetching

```typescript
interface DataState {
  data: unknown | null;
  loading: boolean;
  error: string | null;
}

const fetcher = createActor<DataState, { type: "FETCH"; url: string }, DataState>({
  initialState: { data: null, loading: false, error: null },
  handler: async (state, msg) => {
    const res = await fetch(msg.url);
    const data = await res.json();
    return { data, loading: false, error: null };
  },
  reducer: (_, response) => response,
});

// Multiple rapid fetches are serialized - no race conditions!
fetcher.send({ type: "FETCH", url: "/api/data" });
fetcher.send({ type: "FETCH", url: "/api/data" });
// Responses arrive in order, one at a time
```

### Orchestrating Multiple Actors with FSM

A common DDD pattern: use a finite state machine to coordinate multiple domain actors.
Each actor manages its own domain state, while the FSM orchestrates the workflow.

```typescript
import { createStateActor } from "@marianmeres/actor";
import { createFsm } from "@marianmeres/fsm";

// Domain actors - each manages its own bounded context
const cart = createStateActor({ items: [], total: 0 }, (state, msg) => {
  switch (msg.type) {
    case "ADD_ITEM": return { ...state, items: [...state.items, msg.item] };
    case "CLEAR": return { items: [], total: 0 };
    default: return state;
  }
});

const payment = createStateActor({ status: "idle", txId: null }, (state, msg) => {
  switch (msg.type) {
    case "PROCESS": return { status: "processing", txId: null };
    case "SUCCESS": return { status: "success", txId: msg.txId };
    case "FAIL": return { status: "failed", txId: null };
    default: return state;
  }
});

const inventory = createStateActor({ reserved: [] }, (state, msg) => {
  switch (msg.type) {
    case "RESERVE": return { reserved: [...state.reserved, ...msg.items] };
    case "RELEASE": return { reserved: [] };
    default: return state;
  }
});

// FSM orchestrates the checkout workflow
const checkoutFsm = createFsm({
  initial: "IDLE",
  context: { error: null },
  states: {
    IDLE: {
      on: { start: "RESERVING" }
    },
    RESERVING: {
      onEnter: async (ctx) => {
        await inventory.send({ type: "RESERVE", items: cart.getState().items });
        checkoutFsm.transition("reserved");
      },
      on: { reserved: "CHARGING", fail: "FAILED" }
    },
    CHARGING: {
      onEnter: async (ctx) => {
        await payment.send({ type: "PROCESS" });
        // Simulate payment processing
        const success = Math.random() > 0.1;
        if (success) {
          await payment.send({ type: "SUCCESS", txId: "tx_123" });
          checkoutFsm.transition("charged");
        } else {
          await payment.send({ type: "FAIL" });
          checkoutFsm.transition("fail");
        }
      },
      on: { charged: "COMPLETED", fail: "ROLLING_BACK" }
    },
    ROLLING_BACK: {
      onEnter: async () => {
        await inventory.send({ type: "RELEASE" });
        checkoutFsm.transition("rolled_back");
      },
      on: { rolled_back: "FAILED" }
    },
    COMPLETED: {
      onEnter: async () => {
        await cart.send({ type: "CLEAR" });
      }
    },
    FAILED: {}
  }
});

// Usage: subscribe to FSM for workflow state, actors for domain state
checkoutFsm.subscribe(({ state }) => console.log("Checkout:", state));
payment.subscribe((s) => console.log("Payment:", s.status));
```

### Multi-Actor Notification System

```typescript
// User preferences actor
const preferences = createStateActor(
  { email: true, push: true, sms: false },
  (state, msg) => ({ ...state, [msg.channel]: msg.enabled })
);

// Notification queue actor - serializes delivery
const notificationQueue = createActor({
  initialState: { pending: 0, sent: 0 },
  handler: async (state, msg) => {
    const prefs = preferences.getState();
    const results = [];

    if (prefs.email && msg.channels.includes("email")) {
      await sendEmail(msg.to, msg.content);
      results.push("email");
    }
    if (prefs.push && msg.channels.includes("push")) {
      await sendPush(msg.to, msg.content);
      results.push("push");
    }

    return { delivered: results, messageId: msg.id };
  },
  reducer: (state, response) => ({
    pending: state.pending - 1,
    sent: state.sent + response.delivered.length
  })
});

// FSM controls notification campaign lifecycle
const campaignFsm = createFsm({
  initial: "DRAFT",
  context: { recipientCount: 0, sentCount: 0 },
  states: {
    DRAFT: { on: { schedule: "SCHEDULED", send: "SENDING" } },
    SCHEDULED: { on: { trigger: "SENDING", cancel: "DRAFT" } },
    SENDING: {
      onEnter: async (ctx) => {
        for (const recipient of ctx.recipients) {
          await notificationQueue.send({
            id: crypto.randomUUID(),
            to: recipient,
            content: ctx.message,
            channels: ["email", "push"]
          });
          ctx.sentCount++;
        }
        campaignFsm.transition("complete");
      },
      on: { complete: "COMPLETED", pause: "PAUSED" }
    },
    PAUSED: { on: { resume: "SENDING" } },
    COMPLETED: {}
  }
});
```

### Actor as Aggregate Root

In DDD, the aggregate root coordinates changes within a bounded context:

```typescript
// Order aggregate - the actor IS the aggregate root
const createOrderActor = (orderId: string) => createStateActor(
  {
    id: orderId,
    status: "pending",
    items: [],
    payments: [],
    shipments: []
  },
  (state, msg) => {
    switch (msg.type) {
      case "ADD_ITEM":
        if (state.status !== "pending") return state; // Invariant
        return { ...state, items: [...state.items, msg.item] };

      case "SUBMIT":
        if (state.items.length === 0) return state; // Invariant
        return { ...state, status: "submitted" };

      case "RECORD_PAYMENT":
        return {
          ...state,
          payments: [...state.payments, msg.payment],
          status: calculateStatus(state.payments, msg.payment)
        };

      case "SHIP":
        if (state.status !== "paid") return state; // Invariant
        return { ...state, shipments: [...state.shipments, msg.shipment] };

      default:
        return state;
    }
  }
);

// Each order is an independent actor maintaining its own invariants
const order1 = createOrderActor("order-1");
const order2 = createOrderActor("order-2");

// Messages to different orders process independently
await order1.send({ type: "ADD_ITEM", item: { sku: "A", qty: 2 } });
await order2.send({ type: "ADD_ITEM", item: { sku: "B", qty: 1 } });
```

### Error Handling with FSM Orchestration

Use `onError` to propagate actor failures to the FSM layer:

```typescript
// FSM with error handling - payload stored via onEnter
const workflowFsm = createFsm({
  initial: "IDLE",
  context: { error: null },
  states: {
    IDLE: { on: { start: "PROCESSING" } },
    PROCESSING: { on: { done: "COMPLETED", error: "ERROR" } },
    COMPLETED: {},
    ERROR: {
      onEnter: (ctx, payload) => { ctx.error = payload; }  // Store error from payload
    }
  }
});

// Actor with onError wired to FSM
const processor = createActor({
  initialState: { result: null },
  handler: async (state, msg) => {
    const res = await fetch(msg.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { result: await res.json() };
  },
  reducer: (_, response) => response,
  onError: (error, message) => {
    // Pass error as transition payload
    workflowFsm.transition("error", { error: String(error), message });
  }
});

// Usage
workflowFsm.transition("start");
await processor.send({ url: "/api/data" });  // If this throws, FSM → ERROR
workflowFsm.transition("done");              // Only reached on success
```

### Nested FSM: Actor-Level + App-Level Orchestration

Each actor can have its own internal FSM for complex lifecycle management, while a global
FSM orchestrates multiple actors at the application level.

```typescript
import { createActor } from "@marianmeres/actor";
import { createFsm } from "@marianmeres/fsm";

// Factory: creates a "job" actor with its own internal FSM lifecycle
const createJobActor = (id: string, work: () => Promise<unknown>) => {
  // Inner FSM - manages this job's lifecycle
  const jobFsm = createFsm({
    initial: "IDLE",
    context: { result: null, error: null },
    states: {
      IDLE: { on: { start: "RUNNING" } },
      RUNNING: { on: { complete: "DONE", fail: "FAILED" } },
      DONE: {},
      FAILED: { on: { retry: "RUNNING" } }  // Can retry from failed
    }
  });

  // Actor wraps the FSM and handles async work
  const actor = createActor<
    { id: string; status: string; result: unknown; error: unknown },
    { type: "START" } | { type: "RETRY" },
    { status: string }
  >({
    initialState: { id, status: "IDLE", result: null, error: null },
    handler: async (state, msg) => {
      if (msg.type === "START" || msg.type === "RETRY") {
        jobFsm.transition(msg.type === "START" ? "start" : "retry");
        try {
          const result = await work();
          jobFsm.transition("complete");
          jobFsm.context.result = result;
          return { status: "DONE" };
        } catch (e) {
          jobFsm.transition("fail");
          jobFsm.context.error = e;
          return { status: "FAILED" };
        }
      }
      return { status: jobFsm.state };
    },
    reducer: (state, response) => ({
      ...state,
      status: response.status,
      result: jobFsm.context.result,
      error: jobFsm.context.error
    })
  });

  return { actor, fsm: jobFsm };
};

// Create job actors with different work
const job1 = createJobActor("job-1", async () => {
  await delay(100);
  return { data: "result-1" };
});
const job2 = createJobActor("job-2", async () => {
  await delay(200);
  if (Math.random() < 0.3) throw new Error("Random failure");
  return { data: "result-2" };
});

// App-level FSM - orchestrates the batch of jobs
const batchFsm = createFsm({
  initial: "IDLE",
  context: { completed: 0, failed: 0, total: 2 },
  states: {
    IDLE: { on: { run: "RUNNING" } },
    RUNNING: {
      onEnter: async (ctx) => {
        // Start all jobs in parallel
        const results = await Promise.all([
          job1.actor.send({ type: "START" }),
          job2.actor.send({ type: "START" })
        ]);

        // Tally results
        results.forEach(r => {
          if (r.status === "DONE") ctx.completed++;
          else ctx.failed++;
        });

        batchFsm.transition(ctx.failed > 0 ? "partial" : "success");
      },
      on: { success: "COMPLETED", partial: "PARTIAL_FAILURE" }
    },
    PARTIAL_FAILURE: {
      on: {
        retry: "RETRYING",
        accept: "COMPLETED"
      }
    },
    RETRYING: {
      onEnter: async (ctx) => {
        // Retry only failed jobs
        const failedJobs = [job1, job2].filter(j => j.fsm.state === "FAILED");
        for (const job of failedJobs) {
          const result = await job.actor.send({ type: "RETRY" });
          if (result.status === "DONE") {
            ctx.failed--;
            ctx.completed++;
          }
        }
        batchFsm.transition(ctx.failed > 0 ? "partial" : "success");
      },
      on: { success: "COMPLETED", partial: "PARTIAL_FAILURE" }
    },
    COMPLETED: {}
  }
});

// Subscribe to see the layered state
batchFsm.subscribe(({ state }) => console.log("Batch:", state));
job1.actor.subscribe(s => console.log("Job1:", s.status));
job2.actor.subscribe(s => console.log("Job2:", s.status));

// Run the batch
batchFsm.transition("run");
```

### System State History (Audit Trail)

Track state changes across multiple actors and FSM for debugging, audit, or undo/redo:

```typescript
// Historian actor - records all state changes across the system
const historian = createStateActor<
  { entries: Array<{ ts: number; source: string; state: unknown }> },
  { type: "RECORD"; source: string; state: unknown } | { type: "CLEAR" }
>(
  { entries: [] },
  (state, msg) => {
    switch (msg.type) {
      case "RECORD":
        return {
          entries: [...state.entries, { ts: Date.now(), source: msg.source, state: msg.state }]
        };
      case "CLEAR":
        return { entries: [] };
      default:
        return state;
    }
  }
);

// Helper to wire up any actor to the historian
const track = <T>(name: string, actor: { subscribe: (fn: (s: T) => void) => void }) => {
  actor.subscribe((state) => historian.send({ type: "RECORD", source: name, state }));
};

// Domain actors
const cart = createStateActor({ items: [] }, (state, msg) => { /* ... */ });
const payment = createStateActor({ status: "idle" }, (state, msg) => { /* ... */ });

// Wire them up
track("cart", cart);
track("payment", payment);

// Also track FSM transitions
const checkoutFsm = createFsm({ /* ... */ });
checkoutFsm.subscribe(({ state }) => {
  historian.send({ type: "RECORD", source: "checkout-fsm", state });
});

// Now historian.getState().entries contains full system history:
// [
//   { ts: 1701234567890, source: "cart", state: { items: [] } },
//   { ts: 1701234567891, source: "payment", state: { status: "idle" } },
//   { ts: 1701234567892, source: "checkout-fsm", state: "IDLE" },
//   { ts: 1701234567900, source: "cart", state: { items: [{ sku: "A" }] } },
//   { ts: 1701234567901, source: "checkout-fsm", state: "RESERVING" },
//   ...
// ]
```

## License

MIT
