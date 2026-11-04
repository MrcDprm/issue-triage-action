import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeGitHub } from './fake-github.js'

// main.ts'in GitHub Actions'a bağlandığı yer: hangi hatada iş kırmızı biter, hangisinde uyarıyla geçer.
const state = vi.hoisted(() => ({
  inputs: {} as Record<string, string>,
  outputs: {} as Record<string, string>,
  failed: [] as string[],
  warnings: [] as string[],
  secrets: [] as string[],
  github: undefined as unknown,
  payload: {} as unknown,
}))

vi.mock('@actions/core', () => ({
  getInput: (name: string) => state.inputs[name] ?? '',
  setSecret: (value: string) => state.secrets.push(value),
  setOutput: (name: string, value: string) => (state.outputs[name] = value),
  setFailed: (message: string) => state.failed.push(message),
  warning: (message: string) => state.warnings.push(message),
  info: () => undefined,
}))

vi.mock('@actions/github', () => ({
  context: {
    eventName: 'issues',
    repo: { owner: 'o', repo: 'r' },
    get payload() {
      return state.payload
    },
  },
  getOctokit: () => state.github,
}))

const { run } = await import('../src/main.js')

const answer = JSON.stringify({ type: 'bug', priority: 'P1', priority_reason: 'r', labels: [], missing: [], language: 'en', duplicates: [3] })
const chatReply = () => new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 })
const embedReply = (count: number) => new Response(JSON.stringify({ data: Array.from({ length: count }, (_, index) => ({ index, embedding: [1, 0] })) }), { status: 200 })

/** URL'ye göre cevap veren sahte fetch; sohbet cevabı testten teste değişir. */
function stubFetch(chat: () => Response) {
  const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
    if (String(url).endsWith('/embeddings')) return embedReply((JSON.parse(String(init.body)) as { input: string[] }).input.length)
    return chat()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  state.inputs = {
    'api-key': 'secret-key',
    'base-url': 'https://llm.example/v1/',
    model: 'm',
    'embedding-model': 'e',
    'github-token': 't',
    'max-candidates': '5',
    'similarity-threshold': '0.75',
    'dry-run': 'false',
  }
  state.outputs = {}
  state.failed = []
  state.warnings = []
  state.secrets = []
  state.github = fakeGitHub().octokit
  state.payload = { action: 'opened', issue: { number: 7, title: 'Crash', body: 'x', state: 'open', user: { login: 'a', type: 'User' }, labels: [] } }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('run', () => {
  it('masks the key and sets the outputs', async () => {
    stubFetch(chatReply)
    await run()
    expect(state.secrets).toEqual(['secret-key'])
    expect(state.failed).toEqual([])
    expect(state.outputs).toEqual({ type: 'bug', priority: 'P1', labels: 'bug,P1', duplicates: '3' })
  })

  it('passes with a warning when the provider keeps answering 429', async () => {
    // Retry-After: 0, testin beklemeden bitmesi için; üç denemeden sonra vazgeçer.
    const fetchMock = stubFetch(() => new Response('quota', { status: 429, headers: { 'retry-after': '0' } }))
    await run()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))).toHaveLength(3)
    expect(state.failed).toEqual([])
    expect(state.warnings.at(-1)).toMatch(/^LLM request failed: chat\/completions: HTTP 429/)
    expect(state.outputs).toEqual({})
  })

  it('passes with a warning on a server error', async () => {
    stubFetch(() => new Response('', { status: 503, headers: { 'retry-after': '0' } }))
    await run()
    expect(state.failed).toEqual([])
    expect(state.warnings.at(-1)).toContain('HTTP 503')
  })

  it('fails with a clear message for a wrong input, before any request', async () => {
    const fetchMock = stubFetch(chatReply)
    state.inputs['similarity-threshold'] = '75'
    await run()
    expect(state.failed).toEqual(['similarity-threshold must be a number from 0 to 1, got "75"'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails with a permission hint when GitHub answers 403', async () => {
    stubFetch(chatReply)
    state.github = fakeGitHub({ fail: { createComment: 403 } }).octokit
    await run()
    expect(state.failed[0]).toContain('permissions: issues: write')
  })

  it('sets no outputs for a skipped event', async () => {
    const fetchMock = stubFetch(chatReply)
    state.payload = { action: 'labeled', issue: { number: 7, title: 'x', state: 'open', labels: [] } }
    await run()
    expect(state.outputs).toEqual({})
    expect(state.failed).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when the provider rejects the key, without showing the key', async () => {
    // Gemini geçersiz anahtarda 400 döner; uyarıyla geçseydi bakımcı Action'ın hiç çalışmadığını fark etmezdi.
    stubFetch(() => new Response('API key not valid: secret-key', { status: 400 }))
    await run()
    expect(state.failed).toHaveLength(1)
    expect(state.failed[0]).toContain('HTTP 400')
    expect(state.failed[0]).not.toContain('permissions')
    expect([...state.failed, ...state.warnings].join('\n')).not.toContain('secret-key')
  })
})
