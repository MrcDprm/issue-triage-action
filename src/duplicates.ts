import type { IssueSummary } from './github.js'
import type { LlmClient } from './llm.js'

export interface Candidate {
  number: number
  title: string
  state: string
  /** Embedding benzerliği; başlık yönteminde null. */
  similarity: number | null
}

export interface CandidateResult {
  method: 'embeddings' | 'titles' | 'none'
  candidates: Candidate[]
}

// Embedding için metin kırpılır: uzun log yapıştırılmış issue'lar kotayı boşa harcamasın, anlam başta durur.
export const EMBED_TEXT_LIMIT = 2000
// Embedding yoksa modele bu kadar başlık verilir.
export const TITLE_FALLBACK_LIMIT = 30

export function embeddingText(title: string, body: string): string {
  return `${title}\n\n${body}`.slice(0, EMBED_TEXT_LIMIT)
}

/** İki vektörün kosinüs benzerliği (-1..1); sıfır vektörde 0. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`vector sizes differ (${a.length} and ${b.length})`)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB)
}

/** Eşiği geçenlerden en benzer k tanesi, benzerliğe göre azalan sırada. */
export function rankBySimilarity(target: number[], others: { issue: IssueSummary; vector: number[] }[], threshold: number, k: number): Candidate[] {
  return others
    .map(({ issue, vector }) => ({ number: issue.number, title: issue.title, state: issue.state, similarity: cosine(target, vector) }))
    .filter((candidate) => candidate.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k)
}

export interface FindOptions {
  llm: LlmClient
  issue: { title: string; body: string }
  recent: IssueSummary[]
  maxCandidates: number
  threshold: number
  useEmbeddings: boolean
  warn: (message: string) => void
}

/**
 * Önce embedding ile anlamca yakın issue'lar bulunur; model bunlardan gerçekten aynı olanları seçer (#5).
 * Embedding yoksa ya da başarısız olursa son issue'ların başlıkları aday olarak verilir; iş durmaz.
 */
export async function findDuplicateCandidates(options: FindOptions): Promise<CandidateResult> {
  const { llm, issue, recent, maxCandidates, threshold, useEmbeddings, warn } = options
  if (recent.length === 0 || maxCandidates === 0) return { method: 'none', candidates: [] }

  if (useEmbeddings) {
    try {
      const [target, ...vectors] = await llm.embed([embeddingText(issue.title, issue.body), ...recent.map((r) => embeddingText(r.title, r.body))])
      if (target) {
        const others = recent.map((r, i) => ({ issue: r, vector: vectors[i] ?? [] }))
        return { method: 'embeddings', candidates: rankBySimilarity(target, others, threshold, maxCandidates) }
      }
    } catch (error) {
      warn(`Embeddings failed, using issue titles instead: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const candidates = recent.slice(0, TITLE_FALLBACK_LIMIT).map((r) => ({ number: r.number, title: r.title, state: r.state, similarity: null }))
  return { method: 'titles', candidates }
}
