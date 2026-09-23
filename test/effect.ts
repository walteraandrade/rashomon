import { Cause, Effect, Exit, Fiber, Option } from 'effect'
import { TestClock, TestConsole } from 'effect/testing'
import { FetchHttpClient, type HttpClient } from 'effect/unstable/http'
import { fetchClient } from '../src/http.js'

// Every request the collectors make goes through Effect's HttpClient, whose fetch-backed
// implementation reads `fetch` from a context reference: a test hands it a stub, and the
// collector never learns the difference. No network, no server, no source scanning.
export type Call = { url: URL; method: string; headers: Headers; body: string | null; signal: AbortSignal }

export type FakeFetch = typeof fetch & { calls: Call[] }

export const fakeFetch = (handler: (call: Call) => Response | Promise<Response>): FakeFetch => {
  const calls: Call[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: new URL(input instanceof Request ? input.url : input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : null,
      signal: init?.signal ?? new AbortController().signal,
    }
    calls.push(call)
    return handler(call)
  }) as FakeFetch
  fn.calls = calls
  return fn
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// A fetch that only ends when the caller gives up: the abort signal is the one way out.
export const hanging = (call: Call) =>
  new Promise<Response>((_, reject) => call.signal.addEventListener('abort', () => reject(new Error('aborted'))))

// A fetch that resolves immediately with headers, but whose body never delivers a chunk or
// closes -- until the caller gives up. Exercises the body-read stage separately from the
// headers stage `hanging` exercises.
export const hangingBody = (call: Call): Response => {
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      call.signal.addEventListener('abort', () => controller.error(new Error('aborted')))
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

// Runs an effect on the fake clock and the fake console, with the stub fetch wired in.
export const runTest = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>, fetchFn: FakeFetch): Promise<Exit.Exit<A, E>> =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(fetchClient),
      Effect.provideService(FetchHttpClient.Fetch, fetchFn),
      Effect.provide(TestClock.layer()),
      Effect.provide(TestConsole.layer),
    ),
  )

// Drives a forked effect to its end on the fake clock: every wall-clock pause the effect takes
// is skipped over, every promise it awaits gets a turn of the real event loop.
export const drain = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>, stepMs: number) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    const log: unknown[] = []
    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust(stepMs)
      yield* Effect.promise(() => new Promise<void>((r) => setImmediate(r)))
    }
    log.push(...(yield* TestConsole.logLines))
    const elapsedMs = yield* TestClock.testClockWith((c) => Effect.succeed(c.currentTimeMillisUnsafe()))
    return { exit: yield* Fiber.await(fiber), log: log.map(String), elapsedMs }
  })

export const failureOf = <A, E>(exit: Exit.Exit<A, E>): E => {
  const error = Exit.findErrorOption(exit)
  if (Option.isNone(error)) throw new Error('expected a typed failure, got ' + String(exit))
  return error.value
}

// Advances the fake clock by ms (0 for none) and lets one real macrotask turn run, so a fake
// fetch's pending native Promise -- and whatever the effect schedules right after it -- gets a
// chance to settle before the next assertion.
export const tick = (ms = 0) =>
  Effect.gen(function* () {
    if (ms > 0) yield* TestClock.adjust(ms)
    yield* Effect.promise(() => new Promise<void>((r) => setImmediate(r)))
  })

// Like runTest, but rethrows a failure or defect as the real exception it carries, so an
// assertion made inside the program itself (a retry-timing scenario stepping the clock by
// hand) surfaces with its own message and stack instead of an opaque Exit.
export const runProgram = async <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>, fetchFn: FakeFetch): Promise<A> => {
  const exit = await runTest(effect, fetchFn)
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
  return exit.value
}
