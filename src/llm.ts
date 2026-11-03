import { z } from 'zod'

// OpenAI uyumlu API istemcisi: Gemini, Groq, OpenAI ve Ollama aynı istek biçimini kabul eder.

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Boşsa embedding istenmez; tekrar bulma başlıklara düşer. */
  embeddingModel: string
  timeoutMs?: number
  /** Testlerde ağ ve bekleme yerine sahteleri verilir. */
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface JsonSchema {
  name: string
  schema: Record<string, unknown>
}

export interface LlmClient {
  /** Modelin cevabını şemaya uyan JSON metni olarak döner; doğrulama çağıranın işi. */
  chatJson(messages: ChatMessage[], schema: JsonSchema): Promise<string>
  /** Her metin için bir vektör, verilen sırayla. */
  embed(texts: string[]): Promise<number[][]>
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3
const MAX_WAIT_MS = 10_000
export const EMBED_BATCH = 100

const chatResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullish() }) })).min(1),
})

const embeddingResponse = z.object({
  // Gemini 0 olan index'i hiç yazmaz (varsayılan değeri atlar); yoksa listedeki sırası kullanılır.
  data: z.array(z.object({ index: z.number().int().nonnegative().optional(), embedding: z.array(z.number()).min(1) })),
})

/** Anahtar düz http ile gönderilmez; sadece kendi makinedeki sunucu (Ollama) için http'ye izin var. */
export function parseBaseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value.endsWith('/') ? value : `${value}/`)
  } catch {
    throw new LlmError('base-url is not a valid URL')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new LlmError('base-url must use https (http is allowed only for localhost)')
  }
  return url
}

export function createLlmClient(config: LlmConfig): LlmClient {
  const base = parseBaseUrl(config.baseUrl)
  const doFetch = config.fetch ?? fetch
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = config.timeoutMs ?? 30_000

  // Hata mesajlarına sağlayıcının cevabından kısa bir parça girer; anahtar orada geçse bile silinir.
  const redact = (text: string) => text.split(config.apiKey).join('***').slice(0, 200)

  async function post(path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, base)
    for (let attempt = 1; ; attempt++) {
      let response: Response
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        // Ağ hatası ya da zaman aşımı: geçici olabilir, tekrar denenir.
        if (attempt < MAX_ATTEMPTS) {
          await sleep(backoff(attempt, null))
          continue
        }
        const reason = error instanceof Error ? error.name : 'network error'
        throw new LlmError(`${path}: request failed (${reason})`)
      }

      if (response.ok) {
        try {
          return await response.json()
        } catch {
          throw new LlmError(`${path}: the answer is not JSON`, response.status)
        }
      }
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
        await sleep(backoff(attempt, response.headers.get('retry-after')))
        continue
      }
      const detail = redact(await response.text().catch(() => ''))
      throw new LlmError(`${path}: HTTP ${response.status}${detail ? ` ${detail}` : ''}`, response.status)
    }
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const parsed = embeddingResponse.safeParse(await post('embeddings', { model: config.embeddingModel, input: texts }))
    if (!parsed.success || parsed.data.data.length !== texts.length) {
      throw new LlmError('embeddings: the answer does not have one vector per text')
    }
    // Sağlayıcı sırayı karıştırabilir; index alanına göre dizilir.
    const vectors: number[][] = []
    parsed.data.data.forEach((item, position) => (vectors[item.index ?? position] = item.embedding))
    // Aynı index iki kez gelirse dizide boşluk kalır (some boşlukları atladığı için tek tek bakılır).
    for (let i = 0; i < texts.length; i++) {
      if (vectors[i] === undefined) throw new LlmError('embeddings: the answer does not have one vector per text')
    }
    return vectors
  }

  return {
    async chatJson(messages, schema) {
      const json = await post('chat/completions', {
        model: config.model,
        messages,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } },
      })
      const parsed = chatResponse.safeParse(json)
      const content = parsed.success ? parsed.data.choices[0]?.message.content : null
      if (!content) throw new LlmError('chat/completions: the answer has no message')
      return content
    },

    async embed(texts) {
      if (texts.length === 0) return []
      if (!config.embeddingModel) throw new LlmError('embeddings: no embedding model is set')
      // Gemini tek istekte en fazla 100 metin kabul eder (101'de HTTP 400); uzun listeler parça parça gönderilir.
      const vectors: number[][] = []
      for (let start = 0; start < texts.length; start += EMBED_BATCH) {
        vectors.push(...(await embedBatch(texts.slice(start, start + EMBED_BATCH))))
      }
      return vectors
    },
  }
}

/** Retry-After (saniye) varsa ona uyulur, yoksa 1 sn, 2 sn; en fazla 10 sn beklenir. */
export function backoff(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter)
  const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * 2 ** (attempt - 1)
  return Math.min(ms, MAX_WAIT_MS)
}
