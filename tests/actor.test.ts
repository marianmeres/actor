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

function createCounter(
	initial: number = 0
): Actor<number, CounterMessage, number> {
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

type Validators<T extends string> = Partial<
	Record<T, (value: string) => string | null>
>;

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

	return createStateActor<FormState<T>, FormMessage<T>>(
		initialState,
		(state, msg) => {
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
					return {
						...state,
						isSubmitting: false,
						submitError: msg.error,
					};
				case "RESET":
					return initialState;
			}
		}
	);
}

// ============================================================================
// Core Actor Tests
// ============================================================================

Deno.test("Core Actor", async (t) => {
	await t.step("processes messages and returns responses", async () => {
		const actor = createActor<
			number,
			{ type: "ADD"; value: number },
			number
		>({
			initialState: 0,
			handler: (state, msg) => state + msg.value,
			reducer: (_, response) => response,
		});

		const result = await actor.send({ type: "ADD", value: 5 });
		assertEquals(result, 5);
		assertEquals(actor.getState(), 5);
	});

	await t.step("processes messages in order (FIFO)", async () => {
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

	await t.step("handles async handlers", async () => {
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
});

// ============================================================================
// Subscription Tests
// ============================================================================

Deno.test("Subscriptions", async (t) => {
	await t.step("notifies subscribers of state changes", async () => {
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

	await t.step("emits current state immediately on subscribe", () => {
		const actor = createStateActor<number, never>(42, (s) => s);

		let received: number | null = null;
		actor.subscribe((state) => {
			received = state;
		});

		assertEquals(received, 42);
	});

	await t.step("allows unsubscribing", async () => {
		const actor = createStateActor<number, number>(0, (_, msg) => msg);

		const states: number[] = [];
		const unsubscribe = actor.subscribe((state) => states.push(state));

		await actor.send(1);
		unsubscribe();
		await actor.send(2);

		assertEquals(states, [0, 1]); // Didn't receive 2
	});

	await t.step("handles subscriber errors gracefully", async () => {
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

	await t.step("does not notify when state reference unchanged", async () => {
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
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("Error Handling", async (t) => {
	await t.step("rejects promise when handler throws", async () => {
		const actor = createActor<null, string, void>({
			initialState: null,
			handler: () => {
				throw new Error("Handler error");
			},
		});

		await assertRejects(() => actor.send("test"), Error, "Handler error");
	});

	await t.step("calls onError callback when handler throws", async () => {
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

	await t.step("continues processing after error", async () => {
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
});

// ============================================================================
// Destroy Tests
// ============================================================================

Deno.test("Destroy", async (t) => {
	await t.step("rejects new messages after destroy", async () => {
		const actor = createStateActor<number, number>(0, (_, msg) => msg);

		actor.destroy();

		await assertRejects(
			() => actor.send(1),
			Error,
			"Actor has been destroyed"
		);
	});

	await t.step("clears subscribers on destroy", () => {
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
});

// ============================================================================
// Counter Example Tests
// ============================================================================

Deno.test("Counter Actor", async (t) => {
	await t.step("increments and decrements", async () => {
		const counter = createCounter(0);

		await counter.send({ type: "INCREMENT" });
		assertEquals(counter.getState(), 1);

		await counter.send({ type: "INCREMENT" });
		await counter.send({ type: "INCREMENT" });
		assertEquals(counter.getState(), 3);

		await counter.send({ type: "DECREMENT" });
		assertEquals(counter.getState(), 2);
	});

	await t.step("adds arbitrary values", async () => {
		const counter = createCounter(10);

		await counter.send({ type: "ADD", payload: 5 });
		assertEquals(counter.getState(), 15);

		await counter.send({ type: "ADD", payload: -20 });
		assertEquals(counter.getState(), -5);
	});

	await t.step("resets to zero", async () => {
		const counter = createCounter(100);

		await counter.send({ type: "RESET" });
		assertEquals(counter.getState(), 0);
	});

	await t.step("works with subscriptions for reactive updates", async () => {
		const counter = createCounter(0);
		const values: number[] = [];

		counter.subscribe((count) => values.push(count));

		await counter.send({ type: "INCREMENT" });
		await counter.send({ type: "INCREMENT" });
		await counter.send({ type: "ADD", payload: 10 });

		assertEquals(values, [0, 1, 2, 12]);
	});
});

// ============================================================================
// Form Actor Tests
// ============================================================================

Deno.test("Form Actor", async (t) => {
	await t.step("initializes with empty fields", () => {
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

	await t.step("updates field values", async () => {
		const form = createFormActor(["email", "password"]);

		await form.send({
			type: "SET_FIELD",
			name: "email",
			value: "test@example.com",
		});

		assertEquals(form.getState().fields.email.value, "test@example.com");
	});

	await t.step("validates fields with validators", async () => {
		const validators = {
			email: (value: string) => {
				if (!value) return "Email is required";
				if (!value.includes("@")) return "Invalid email";
				return null;
			},
			password: (value: string) => {
				if (!value) return "Password is required";
				if (value.length < 8)
					return "Password must be at least 8 characters";
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

	await t.step("tracks touched state", async () => {
		const form = createFormActor(["email"]);

		assertEquals(form.getState().fields.email.touched, false);

		await form.send({ type: "TOUCH_FIELD", name: "email" });

		assertEquals(form.getState().fields.email.touched, true);
	});

	await t.step("handles submit lifecycle", async () => {
		const form = createFormActor(["email"]);
		const states: boolean[] = [];

		form.subscribe((state) => states.push(state.isSubmitting));

		await form.send({ type: "SUBMIT" });
		assertEquals(form.getState().isSubmitting, true);

		await form.send({ type: "SUBMIT_SUCCESS" });
		assertEquals(form.getState().isSubmitting, false);
	});

	await t.step("handles submit errors", async () => {
		const form = createFormActor(["email"]);

		await form.send({ type: "SUBMIT" });
		await form.send({ type: "SUBMIT_ERROR", error: "Network error" });

		const state = form.getState();
		assertEquals(state.isSubmitting, false);
		assertEquals(state.submitError, "Network error");
	});

	await t.step("resets form state", async () => {
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
});

// ============================================================================
// Concurrency Tests
// ============================================================================

Deno.test("Concurrency", async (t) => {
	await t.step("serializes concurrent sends", async () => {
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

	await t.step(
		"maintains state consistency under rapid updates",
		async () => {
			const counter = createCounter(0);

			const promises = Array.from({ length: 100 }, () =>
				counter.send({ type: "INCREMENT" })
			);

			await Promise.all(promises);

			assertEquals(counter.getState(), 100);
		}
	);
});

// ============================================================================
// DTOKit Integration Tests
// ============================================================================

import {
	createTypedStateActor,
	createTypedActor,
	createMessageFactory,
	type ExhaustiveHandlers,
	type MessageSchemas,
} from "../src/with-dtokit.ts";

// Test schemas for typed actors
type CounterSchemas = {
	INC: { type: "INC" };
	DEC: { type: "DEC" };
	ADD: { type: "ADD"; amount: number };
	RESET: { type: "RESET" };
};

Deno.test("createTypedStateActor", async (t) => {
	await t.step("basic message handling", async () => {
		const counter = createTypedStateActor<CounterSchemas, number>(0, {
			INC: (_, state) => state + 1,
			DEC: (_, state) => state - 1,
			ADD: (msg, state) => state + msg.amount,
			RESET: () => 0,
		});

		await counter.send({ type: "INC" });
		assertEquals(counter.getState(), 1);

		await counter.send({ type: "ADD", amount: 10 });
		assertEquals(counter.getState(), 11);

		await counter.send({ type: "DEC" });
		assertEquals(counter.getState(), 10);

		await counter.send({ type: "RESET" });
		assertEquals(counter.getState(), 0);
	});

	await t.step("async handlers", async () => {
		type AsyncSchemas = {
			FETCH: { type: "FETCH"; delay: number };
			SET: { type: "SET"; value: string };
		};

		const actor = createTypedStateActor<AsyncSchemas, string>("initial", {
			FETCH: async (msg, _state) => {
				await new Promise((r) => setTimeout(r, msg.delay));
				return "fetched";
			},
			SET: (msg, _state) => msg.value,
		});

		await actor.send({ type: "FETCH", delay: 5 });
		assertEquals(actor.getState(), "fetched");

		await actor.send({ type: "SET", value: "custom" });
		assertEquals(actor.getState(), "custom");
	});

	await t.step("subscriptions work", async () => {
		const counter = createTypedStateActor<CounterSchemas, number>(0, {
			INC: (_, state) => state + 1,
			DEC: (_, state) => state - 1,
			ADD: (msg, state) => state + msg.amount,
			RESET: () => 0,
		});

		const values: number[] = [];
		counter.subscribe((state) => values.push(state));

		await counter.send({ type: "INC" });
		await counter.send({ type: "INC" });
		await counter.send({ type: "ADD", amount: 5 });

		assertEquals(values, [0, 1, 2, 7]);
	});

	await t.step("each handler receives correctly typed message", async () => {
		type TestSchemas = {
			STRING_MSG: { type: "STRING_MSG"; text: string };
			NUMBER_MSG: { type: "NUMBER_MSG"; value: number };
			COMPLEX_MSG: { type: "COMPLEX_MSG"; data: { nested: boolean } };
		};

		const results: string[] = [];

		const actor = createTypedStateActor<TestSchemas, null>(null, {
			STRING_MSG: (msg, state) => {
				// msg.text is typed as string
				results.push(`string: ${msg.text}`);
				return state;
			},
			NUMBER_MSG: (msg, state) => {
				// msg.value is typed as number
				results.push(`number: ${msg.value}`);
				return state;
			},
			COMPLEX_MSG: (msg, state) => {
				// msg.data.nested is typed as boolean
				results.push(`complex: ${msg.data.nested}`);
				return state;
			},
		});

		await actor.send({ type: "STRING_MSG", text: "hello" });
		await actor.send({ type: "NUMBER_MSG", value: 42 });
		await actor.send({ type: "COMPLEX_MSG", data: { nested: true } });

		assertEquals(results, ["string: hello", "number: 42", "complex: true"]);
	});

	await t.step("FIFO message ordering preserved", async () => {
		type OrderSchemas = {
			APPEND: { type: "APPEND"; value: string };
		};

		const actor = createTypedStateActor<OrderSchemas, string[]>([], {
			APPEND: async (msg, state) => {
				await new Promise((r) => setTimeout(r, Math.random() * 10));
				return [...state, msg.value];
			},
		});

		await Promise.all([
			actor.send({ type: "APPEND", value: "A" }),
			actor.send({ type: "APPEND", value: "B" }),
			actor.send({ type: "APPEND", value: "C" }),
		]);

		assertEquals(actor.getState(), ["A", "B", "C"]);
	});

	await t.step("destroy works", async () => {
		const counter = createTypedStateActor<CounterSchemas, number>(0, {
			INC: (_, state) => state + 1,
			DEC: (_, state) => state - 1,
			ADD: (msg, state) => state + msg.amount,
			RESET: () => 0,
		});

		await counter.send({ type: "INC" });
		counter.destroy();

		await assertRejects(
			() => counter.send({ type: "INC" }),
			Error,
			"Actor has been destroyed"
		);
		assertEquals(counter.getState(), 1); // State still accessible
	});

	await t.step("exhaustiveness enforced (compile-time)", () => {
		// This test verifies the types work correctly
		// The actual exhaustiveness check is at compile time

		type TestSchemas = {
			A: { type: "A" };
			B: { type: "B" };
		};

		// Complete handlers - this compiles
		const _handlers: ExhaustiveHandlers<TestSchemas, number, number> = {
			A: (_, state) => state + 1,
			B: (_, state) => state - 1,
		};

		// Incomplete handlers would cause compile error:
		// const _incomplete: ExhaustiveHandlers<TestSchemas, number, number> = {
		//   A: (_, state) => state + 1,
		//   // Missing B - TypeScript error!
		// };
	});
});

Deno.test("createTypedActor", async (t) => {
	await t.step("with reducer for rich responses", async () => {
		type ProcessSchemas = {
			PROCESS: { type: "PROCESS"; input: string };
			CLEAR: { type: "CLEAR" };
		};

		type State = { lastResult: string | null; processCount: number };
		type Response = { output: string; timestamp: number };

		const actor = createTypedActor<ProcessSchemas, State, Response>({
			initialState: { lastResult: null, processCount: 0 },
			handlers: {
				PROCESS: (msg, _state) => ({
					output: msg.input.toUpperCase(),
					timestamp: Date.now(),
				}),
				CLEAR: () => ({
					output: "",
					timestamp: 0,
				}),
			},
			reducer: (state, response) => ({
				lastResult: response.output,
				processCount: state.processCount + 1,
			}),
		});

		const response = await actor.send({ type: "PROCESS", input: "hello" });
		assertEquals(response.output, "HELLO");
		assertEquals(typeof response.timestamp, "number");

		const state = actor.getState();
		assertEquals(state.lastResult, "HELLO");
		assertEquals(state.processCount, 1);
	});

	await t.step("onError callback", async () => {
		type ErrorSchemas = {
			FAIL: { type: "FAIL" };
			OK: { type: "OK" };
		};

		const errors: { error: Error; message: unknown }[] = [];

		const actor = createTypedActor<ErrorSchemas, null, null>({
			initialState: null,
			handlers: {
				FAIL: () => {
					throw new Error("Intentional failure");
				},
				OK: () => null,
			},
			onError: (error, message) => {
				errors.push({ error, message });
			},
		});

		await assertRejects(
			() => actor.send({ type: "FAIL" }),
			Error,
			"Intentional failure"
		);
		assertEquals(errors.length, 1);
		assertEquals(errors[0].error.message, "Intentional failure");
		assertEquals((errors[0].message as { type: string }).type, "FAIL");
	});
});

Deno.test("createMessageFactory", async (t) => {
	await t.step("validates message structure", () => {
		const factory = createMessageFactory<CounterSchemas>();

		// Valid messages - have discriminator field
		const inc = factory.parse({ type: "INC" });
		assertEquals(inc?.type, "INC");

		const add = factory.parse({ type: "ADD", amount: 5 });
		assertEquals(add?.type, "ADD");

		// Note: dtokit validates discriminator field exists, not that it's a known value
		// This is by design - minimal runtime validation
		const hasType = factory.parse({ type: "UNKNOWN" });
		assertEquals(hasType?.type, "UNKNOWN"); // Passes because "type" field exists

		// Invalid - missing discriminator field
		const noType = factory.parse({ foo: "bar" });
		assertEquals(noType, null);

		// Invalid - not an object
		const notObject = factory.parse("string");
		assertEquals(notObject, null);

		const nullValue = factory.parse(null);
		assertEquals(nullValue, null);
	});

	await t.step("isValid check", () => {
		const factory = createMessageFactory<CounterSchemas>();

		// isValid checks that discriminator field exists and is non-empty string
		assertEquals(factory.isValid({ type: "INC" }), true);
		assertEquals(factory.isValid({ type: "ADD", amount: 5 }), true);
		assertEquals(factory.isValid({ type: "UNKNOWN" }), true); // Has valid "type" field
		assertEquals(factory.isValid({ type: "" }), false); // Empty string discriminator
		assertEquals(factory.isValid({ foo: "bar" }), false); // Missing "type" field
		assertEquals(factory.isValid(null), false);
	});

	await t.step("getId extracts discriminator", () => {
		const factory = createMessageFactory<CounterSchemas>();

		const msg = factory.parse({ type: "DEC" });
		if (msg) {
			const id = factory.getId(msg);
			assertEquals(id, "DEC");
		}
	});
});
