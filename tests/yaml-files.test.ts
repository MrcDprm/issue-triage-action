import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

// Geçersiz bir workflow dosyası CI'da hiç iş başlatmaz, hata da sadece "workflow file issue" olarak görünür
// (ilk CI çalışmasında tırnaksız bir değerdeki ": " yüzünden oldu). Bu test hatayı yerelde yakalar.
const root = new URL('../', import.meta.url)
const workflows = readdirSync(new URL('.github/workflows/', root)).map((name) => `.github/workflows/${name}`)

describe('YAML files', () => {
  it.each(['action.yml', ...workflows])('%s is valid YAML', (path) => {
    const document = parseDocument(readFileSync(new URL(path, root), 'utf8'))
    expect(document.errors.map((error) => error.message)).toEqual([])
  })
})

describe('triage workflow', () => {
  const workflow = parseDocument(readFileSync(new URL('.github/workflows/triage.yml', root), 'utf8')).toJS() as {
    on: Record<string, unknown>
    permissions: Record<string, string>
    jobs: { triage: { steps: { uses?: string; with?: Record<string, string> }[] } }
  }

  it('asks only for the permissions it needs', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' })
  })

  it('runs only on issue events, never on pull_request_target', () => {
    expect(Object.keys(workflow.on)).toEqual(['issues'])
  })

  it('takes the key from a secret', () => {
    const step = workflow.jobs.triage.steps.find((s) => s.uses === './')
    expect(step?.with?.['api-key']).toBe('${{ secrets.GEMINI_API_KEY }}')
  })
})
