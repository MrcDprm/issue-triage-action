import { describe, expect, it } from 'vitest'
import { cosine, EMBED_TEXT_LIMIT, embeddingText, findDuplicateCandidates, rankBySimilarity, TITLE_FALLBACK_LIMIT } from '../src/duplicates.js'
import type { IssueSummary } from '../src/github.js'
import type { LlmClient } from '../src/llm.js'

const issue = (number: number, title = `Issue ${number}`): IssueSummary => ({ number, title, body: '', state: 'open' })

/** Metne göre vektör dönen sahte istemci; gönderilen metinleri kaydeder. */
function fakeLlm(vectorFor: (text: string) => number[] | Error) {
  const sent: string[][] = []
  const llm: LlmClient = {
    chatJson: async () => '{}',
    embed: async (texts) => {
      sent.push(texts)
      return texts.map((text) => {
        const vector = vectorFor(text)
        if (vector instanceof Error) throw vector
        return vector
      })
    },
  }
  return { llm, sent }
}

describe('cosine', () => {
  it('is 1 for the same direction, 0 for perpendicular and -1 for opposite vectors', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0)
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1)
  })

  it('is 0 for a zero vector instead of dividing by zero', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })

  it('refuses vectors of different sizes', () => {
    expect(() => cosine([1], [1, 2])).toThrow('vector sizes differ')
  })
})

describe('rankBySimilarity', () => {
  const others = [
    { issue: issue(1), vector: [1, 0] }, // 1.00
    { issue: issue(2), vector: [0, 1] }, // 0.00
    { issue: issue(3), vector: [1, 1] }, // 0.71
    { issue: issue(4), vector: [3, 1] }, // 0.95
  ]

  it('keeps those above the threshold, most similar first', () => {
    expect(rankBySimilarity([1, 0], others, 0.7, 5).map((c) => c.number)).toEqual([1, 4, 3])
  })

  it('returns at most k candidates', () => {
    expect(rankBySimilarity([1, 0], others, 0, 2).map((c) => c.number)).toEqual([1, 4])
  })

  it('counts a similarity equal to the threshold', () => {
    expect(rankBySimilarity([1, 0], others, 1, 5).map((c) => c.number)).toEqual([1])
  })
})

describe('embeddingText', () => {
  it('joins title and body and cuts long text', () => {
    expect(embeddingText('Crash', 'on start')).toBe('Crash\n\non start')
    expect(embeddingText('T', 'x'.repeat(5000))).toHaveLength(EMBED_TEXT_LIMIT)
  })
})

describe('findDuplicateCandidates', () => {
  const base = { issue: { title: 'Crash on start', body: '' }, maxCandidates: 5, threshold: 0.8, useEmbeddings: true, warn: () => {} }

  it('embeds the new issue together with the recent ones in one call and ranks them', async () => {
    const { llm, sent } = fakeLlm((text) => (text.startsWith('Crash') || text.startsWith('App crash') ? [1, 0] : [0, 1]))
    const result = await findDuplicateCandidates({ ...base, llm, recent: [issue(5, 'Dark mode'), issue(6, 'App crash at launch')] })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.[0]).toBe('Crash on start\n\n')
    expect(result).toEqual({ method: 'embeddings', candidates: [{ number: 6, title: 'App crash at launch', state: 'open', similarity: 1 }] })
  })

  it('uses recent titles when there is no embedding model', async () => {
    const { llm, sent } = fakeLlm(() => [1])
    const recent = Array.from({ length: 40 }, (_, i) => issue(i + 1))
    const result = await findDuplicateCandidates({ ...base, llm, recent, useEmbeddings: false })
    expect(sent).toHaveLength(0)
    expect(result.method).toBe('titles')
    expect(result.candidates).toHaveLength(TITLE_FALLBACK_LIMIT)
    expect(result.candidates[0]).toEqual({ number: 1, title: 'Issue 1', state: 'open', similarity: null })
  })

  it('falls back to titles with a warning when embeddings fail', async () => {
    const warnings: string[] = []
    const { llm } = fakeLlm(() => new Error('HTTP 503'))
    const result = await findDuplicateCandidates({ ...base, llm, recent: [issue(1)], warn: (m) => warnings.push(m) })
    expect(result.method).toBe('titles')
    expect(warnings[0]).toContain('HTTP 503')
  })

  it('does nothing when there are no other issues or no candidates are wanted', async () => {
    const { llm, sent } = fakeLlm(() => [1])
    expect(await findDuplicateCandidates({ ...base, llm, recent: [] })).toEqual({ method: 'none', candidates: [] })
    expect(await findDuplicateCandidates({ ...base, llm, recent: [issue(1)], maxCandidates: 0 })).toEqual({ method: 'none', candidates: [] })
    expect(sent).toHaveLength(0)
  })
})
