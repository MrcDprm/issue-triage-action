import { describe, expect, it } from 'vitest'
import { fetchRecentIssues, findTriageComment } from '../src/github.js'
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
