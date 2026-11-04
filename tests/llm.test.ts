import { describe, expect, it } from 'vitest'
import { backoff, ConfigError, createLlmClient, parseBaseUrl, type LlmConfig } from '../src/llm.js'

const KEY = 'sk-test-secret-123'

type Reply = Response | Error

/** Sırayla verilen cevapları dönen sahte fetch; gönderilen istekleri kaydeder. */
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const reply = replies.shift()
    if (!reply) throw new Error('no more replies')
    if (reply instanceof Error) throw reply
    return reply
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function client(replies: Reply[], overrides: Partial<LlmConfig> = {}) {
  const fake = fakeFetch(replies)
  const waits: number[] = []
  const llm = createLlmClient({
    baseUrl: 'https://llm.example/v1beta/openai/',
    apiKey: KEY,
    model: 'chat-model',
    embeddingModel: 'embed-model',
    fetch: fake.fetch,
    sleep: async (ms) => void waits.push(ms),
    ...overrides,
  })
  return { llm, calls: fake.calls, waits }
}

const schema = { name: 'triage', schema: { type: 'object' } }
const chatOk = () => json({ choices: [{ message: { content: '{"type":"bug"}' } }] })

describe('parseBaseUrl', () => {
  it('adds the trailing slash so paths are joined under it', () => {
    expect(new URL('chat/completions', parseBaseUrl('https://a.example/v1')).href).toBe('https://a.example/v1/chat/completions')
  })

  it('refuses plain http to another machine, which would send the key in clear text', () => {
    expect(() => parseBaseUrl('http://a.example/v1/')).toThrow(ConfigError)
  })

  it('allows http to this machine (Ollama)', () => {
    expect(parseBaseUrl('http://localhost:11434/v1').href).toBe('http://localhost:11434/v1/')
  })

  it('refuses something that is not a URL', () => {
    expect(() => parseBaseUrl('not a url')).toThrow('base-url is not a valid URL')
  })
})

describe('chatJson', () => {
  it('sends the model, the messages and the schema with the key as a bearer token', async () => {
    const { llm, calls } = client([chatOk()])
    expect(await llm.chatJson([{ role: 'user', content: 'hi' }], schema)).toBe('{"type":"bug"}')
    expect(calls[0]?.url).toBe('https://llm.example/v1beta/openai/chat/completions')
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(String(calls[0]?.init.body))
    expect(body).toMatchObject({ model: 'chat-model', temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'triage', strict: true } } })
  })

  it('retries a 429 after the time the provider asks for', async () => {
    const { llm, waits } = client([json({}, 429, { 'Retry-After': '3' }), chatOk()])
    expect(await llm.chatJson([], schema)).toBe('{"type":"bug"}')
    expect(waits).toEqual([3000])
  })

  it('retries server errors and network errors, then gives up', async () => {
    const { llm, calls, waits } = client([json({}, 503), new TypeError('fetch failed'), json({}, 500)])
    await expect(llm.chatJson([], schema)).rejects.toThrow('HTTP 500')
    expect(calls).toHaveLength(3)
    expect(waits).toEqual([1000, 2000])
  })

  it('does not retry a request the provider rejects and reports it as a config error', async () => {
    for (const status of [400, 401, 403, 404]) {
      const { llm, calls } = client([json({ error: 'bad model' }, status)])
      const error = await llm.chatJson([], schema).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as Error).message).toContain(`HTTP ${status}`)
      expect((error as Error).message).toContain('check api-key, base-url and model')
      expect(calls).toHaveLength(1)
    }
  })

  it('keeps 429 and 408 as passing provider errors after the last retry', async () => {
    for (const status of [408, 429]) {
      const { llm } = client([json({}, status), json({}, status), json({}, status)])
      await expect(llm.chatJson([], schema)).rejects.toMatchObject({ name: 'LlmError', status })
    }
  })

  it('keeps a server error that does not pass as a provider error', async () => {
    const { llm } = client([json({}, 501)])
    await expect(llm.chatJson([], schema)).rejects.toMatchObject({ name: 'LlmError', status: 501 })
  })

  it('never puts the key into an error message, even if the provider echoes it', async () => {
    const { llm } = client([json({ error: `invalid key ${KEY}` }, 401)])
    const error = await llm.chatJson([], schema).then(
      () => new Error('expected a failure'),
      (e: unknown) => e as Error,
    )
    expect(error.message).toContain('HTTP 401')
    expect(error.message).not.toContain(KEY)
  })

  it('rejects an answer without a message', async () => {
    const { llm } = client([json({ choices: [] })])
    await expect(llm.chatJson([], schema)).rejects.toThrow('has no message')
  })

  it('rejects an answer that is not JSON', async () => {
    const { llm } = client([new Response('<html>', { status: 200 })])
    await expect(llm.chatJson([], schema)).rejects.toThrow('not JSON')
  })
})

describe('embed', () => {
  const vectors = (...indexes: number[]) => json({ data: indexes.map((index) => ({ index, embedding: [index, 1] })) })

  it('returns one vector per text in the order of the texts', async () => {
    const { llm, calls } = client([vectors(1, 0)])
    expect(await llm.embed(['a', 'b'])).toEqual([[0, 1], [1, 1]])
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ model: 'embed-model', input: ['a', 'b'] })
  })

  it('reads the answer Gemini sends, where the first item has no index', async () => {
    const answer = json({ data: [{ embedding: [0, 1] }, { index: 1, embedding: [1, 1] }] })
    expect(await client([answer]).llm.embed(['a', 'b'])).toEqual([[0, 1], [1, 1]])
  })

  it('sends long lists in batches of 100 and keeps the order', async () => {
    const batch = (from: number, count: number) =>
      json({ data: Array.from({ length: count }, (_, i) => ({ index: i, embedding: [from + i] })) })
    const { llm, calls } = client([batch(0, 100), batch(100, 1)])
    const texts = Array.from({ length: 101 }, (_, i) => `t${i}`)
    const result = await llm.embed(texts)
    expect(calls.map((call) => JSON.parse(String(call.init.body)).input.length)).toEqual([100, 1])
    expect(result.map((vector) => vector[0])).toEqual(texts.map((_, i) => i))
  })

  it('makes no request for an empty list', async () => {
    const { llm, calls } = client([])
    expect(await llm.embed([])).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('rejects an answer with a missing or repeated vector', async () => {
    await expect(client([vectors(0)]).llm.embed(['a', 'b'])).rejects.toThrow('one vector per text')
    await expect(client([vectors(0, 0)]).llm.embed(['a', 'b'])).rejects.toThrow('one vector per text')
  })

  it('needs an embedding model', async () => {
    await expect(client([], { embeddingModel: '' }).llm.embed(['a'])).rejects.toThrow('no embedding model')
  })
})

describe('backoff', () => {
  it('doubles without Retry-After and never waits more than 10 seconds', () => {
    expect([1, 2, 3].map((attempt) => backoff(attempt, null))).toEqual([1000, 2000, 4000])
    expect(backoff(1, '120')).toBe(10_000)
    expect(backoff(1, 'soon')).toBe(1000)
  })
})
