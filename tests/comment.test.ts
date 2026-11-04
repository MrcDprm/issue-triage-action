import { describe, expect, it } from 'vitest'
import type { Classification } from '../src/classify.js'
import { readLabelState, renderComment, sanitize } from '../src/comment.js'
import type { Candidate } from '../src/duplicates.js'
import { TRIAGE_MARKER } from '../src/issue.js'

const ZWSP = '​'

const classification = (overrides: Partial<Classification> = {}): Classification => ({
  type: 'bug',
  priority: 'P1',
  priorityReason: 'The app does not open.',
  labels: ['bug'],
  missing: [],
  language: 'en',
  duplicates: [],
  ...overrides,
})
const candidates: Candidate[] = [{ number: 12, title: 'App crashes on start', state: 'closed', similarity: 0.9 }]
const render = (c: Partial<Classification> = {}, owned = ['bug', 'P1'], declined: string[] = []) =>
  renderComment({ classification: classification(c), labelState: { owned, declined }, candidates })

describe('sanitize', () => {
  it('does not mention anyone', () => {
    expect(sanitize('ping @octocat and @org/team')).toBe(`ping @${ZWSP}octocat and @${ZWSP}org/team`)
  })

  it('does not reference other issues', () => {
    expect(sanitize('see #1 and other/repo#2 and GH-3')).toBe(`see #${ZWSP}1 and other/repo#${ZWSP}2 and GH${ZWSP}\\-3`)
  })

  it('does not produce links', () => {
    const text = sanitize('[click](https://evil.example) www.evil.example')
    expect(text).not.toContain('](')
    expect(text).not.toContain('://')
    expect(text).not.toMatch(/www\\?\./)
  })

  it('escapes HTML and Markdown so the template stays intact', () => {
    expect(sanitize('<img src=x onerror=alert(1)> | **bold** `code`')).toBe('&lt;img src=x onerror=alert\\(1\\)\\> \\| \\*\\*bold\\*\\* \\`code\\`')
  })

  it('puts the text on one line and shortens it', () => {
    expect(sanitize('a\n\n# Heading\n- item')).toBe(`a #${ZWSP} Heading \\- item`)
    expect(sanitize('x'.repeat(500), 10)).toBe('x'.repeat(10))
  })
})

describe('renderComment', () => {
  it('starts with the marker so the bot finds its own comment', () => {
    expect(render().startsWith(`${TRIAGE_MARKER}\n`)).toBe(true)
  })

  it('shows type, priority with reason and the labels the bot added', () => {
    const body = render()
    expect(body).toContain('| Type | Bug |')
    expect(body).toContain('| Priority | **P1**: The app does not open\\. |')
    expect(body).toContain('| Labels added | `bug`, `P1` |')
  })

  it('writes Turkish for a Turkish issue', () => {
    const body = render({ language: 'tr', missing: ['version'] })
    expect(body).toContain('| Tür | Hata |')
    expect(body).toContain('- kullandığınız sürüm')
    expect(body).not.toContain('Priority')
  })

  it('lists duplicates with a cleaned title and asks for missing details', () => {
    const body = render({ duplicates: [12], missing: ['steps', 'actual'] })
    expect(body).toContain('- #12 App crashes on start')
    expect(body).toContain('- the steps to reproduce it')
    expect(body).toContain('- what happened instead (error message or log)')
  })

  it('leaves out empty sections', () => {
    const body = render({}, [])
    expect(body).toContain('| Labels added | none |')
    expect(body).not.toContain('may be the same')
    expect(body).not.toContain('please edit')
  })

  it('cleans the model reason and the duplicate title', () => {
    const body = renderComment({
      classification: classification({ priorityReason: '@admin see https://evil.example', duplicates: [5] }),
      labelState: { owned: [], declined: [] },
      candidates: [{ number: 5, title: '<script>alert(1)</script> @all', state: 'open', similarity: 0.8 }],
    })
    expect(body).not.toMatch(/@admin|@all|https:\/\/|<script>/)
  })

  it('keeps a label name with a backtick inside its code span', () => {
    expect(render({}, ['a`b'])).toContain("`a'b`")
  })
})

describe('readLabelState', () => {
  it('reads back what renderComment stored, even with commas and comment endings in label names', () => {
    const owned = ['bug', 'needs, triage', 'odd -->']
    expect(readLabelState(render({}, owned, ['P0']))).toEqual({ owned, declined: ['P0'] })
  })

  it('returns empty lists for a comment without the lines or with a broken value', () => {
    expect(readLabelState('')).toEqual({ owned: [], declined: [] })
    expect(readLabelState(`${TRIAGE_MARKER}\n<!-- issue-triage-labels: %E0%A4%A -->`)).toEqual({ owned: [], declined: [] })
  })
})
