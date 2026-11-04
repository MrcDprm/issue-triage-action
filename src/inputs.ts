import { ConfigError, parseBaseUrl } from './llm.js'

export interface Inputs {
  apiKey: string
  baseUrl: string
  model: string
  /** Boşsa tekrar bulma başlıklarla yapılır. */
  embeddingModel: string
  githubToken: string
  maxCandidates: number
  similarityThreshold: number
  dryRun: boolean
}

export const MAX_CANDIDATES_LIMIT = 20

/**
 * action.yml'deki girdileri okur ve doğrular. Yanlış ayar sessizce varsayılana düşmez: Action hangi girdinin
 * neden yanlış olduğunu söyleyerek kırmızı biter. `get` testlerde sahte, gerçekte core.getInput.
 */
export function readInputs(get: (name: string) => string): Inputs {
  const value = (name: string) => get(name).trim()
  const required = (name: string) => {
    const text = value(name)
    if (text === '') throw new ConfigError(`${name} is required`)
    return text
  }

  const baseUrl = required('base-url')
  parseBaseUrl(baseUrl)

  return {
    apiKey: required('api-key'),
    baseUrl,
    model: required('model'),
    embeddingModel: value('embedding-model'),
    githubToken: required('github-token'),
    maxCandidates: integerInRange('max-candidates', value('max-candidates') || '5', 0, MAX_CANDIDATES_LIMIT),
    similarityThreshold: numberInRange('similarity-threshold', value('similarity-threshold') || '0.75', 0, 1),
    dryRun: boolean('dry-run', value('dry-run') || 'false'),
  }
}

// Number('') 0, Number('0x10') 16 verir; sadece düz ondalık yazım kabul edilir.
const DECIMAL = /^\d+(\.\d+)?$/

function numberInRange(name: string, text: string, min: number, max: number): number {
  const number = Number(text)
  if (!DECIMAL.test(text) || number < min || number > max) {
    throw new ConfigError(`${name} must be a number from ${min} to ${max}, got "${text}"`)
  }
  return number
}

function integerInRange(name: string, text: string, min: number, max: number): number {
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) {
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max}, got "${text}"`)
  }
  return Number(text)
}

// core.getBooleanInput ile aynı yazılışlar (YAML 1.2 core şeması).
function boolean(name: string, text: string): boolean {
  if (['true', 'True', 'TRUE'].includes(text)) return true
  if (['false', 'False', 'FALSE'].includes(text)) return false
  throw new ConfigError(`${name} must be true or false, got "${text}"`)
}
