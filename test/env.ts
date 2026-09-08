// Save/restore around a block, so a suite whose outcome depends on an environment variable
// neither reads the developer's shell nor leaks its own value into the next test. `undefined`
// means "unset for the duration", which is not the same as "leave alone": every variable the
// expectation depends on has to be named, or a stray TESTIMONY_REVISION in the ambient
// environment silently moves the method label a test asserts.
export const withEnv = async (vars: Record<string, string | undefined>, run: () => void | Promise<void>) => {
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const previous = Object.keys(vars).map((k) => [k, process.env[k]] as const)
  Object.entries(vars).forEach(([k, v]) => set(k, v))
  try {
    await run()
  } finally {
    previous.forEach(([k, v]) => set(k, v))
  }
}
