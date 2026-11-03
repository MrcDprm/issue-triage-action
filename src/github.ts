import type * as github from '@actions/github'
import { TRIAGE_MARKER } from './issue.js'

export type Octokit = ReturnType<typeof github.getOctokit>

export interface Repo {
  owner: string
  repo: string
}

export interface TriageComment {
  id: number
  body: string
}

/** Botun bu issue'ya daha önce yazdığı yorumu gizli işaretinden bulur; yoksa null. */
export async function findTriageComment(octokit: Octokit, repo: Repo, issueNumber: number): Promise<TriageComment | null> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { ...repo, issue_number: issueNumber, per_page: 100 })
  // İşaret yorumun başında aranır: bir insan yorumunun ortasına işaret yazılsa bile bot onu kendi yorumu sanmaz.
  const found = comments.find((comment) => comment.user?.type === 'Bot' && comment.body?.startsWith(TRIAGE_MARKER))
  return found ? { id: found.id, body: found.body ?? '' } : null
}

export interface IssueSummary {
  number: number
  title: string
  body: string
  state: string
}

// Tekrar arayışı en son güncellenen bu kadar issue'ya bakar: tek API sayfası, en fazla iki embedding isteği.
export const RECENT_LIMIT = 100

/** Son güncellenen açık ve kapalı issue'lar; PR'lar ve sınıflandırılan issue'nun kendisi hariç. */
export async function fetchRecentIssues(octokit: Octokit, repo: Repo, exclude: number): Promise<IssueSummary[]> {
  const { data } = await octokit.rest.issues.listForRepo({ ...repo, state: 'all', sort: 'updated', direction: 'desc', per_page: RECENT_LIMIT })
  return data
    .filter((issue) => !issue.pull_request && issue.number !== exclude)
    .map((issue) => ({ number: issue.number, title: issue.title, body: issue.body ?? '', state: issue.state }))
}
