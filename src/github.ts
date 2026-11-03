import type * as github from '@actions/github'
import { TRIAGE_MARKER } from './issue.js'

type Octokit = ReturnType<typeof github.getOctokit>

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
