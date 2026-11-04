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

export interface RepoLabel {
  name: string
  description: string
}

/** Reponun bütün etiketleri; model sadece bunlardan seçebilir, yeni etiket açılmaz. */
export async function fetchLabels(octokit: Octokit, repo: Repo): Promise<RepoLabel[]> {
  const labels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, { ...repo, per_page: 100 })
  return labels.map((label) => ({ name: label.name, description: label.description ?? '' }))
}

/** Etiketleri ekler; issue'daki diğer etiketlere dokunmaz (addLabels var olanları silmez). */
export async function addLabels(octokit: Octokit, repo: Repo, issueNumber: number, labels: string[]): Promise<void> {
  if (labels.length > 0) await octokit.rest.issues.addLabels({ ...repo, issue_number: issueNumber, labels })
}

/** Botun kendi eklediği etiketleri kaldırır; biri zaten kaldırdıysa (404) sorun sayılmaz. */
export async function removeLabels(octokit: Octokit, repo: Repo, issueNumber: number, labels: string[]): Promise<void> {
  for (const name of labels) {
    try {
      await octokit.rest.issues.removeLabel({ ...repo, issue_number: issueNumber, name })
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
    }
  }
}

/** Önceki yorum varsa onu günceller, yoksa yeni yorum yazar: issue'da her zaman tek bot yorumu olur. */
export async function upsertTriageComment(octokit: Octokit, repo: Repo, issueNumber: number, previous: TriageComment | null, body: string): Promise<'created' | 'updated' | 'unchanged'> {
  if (previous === null) {
    await octokit.rest.issues.createComment({ ...repo, issue_number: issueNumber, body })
    return 'created'
  }
  if (previous.body === body) return 'unchanged'
  await octokit.rest.issues.updateComment({ ...repo, comment_id: previous.id, body })
  return 'updated'
}
