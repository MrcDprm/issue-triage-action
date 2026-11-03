import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// action.yml, GitHub'ın Action'ı nasıl çalıştıracağını söyler; yanlış bir satır Action'ı hiç açmaz.
const manifest = readFileSync(new URL('../action.yml', import.meta.url), 'utf8')

describe('action.yml', () => {
  it('runs the bundled file on Node 24', () => {
    expect(manifest).toMatch(/^ {2}using: node24$/m)
    expect(manifest).toMatch(/^ {2}main: dist\/index\.js$/m)
  })

  it('requires an API key and gives no default for it', () => {
    const block = manifest.slice(manifest.indexOf('  api-key:'), manifest.indexOf('  base-url:'))
    expect(block).toContain('required: true')
    expect(block).not.toContain('default:')
  })

  it('is not a dry run unless asked', () => {
    const block = manifest.slice(manifest.indexOf('  dry-run:'), manifest.indexOf('outputs:'))
    expect(block).toContain("default: 'false'")
  })
})
