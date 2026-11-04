import { describe, expect, it } from 'vitest'
import { readInputs } from '../src/inputs.js'
import { ConfigError } from '../src/llm.js'

// action.yml'deki varsayılanlarla dolu girdiler; testler tek tek değiştirir.
const defaults: Record<string, string> = {
  'api-key': 'key',
  'base-url': 'https://generativelanguage.googleapis.com/v1beta/openai/',
  model: 'gemini-3.1-flash-lite',
  'embedding-model': 'gemini-embedding-001',
  'github-token': 'token',
  'max-candidates': '5',
  'similarity-threshold': '0.75',
  'dry-run': 'false',
}
const read = (overrides: Record<string, string> = {}) => readInputs((name) => ({ ...defaults, ...overrides })[name] ?? '')

describe('readInputs', () => {
  it('reads the defaults', () => {
    expect(read()).toEqual({
      apiKey: 'key',
      baseUrl: defaults['base-url'],
      model: 'gemini-3.1-flash-lite',
      embeddingModel: 'gemini-embedding-001',
      githubToken: 'token',
      maxCandidates: 5,
      similarityThreshold: 0.75,
      dryRun: false,
    })
  })

  it('trims spaces and allows an empty embedding model', () => {
    expect(read({ model: '  m  ', 'embedding-model': ' ' })).toMatchObject({ model: 'm', embeddingModel: '' })
  })

  it('names the missing required input', () => {
    expect(() => read({ 'api-key': '' })).toThrow('api-key is required')
    expect(() => read({ model: '  ' })).toThrow('model is required')
    expect(() => read({ 'github-token': '' })).toThrow('github-token is required')
  })

  it('refuses a base-url that is not https', () => {
    expect(() => read({ 'base-url': 'http://example.com/v1' })).toThrow(ConfigError)
  })

  it('accepts the edges of the ranges', () => {
    expect(read({ 'max-candidates': '0', 'similarity-threshold': '0' })).toMatchObject({ maxCandidates: 0, similarityThreshold: 0 })
    expect(read({ 'max-candidates': '20', 'similarity-threshold': '1' })).toMatchObject({ maxCandidates: 20, similarityThreshold: 1 })
  })

  it('refuses candidate counts that are not whole numbers from 0 to 20', () => {
    for (const value of ['21', '-1', '2.5', 'five', '0x10', '1e1']) {
      expect(() => read({ 'max-candidates': value })).toThrow(`max-candidates must be a whole number from 0 to 20, got "${value}"`)
    }
  })

  it('refuses thresholds outside 0-1 or written oddly', () => {
    for (const value of ['1.5', '-0.1', '75%', 'high', '.5', 'Infinity', 'NaN']) {
      expect(() => read({ 'similarity-threshold': value })).toThrow('similarity-threshold must be a number from 0 to 1')
    }
  })

  it('reads dry-run like core.getBooleanInput and refuses anything else', () => {
    expect(read({ 'dry-run': 'true' }).dryRun).toBe(true)
    expect(read({ 'dry-run': 'TRUE' }).dryRun).toBe(true)
    expect(read({ 'dry-run': 'False' }).dryRun).toBe(false)
    expect(read({ 'dry-run': '' }).dryRun).toBe(false)
    expect(() => read({ 'dry-run': 'yes' })).toThrow('dry-run must be true or false, got "yes"')
  })

  it('never puts the API key in an error message', () => {
    try {
      read({ 'api-key': 'secret-123', 'max-candidates': 'x' })
    } catch (error) {
      expect(String(error)).not.toContain('secret-123')
    }
  })
})
