import { CONVENTIONS, MODEL, TOKEN_CAP, buildQuestions, parseAnswers, type Criterion, type Question } from '../../src/jev.js'

export type { Criterion, Question }
export type Answer = { id: string; pTrue: number }
export type Decisions = { answers: Answer[]; costUsd: number | null }
export type SonnetResult = Decisions | { error: string }

export const JEV_MODEL = MODEL
export const JEV_THRESHOLD: number | null = null
export const JEV_DIFF_CAP_TOKENS = TOKEN_CAP
export const SONNET_BASELINE_MODEL = 'anthropic/claude-sonnet-4.5'
export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'
export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

// `ac-<n>` and `conv-<key>` are the shadow workflow's ids; the bench keys rows by these instead.
export const rowId = (id: string): string | null => {
  const ac = /^(?:ac-|criterion:)(\d+)$/.exec(id)
  if (ac) return `criterion:${ac[1]}`
  const conv = /^(?:conv-|convention:)(.+)$/.exec(id)
  return conv ? `convention:${conv[1]}` : null
}

const renamed = (q: Question): Question => ({ ...q, id: rowId(q.id) ?? q.id })

export const criterionQuestions = (criteria: Criterion[]): Question[] => buildQuestions(criteria).slice(0, criteria.length).map(renamed)

export const CONVENTION_QUESTIONS: Question[] = CONVENTIONS.map(renamed)

export const decisionRequest = ({ diff, spec, questions }: { diff: string; spec: string; questions: Question[] }) => ({
  model: JEV_MODEL,
  state: { diff, spec },
  questions: Object.fromEntries(questions.map(({ id, type, question, criteria }) => [id, { type, instructions: question, criteria }])),
})

export const parseDecisions = (json: unknown): Decisions => {
  const { answers, cost } = parseAnswers(json)
  return {
    answers: answers.flatMap(({ id, probability }) => {
      const mapped = rowId(id)
      return mapped !== null && probability !== null ? [{ id: mapped, pTrue: probability }] : []
    }),
    costUsd: cost,
  }
}

export const sonnetRequest = ({ diff, spec, questions, model = SONNET_BASELINE_MODEL }: { diff: string; spec: string; questions: Question[]; model?: string }) => ({
  model,
  temperature: 0,
  usage: { include: true },
  messages: [
    {
      role: 'system',
      content:
        'You review a code diff against questions. For each question give p_true, the probability from 0 to 1 that the statement it asks about holds for the diff. Answer with JSON only: {"answers":[{"id":"<question id>","p_true":<number>}]}.',
    },
    {
      role: 'user',
      content: [
        `Spec:\n${spec}`,
        `Diff:\n${diff}`,
        'Questions:',
        ...questions.map((q) => `- ${q.id}: ${q.question}\n  true: ${q.criteria.true}\n  false: ${q.criteria.false}`),
      ].join('\n\n'),
    },
  ],
})

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const jsonIn = (text: string): unknown => {
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  if (from < 0 || to < from) return null
  try {
    return JSON.parse(text.slice(from, to + 1))
  } catch {
    return null
  }
}

export const parseSonnet = (json: unknown): SonnetResult => {
  const choices = isRecord(json) && Array.isArray(json.choices) ? json.choices : []
  const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {}
  const parsed = typeof message.content === 'string' ? jsonIn(message.content) : null
  if (!isRecord(parsed) || !Array.isArray(parsed.answers)) return { error: 'unparseable answer' }
  const costUsd = isRecord(json) && isRecord(json.usage) && typeof json.usage.cost === 'number' ? json.usage.cost : null
  return {
    answers: parsed.answers.flatMap((a) => {
      const id = isRecord(a) && typeof a.id === 'string' ? rowId(a.id) : null
      const p = isRecord(a) ? a.p_true : null
      return id !== null && typeof p === 'number' && p >= 0 && p <= 1 ? [{ id, pTrue: p }] : []
    }),
    costUsd,
  }
}
