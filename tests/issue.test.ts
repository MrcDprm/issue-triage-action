import { describe, expect, it } from 'vitest'
import { checkEvent, checkLabels, type Issue } from '../src/issue.js'

function payload(overrides: Record<string, unknown> = {}, issue: Record<string, unknown> = {}) {
  return {
    action: 'opened',
    issue: {
      number: 7,
      title: 'App crashes on start',
      body: 'Steps: open the app',
      state: 'open',
      user: { login: 'ayse', type: 'User' },
      labels: [],
      ...issue,
    },
    ...overrides,
  }
}

function reason(eventName: string, data: unknown): string {
  const result = checkEvent(eventName, data)
  if (result.ok) throw new Error('expected a skip')
  return result.reason
}

describe('checkEvent', () => {
  it('accepts a new issue and reads its fields', () => {
    const result = checkEvent('issues', payload({}, { labels: [{ name: 'bug' }, 'P1'] }))
    expect(result).toEqual({
      ok: true,
      action: 'opened',
      issue: { number: 7, title: 'App crashes on start', body: 'Steps: open the app', labels: ['bug', 'P1'], author: 'ayse' },
    })
  })

  it('treats a missing body as empty text', () => {
    const result = checkEvent('issues', payload({}, { body: null }))
    expect(result.ok && result.issue.body).toBe('')
  })

  it('accepts a reopened issue', () => {
    expect(checkEvent('issues', payload({ action: 'reopened' })).ok).toBe(true)
  })

  it('skips other events', () => {
    expect(reason('pull_request', payload())).toContain('not an issue event')
  })

  it('skips actions it does not handle, such as its own labelling', () => {
    expect(reason('issues', payload({ action: 'labeled' }))).toContain('"labeled" is not handled')
  })

  it('skips a payload without a readable issue', () => {
    expect(reason('issues', { action: 'opened' })).toBe('the event has no readable issue')
    expect(reason('issues', payload({}, { number: 'seven' }))).toBe('the event has no readable issue')
    expect(reason('issues', null)).toBe('the event has no readable issue')
  })

  it('skips pull requests', () => {
    expect(reason('issues', payload({}, { pull_request: { url: 'x' } }))).toContain('pull requests')
  })

  it('skips issues opened by bots', () => {
    expect(reason('issues', payload({}, { user: { login: 'dependabot[bot]', type: 'Bot' } }))).toContain('bot')
  })

  it('skips closed issues', () => {
    expect(reason('issues', payload({}, { state: 'closed' }))).toContain('closed')
  })

  it('skips an edit that changed neither title nor body', () => {
    expect(reason('issues', payload({ action: 'edited', changes: { milestone: {} } }))).toContain('neither')
    expect(reason('issues', payload({ action: 'edited' }))).toContain('neither')
  })

  it('accepts an edit of the title or the body', () => {
    expect(checkEvent('issues', payload({ action: 'edited', changes: { title: { from: 'old' } } })).ok).toBe(true)
    expect(checkEvent('issues', payload({ action: 'edited', changes: { body: { from: 'old' } } })).ok).toBe(true)
  })
})

describe('checkLabels', () => {
  const issue: Issue = { number: 1, title: 't', body: '', labels: [], author: 'ayse' }

  it('lets an unlabelled issue through', () => {
    expect(checkLabels(issue, false)).toBeNull()
  })

  it('skips an issue a maintainer has labelled', () => {
    expect(checkLabels({ ...issue, labels: ['bug'] }, false)).toContain('maintainer')
  })

  it('keeps triaging when the labels came with an earlier triage comment', () => {
    expect(checkLabels({ ...issue, labels: ['bug'] }, true)).toBeNull()
  })
})
