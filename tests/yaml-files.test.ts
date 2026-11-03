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
