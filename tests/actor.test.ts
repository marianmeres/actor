import { assertEquals, assertRejects } from "@std/assert";
import { createActor, createStateActor, type Actor } from "../src/actor.ts";

// ============================================================================
// Test Helpers - Counter Actor
// ============================================================================

type CounterMessage =
	| { type: "INCREMENT" }
	| { type: "DECREMENT" }
	| { type: "ADD"; payload: number }
	| { type: "RESET" };

function createCounter(initial: number = 0): Actor<number, CounterMessage, number> {
	return createStateActor<number, CounterMessage>(initial, (state, msg) => {
		switch (msg.type) {
			case "INCREMENT":
				return state + 1;
			case "DECREMENT":
				return state - 1;
			case "ADD":
				return state + msg.payload;
			case "RESET":
				return 0;
		}
	});
}

// ============================================================================
// Test Helpers - Form Actor
// ============================================================================

interface FieldState {
	value: string;
	error: string | null;
	touched: boolean;
}

interface FormState<T extends string = string> {
	fields: Record<T, FieldState>;
	isSubmitting: boolean;
	submitError: string | null;
}

type FormMessage<T extends string = string> =
	| { type: "SET_FIELD"; name: T; value: string }
	| { type: "TOUCH_FIELD"; name: T }
	| { type: "SUBMIT" }
	| { type: "SUBMIT_SUCCESS" }
	| { type: "SUBMIT_ERROR"; error: string }
	| { type: "RESET" };

type Validators<T extends string> = Partial<Record<T, (value: string) => string | null>>;

function createFormActor<T extends string>(
	fieldNames: T[],
	validators?: Validators<T>
): Actor<FormState<T>, FormMessage<T>, FormState<T>> {
	const initialFields = {} as Record<T, FieldState>;
	for (const name of fieldNames) {
		initialFields[name] = { value: "", error: null, touched: false };
	}

	const initialState: FormState<T> = {
		fields: initialFields,
		isSubmitting: false,
		submitError: null,
	};

	return createStateActor<FormState<T>, FormMessage<T>>(initialState, (state, msg) => {
		switch (msg.type) {
			case "SET_FIELD": {
				const validator = validators?.[msg.name];
				const error = validator ? validator(msg.value) : null;
				return {
					...state,
					fields: {
						...state.fields,
						[msg.name]: {
							...state.fields[msg.name],
							value: msg.value,
							error,
						},
					},
				};
			}
			case "TOUCH_FIELD":
				return {
					...state,
					fields: {
						...state.fields,
						[msg.name]: {
							...state.fields[msg.name],
							touched: true,
						},
					},
				};
			case "SUBMIT":
				return { ...state, isSubmitting: true, submitError: null };
			case "SUBMIT_SUCCESS":
				return { ...state, isSubmitting: false };
			case "SUBMIT_ERROR":
				return { ...state, isSubmitting: false, submitError: msg.error };
			case "RESET":
				return initialState;
		}
	});
}

// ============================================================================
// Core Actor Tests
// ============================================================================

Deno.test("createActor - processes messages and returns responses", async () => {
	const actor = createActor<number, { type: "ADD"; value: number }, number>({
		initialState: 0,
		handler: (state, msg) => state + msg.value,
		reducer: (_, response) => response,
	});

	const result = await actor.send({ type: "ADD", value: 5 });
	assertEquals(result, 5);
	assertEquals(actor.getState(), 5);
});

Deno.test("createActor - processes messages in order (FIFO)", async () => {
	const order: number[] = [];

	const actor = createActor<null, number, void>({
		initialState: null,
		handler: async (_, msg) => {
			await new Promise((r) => setTimeout(r, 10 - msg)); // Shorter delay for higher numbers
			order.push(msg);
		},
	});

	await Promise.all([actor.send(1), actor.send(2), actor.send(3)]);
	assertEquals(order, [1, 2, 3]);
});

Deno.test("createActor - handles async handlers", async () => {
	const actor = createActor<string, string, string>({
		initialState: "",
		handler: async (state, msg) => {
			await new Promise((r) => setTimeout(r, 10));
			return state + msg;
		},
		reducer: (_, response) => response,
	});

	await actor.send("hello");
	await actor.send(" world");

	assertEquals(actor.getState(), "hello world");
});

// ============================================================================
// Subscription Tests
// ============================================================================

Deno.test("subscriptions - notifies subscribers of state changes", async () => {
	const actor = createStateActor<number, { delta: number }>(
		0,
		(state, msg) => state + msg.delta
	);

	const states: number[] = [];
	actor.subscribe((state) => states.push(state));

	await actor.send({ delta: 1 });
	await actor.send({ delta: 2 });
	await actor.send({ delta: 3 });

	// Initial state + 3 updates
	assertEquals(states, [0, 1, 3, 6]);
});

Deno.test("subscriptions - emits current state immediately on subscribe", () => {
	const actor = createStateActor<number, never>(42, (s) => s);

	let received: number | null = null;
	actor.subscribe((state) => {
		received = state;
	});

	assertEquals(received, 42);
});

Deno.test("subscriptions - allows unsubscribing", async () => {
	const actor = createStateActor<number, number>(0, (_, msg) => msg);

	const states: number[] = [];
	const unsubscribe = actor.subscribe((state) => states.push(state));

	await actor.send(1);
	unsubscribe();
	await actor.send(2);

	assertEquals(states, [0, 1]); // Didn't receive 2
});

Deno.test("subscriptions - handles subscriber errors gracefully", async () => {
	const originalError = console.error;
	let errorCalled = false;
	console.error = () => {
		errorCalled = true;
	};

	const actor = createStateActor<number, number>(0, (_, msg) => msg);

	actor.subscribe(() => {
		throw new Error("Subscriber error");
	});

	// Should not throw
	const result = await actor.send(1);
	assertEquals(result, 1);
	assertEquals(errorCalled, true);

	console.error = originalError;
});

Deno.test("subscriptions - does not notify when state reference unchanged", async () => {
	const actor = createActor<{ count: number }, string, void>({
		initialState: { count: 0 },
		handler: () => {}, // Does nothing, state unchanged
		reducer: (state) => state, // Returns same reference
	});

	const calls: number[] = [];
	actor.subscribe((state) => calls.push(state.count));

	await actor.send("noop");
	await actor.send("noop");

	// Only initial subscription call
	assertEquals(calls, [0]);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("error handling - rejects promise when handler throws", async () => {
	const actor = createActor<null, string, void>({
		initialState: null,
		handler: () => {
			throw new Error("Handler error");
		},
	});

	await assertRejects(() => actor.send("test"), Error, "Handler error");
});

Deno.test("error handling - calls onError callback when handler throws", async () => {
	let errorReceived: Error | null = null;
	let messageReceived: string | null = null;

	const actor = createActor<null, string, void>({
		initialState: null,
		handler: () => {
			throw new Error("Oops");
		},
		onError: (error, message) => {
			errorReceived = error;
			messageReceived = message;
		},
	});

	await assertRejects(() => actor.send("test"), Error);
	assertEquals(errorReceived !== null, true);
	assertEquals(messageReceived, "test");
});

Deno.test("error handling - continues processing after error", async () => {
	let callCount = 0;

	const actor = createActor<number, "fail" | "succeed", number>({
		initialState: 0,
		handler: (state, msg) => {
			callCount++;
			if (msg === "fail") throw new Error("Failed");
			return state + 1;
		},
		reducer: (_, response) => response,
	});

	await assertRejects(() => actor.send("fail"), Error);
	const result = await actor.send("succeed");
	assertEquals(result, 1);
	assertEquals(callCount, 2);
});

// ============================================================================
// Destroy Tests
// ============================================================================

Deno.test("destroy - rejects new messages after destroy", async () => {
	const actor = createStateActor<number, number>(0, (_, msg) => msg);

	actor.destroy();

	await assertRejects(() => actor.send(1), Error, "Actor has been destroyed");
});

Deno.test("destroy - clears subscribers on destroy", () => {
	const actor = createStateActor<number, number>(0, (_, msg) => msg);

	let callCount = 0;
	actor.subscribe(() => {
		callCount++;
	});

	// Reset to ignore initial emit
	callCount = 0;

	actor.destroy();

	// Verify state is still accessible
	assertEquals(actor.getState(), 0);
	// Subscriber was cleared (callCount not incremented during destroy)
	assertEquals(callCount, 0);
});

// ============================================================================
// Counter Example Tests
// ============================================================================

Deno.test("Counter Actor - increments and decrements", async () => {
	const counter = createCounter(0);

	await counter.send({ type: "INCREMENT" });
	assertEquals(counter.getState(), 1);

	await counter.send({ type: "INCREMENT" });
	await counter.send({ type: "INCREMENT" });
	assertEquals(counter.getState(), 3);

	await counter.send({ type: "DECREMENT" });
	assertEquals(counter.getState(), 2);
});

Deno.test("Counter Actor - adds arbitrary values", async () => {
	const counter = createCounter(10);

	await counter.send({ type: "ADD", payload: 5 });
	assertEquals(counter.getState(), 15);

	await counter.send({ type: "ADD", payload: -20 });
	assertEquals(counter.getState(), -5);
});

Deno.test("Counter Actor - resets to zero", async () => {
	const counter = createCounter(100);

	await counter.send({ type: "RESET" });
	assertEquals(counter.getState(), 0);
});

Deno.test("Counter Actor - works with subscriptions for reactive updates", async () => {
	const counter = createCounter(0);
	const values: number[] = [];

	counter.subscribe((count) => values.push(count));

	await counter.send({ type: "INCREMENT" });
	await counter.send({ type: "INCREMENT" });
	await counter.send({ type: "ADD", payload: 10 });

	assertEquals(values, [0, 1, 2, 12]);
});

// ============================================================================
// Form Actor Tests
// ============================================================================

Deno.test("Form Actor - initializes with empty fields", () => {
	const form = createFormActor(["email", "password"]);
	const state = form.getState();

	assertEquals(state.fields.email, {
		value: "",
		error: null,
		touched: false,
	});
	assertEquals(state.fields.password, {
		value: "",
		error: null,
		touched: false,
	});
	assertEquals(state.isSubmitting, false);
});

Deno.test("Form Actor - updates field values", async () => {
	const form = createFormActor(["email", "password"]);

	await form.send({
		type: "SET_FIELD",
		name: "email",
		value: "test@example.com",
	});

	assertEquals(form.getState().fields.email.value, "test@example.com");
});

Deno.test("Form Actor - validates fields with validators", async () => {
	const validators = {
		email: (value: string) => {
			if (!value) return "Email is required";
			if (!value.includes("@")) return "Invalid email";
			return null;
		},
		password: (value: string) => {
			if (!value) return "Password is required";
			if (value.length < 8) return "Password must be at least 8 characters";
			return null;
		},
	};

	const form = createFormActor(["email", "password"], validators);

	await form.send({ type: "SET_FIELD", name: "email", value: "invalid" });
	assertEquals(form.getState().fields.email.error, "Invalid email");

	await form.send({
		type: "SET_FIELD",
		name: "email",
		value: "valid@test.com",
	});
	assertEquals(form.getState().fields.email.error, null);
});

Deno.test("Form Actor - tracks touched state", async () => {
	const form = createFormActor(["email"]);

	assertEquals(form.getState().fields.email.touched, false);

	await form.send({ type: "TOUCH_FIELD", name: "email" });

	assertEquals(form.getState().fields.email.touched, true);
});

Deno.test("Form Actor - handles submit lifecycle", async () => {
	const form = createFormActor(["email"]);
	const states: boolean[] = [];

	form.subscribe((state) => states.push(state.isSubmitting));

	await form.send({ type: "SUBMIT" });
	assertEquals(form.getState().isSubmitting, true);

	await form.send({ type: "SUBMIT_SUCCESS" });
	assertEquals(form.getState().isSubmitting, false);
});

Deno.test("Form Actor - handles submit errors", async () => {
	const form = createFormActor(["email"]);

	await form.send({ type: "SUBMIT" });
	await form.send({ type: "SUBMIT_ERROR", error: "Network error" });

	const state = form.getState();
	assertEquals(state.isSubmitting, false);
	assertEquals(state.submitError, "Network error");
});

Deno.test("Form Actor - resets form state", async () => {
	const form = createFormActor(["email", "password"]);

	await form.send({
		type: "SET_FIELD",
		name: "email",
		value: "test@test.com",
	});
	await form.send({ type: "TOUCH_FIELD", name: "email" });
	await form.send({ type: "SUBMIT" });
	await form.send({ type: "SUBMIT_ERROR", error: "Failed" });

	await form.send({ type: "RESET" });

	const state = form.getState();
	assertEquals(state.fields.email, {
		value: "",
		error: null,
		touched: false,
	});
	assertEquals(state.isSubmitting, false);
	assertEquals(state.submitError, null);
});

// ============================================================================
// Concurrency Tests
// ============================================================================

Deno.test("Concurrency - serializes concurrent sends", async () => {
	const events: string[] = [];

	const actor = createActor<null, string, void>({
		initialState: null,
		handler: async (_, msg) => {
			events.push(`start:${msg}`);
			await new Promise((r) => setTimeout(r, 10));
			events.push(`end:${msg}`);
		},
	});

	await Promise.all([actor.send("A"), actor.send("B"), actor.send("C")]);

	assertEquals(events, [
		"start:A",
		"end:A",
		"start:B",
		"end:B",
		"start:C",
		"end:C",
	]);
});

Deno.test("Concurrency - maintains state consistency under rapid updates", async () => {
	const counter = createCounter(0);

	const promises = Array.from({ length: 100 }, () =>
		counter.send({ type: "INCREMENT" })
	);

	await Promise.all(promises);

	assertEquals(counter.getState(), 100);
});
