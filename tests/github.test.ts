import { describe, expect, it } from 'vitest'
import { addLabels, fetchLabels, fetchRecentIssues, findTriageComment, removeLabels, upsertTriageComment } from '../src/github.js'
import { TRIAGE_MARKER } from '../src/issue.js'

type Comment = { id: number; body: string | null; user: { type: string } | null }

// Sadece findTriageComment'in kullandığı parçalar: paginate ve listComments.
function fakeOctokit(comments: Comment[]) {
  const listComments = () => undefined
  return {
    rest: { issues: { listComments } },
    paginate: async (method: unknown) => {
      expect(method).toBe(listComments)
      return comments
    },
  } as unknown as Parameters<typeof findTriageComment>[0]
}

const repo = { owner: 'o', repo: 'r' }

describe('findTriageComment', () => {
  it('finds the bot comment that starts with the marker', async () => {
    const octokit = fakeOctokit([
      { id: 1, body: 'Same here', user: { type: 'User' } },
      { id: 2, body: `${TRIAGE_MARKER}\nType: bug`, user: { type: 'Bot' } },
    ])
    expect(await findTriageComment(octokit, repo, 7)).toEqual({ id: 2, body: `${TRIAGE_MARKER}\nType: bug` })
  })

  it('ignores a person who pastes the marker', async () => {
    const octokit = fakeOctokit([{ id: 3, body: `${TRIAGE_MARKER} fake`, user: { type: 'User' } }])
    expect(await findTriageComment(octokit, repo, 7)).toBeNull()
  })

  it('ignores a bot comment with the marker in the middle', async () => {
    const octokit = fakeOctokit([{ id: 4, body: `quote: ${TRIAGE_MARKER}`, user: { type: 'Bot' } }])
    expect(await findTriageComment(octokit, repo, 7)).toBeNull()
  })

  it('returns null when there are no comments or empty ones', async () => {
    expect(await findTriageComment(fakeOctokit([]), repo, 7)).toBeNull()
    expect(await findTriageComment(fakeOctokit([{ id: 5, body: null, user: null }]), repo, 7)).toBeNull()
  })
})

describe('fetchRecentIssues', () => {
  it('asks for recently updated issues of every state and drops pull requests and the issue itself', async () => {
    let request: Record<string, unknown> = {}
    const octokit = {
      rest: {
        issues: {
          listForRepo: async (params: Record<string, unknown>) => {
            request = params
            return {
              data: [
                { number: 7, title: 'itself', body: 'x', state: 'open' },
                { number: 6, title: 'a PR', body: null, state: 'open', pull_request: { url: 'u' } },
                { number: 5, title: 'Crash', body: null, state: 'closed' },
              ],
            }
          },
        },
      },
    } as unknown as Parameters<typeof fetchRecentIssues>[0]
    expect(await fetchRecentIssues(octokit, repo, 7)).toEqual([{ number: 5, title: 'Crash', body: '', state: 'closed' }])
    expect(request).toMatchObject({ owner: 'o', repo: 'r', state: 'all', sort: 'updated', direction: 'desc', per_page: 100 })
  })
})

describe('fetchLabels', () => {
  it('reads every page of labels and turns a missing description into an empty string', async () => {
    const listLabelsForRepo = () => undefined
    const octokit = {
      rest: { issues: { listLabelsForRepo } },
      paginate: async (method: unknown, params: Record<string, unknown>) => {
        expect(method).toBe(listLabelsForRepo)
        expect(params).toMatchObject({ owner: 'o', repo: 'r', per_page: 100 })
        return [
          { name: 'bug', description: "Something isn't working" },
          { name: 'P1', description: null },
        ]
      },
    } as unknown as Parameters<typeof fetchLabels>[0]
    expect(await fetchLabels(octokit, repo)).toEqual([
      { name: 'bug', description: "Something isn't working" },
      { name: 'P1', description: '' },
    ])
  })
})

/** Yazma çağrılarını kaydeden sahte istemci; removeLabel istenen etiketler için hata atabilir. */
function writingOctokit(removeErrors: Record<string, number> = {}) {
  const calls: [string, Record<string, unknown>][] = []
  const record = (name: string) => async (params: Record<string, unknown>) => {
    calls.push([name, params])
    const status = name === 'removeLabel' ? removeErrors[params.name as string] : undefined
    if (status) throw Object.assign(new Error(`HTTP ${status}`), { status })
    return {}
  }
  const octokit = {
    rest: { issues: { addLabels: record('addLabels'), removeLabel: record('removeLabel'), createComment: record('createComment'), updateComment: record('updateComment') } },
  } as unknown as Parameters<typeof addLabels>[0]
  return { octokit, calls }
}

describe('addLabels and removeLabels', () => {
  it('adds labels in one request and sends nothing for an empty list', async () => {
    const { octokit, calls } = writingOctokit()
    await addLabels(octokit, repo, 7, [])
    await addLabels(octokit, repo, 7, ['bug', 'P1'])
    expect(calls).toEqual([['addLabels', { owner: 'o', repo: 'r', issue_number: 7, labels: ['bug', 'P1'] }]])
  })

  it('ignores a label someone already removed (404) but not other errors', async () => {
    const { octokit, calls } = writingOctokit({ P1: 404 })
    await removeLabels(octokit, repo, 7, ['P1', 'P2'])
    expect(calls.map(([, params]) => params.name)).toEqual(['P1', 'P2'])
    await expect(removeLabels(writingOctokit({ P1: 403 }).octokit, repo, 7, ['P1'])).rejects.toThrow('HTTP 403')
  })
})

describe('upsertTriageComment', () => {
  it('creates a comment when there is none', async () => {
    const { octokit, calls } = writingOctokit()
    expect(await upsertTriageComment(octokit, repo, 7, null, 'body')).toBe('created')
    expect(calls).toEqual([['createComment', { owner: 'o', repo: 'r', issue_number: 7, body: 'body' }]])
  })

  it('updates the same comment when the issue is edited', async () => {
    const { octokit, calls } = writingOctokit()
    expect(await upsertTriageComment(octokit, repo, 7, { id: 42, body: 'old' }, 'new')).toBe('updated')
    expect(calls).toEqual([['updateComment', { owner: 'o', repo: 'r', comment_id: 42, body: 'new' }]])
  })

  it('sends nothing when the text did not change', async () => {
    const { octokit, calls } = writingOctokit()
    expect(await upsertTriageComment(octokit, repo, 7, { id: 42, body: 'same' }, 'same')).toBe('unchanged')
    expect(calls).toEqual([])
  })
})
