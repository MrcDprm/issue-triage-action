import { describe, expect, it } from 'vitest'
import { TRIAGE_MARKER } from '../src/issue.js'
import type { LlmClient } from '../src/llm.js'
import { triage, type TriageDeps } from '../src/triage.js'

// Uçtan uca: sahte GitHub ve sahte model istemcisiyle bütün akış. Yazma istekleri ayrıca kaydedilir.
const WRITES = new Set(['addLabels', 'removeLabel', 'createComment', 'updateComment'])

function fakeGitHub(options: { comments?: { id: number; body: string; user: { type: string } }[] } = {}) {
  const calls: string[] = []
  const handler = (name: string, result: unknown) => async () => {
    calls.push(name)
    return result
  }
  const issues = {
    listComments: handler('listComments', undefined),
    listLabelsForRepo: handler('listLabelsForRepo', undefined),
    listForRepo: handler('listForRepo', {
      data: [{ number: 3, title: 'App crashes on start', body: 'crash', state: 'closed' }],
    }),
    addLabels: handler('addLabels', {}),
    removeLabel: handler('removeLabel', {}),
    createComment: handler('createComment', {}),
    updateComment: handler('updateComment', {}),
  }
  const octokit = {
    rest: { issues },
    paginate: async (method: unknown) => {
      if (method === issues.listComments) {
        calls.push('listComments')
        return options.comments ?? []
      }
      calls.push('listLabelsForRepo')
      return [
        { name: 'bug', description: null },
        { name: 'P1', description: null },
      ]
    },
  } as unknown as TriageDeps['octokit']
  return { octokit, calls, writes: () => calls.filter((name) => WRITES.has(name)) }
}

const answer = JSON.stringify({
  type: 'bug',
  priority: 'P1',
  priority_reason: 'Crashes on start.',
  labels: [],
  missing: ['version'],
  language: 'en',
  duplicates: [3],
})
const llm = (chat: () => Promise<string> = async () => answer): LlmClient => ({ chatJson: chat, embed: async (texts) => texts.map(() => [1, 0]) })

const payload = (issue: Record<string, unknown> = {}, action = 'opened') => ({
  action,
  issue: { number: 7, title: 'Crash on start', body: 'It crashes', state: 'open', user: { login: 'ayse', type: 'User' }, labels: [], ...issue },
})

function deps(overrides: Partial<TriageDeps> = {}): TriageDeps & { logs: string[] } {
  const logs: string[] = []
  return {
    inputs: { maxCandidates: 5, similarityThreshold: 0.75, dryRun: false, embeddingModel: 'e' },
    eventName: 'issues',
    payload: payload(),
    octokit: fakeGitHub().octokit,
    repo: { owner: 'o', repo: 'r' },
    llm: llm(),
    log: { info: (m) => logs.push(m), warning: (m) => logs.push(`warning: ${m}`) },
    logs,
    ...overrides,
  }
}

describe('triage', () => {
  it('classifies a new issue, writes one comment and adds the matching labels', async () => {
    const github = fakeGitHub()
    const outcome = await triage(deps({ octokit: github.octokit }))
    expect(outcome).toMatchObject({ status: 'triaged', labels: ['bug', 'P1'], dryRun: false, classification: { type: 'bug', duplicates: [3] } })
    expect(github.writes()).toEqual(['createComment', 'addLabels'])
  })

  it('writes nothing to the issue in dry-run mode but logs the comment', async () => {
    const github = fakeGitHub()
    const d = deps({ octokit: github.octokit, inputs: { maxCandidates: 5, similarityThreshold: 0.75, dryRun: true, embeddingModel: 'e' } })
    const outcome = await triage(d)
    expect(outcome).toMatchObject({ status: 'triaged', labels: ['bug', 'P1'], dryRun: true })
    expect(github.writes()).toEqual([])
    expect(d.logs.join('\n')).toContain(`Dry run, nothing written. Would add: bug, P1`)
    expect(d.logs.join('\n')).toContain(TRIAGE_MARKER)
  })

  it('updates its own comment when the issue is edited', async () => {
    const github = fakeGitHub({ comments: [{ id: 9, body: `${TRIAGE_MARKER}\n<!-- issue-triage-labels: bug,P1 -->\nold`, user: { type: 'Bot' } }] })
    const d = deps({ octokit: github.octokit, payload: { ...payload({ labels: [{ name: 'bug' }, { name: 'P1' }] }, 'edited'), changes: { body: { from: 'x' } } } })
    await triage(d)
    // Etiketler zaten bot tarafından eklenmiş: yeni etiket isteği yok, yalnızca yorum güncellenir.
    expect(github.writes()).toEqual(['updateComment'])
  })

  it('skips an issue a maintainer already labelled without calling the model', async () => {
    const github = fakeGitHub()
    let asked = false
    const outcome = await triage(deps({ octokit: github.octokit, payload: payload({ labels: [{ name: 'bug' }] }), llm: llm(async () => ((asked = true), answer)) }))
    expect(outcome).toEqual({ status: 'skipped', reason: 'the issue is already labelled by a maintainer' })
    expect(asked).toBe(false)
    expect(github.writes()).toEqual([])
  })

  it('skips with a warning when the model answer is broken', async () => {
    const github = fakeGitHub()
    const d = deps({ octokit: github.octokit, llm: llm(async () => 'not json') })
    expect(await triage(d)).toEqual({ status: 'skipped', reason: 'the model answer is not JSON' })
    expect(d.logs).toContain('warning: Classification skipped: the model answer is not JSON')
    expect(github.writes()).toEqual([])
  })

  it('lets provider errors reach the caller and writes nothing', async () => {
    const github = fakeGitHub()
    const failing = llm(async () => {
      throw new Error('HTTP 503')
    })
    await expect(triage(deps({ octokit: github.octokit, llm: failing }))).rejects.toThrow('HTTP 503')
    expect(github.writes()).toEqual([])
  })

  it('skips events that are not issues before calling GitHub', async () => {
    const github = fakeGitHub()
    expect(await triage(deps({ octokit: github.octokit, eventName: 'push' }))).toMatchObject({ status: 'skipped' })
    expect(github.calls).toEqual([])
  })
})
