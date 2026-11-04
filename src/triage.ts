import { type Classification, classifyIssue } from './classify.js'
import { readLabelState, renderComment } from './comment.js'
import { findDuplicateCandidates } from './duplicates.js'
import { addLabels, fetchLabels, fetchRecentIssues, findTriageComment, type Octokit, removeLabels, type Repo, upsertTriageComment } from './github.js'
import type { Inputs } from './inputs.js'
import { checkEvent, checkLabels } from './issue.js'
import { planLabels, wantedLabels } from './labels.js'
import type { LlmClient } from './llm.js'

export interface Logger {
  info(message: string): void
  warning(message: string): void
}

export interface TriageDeps {
  inputs: Pick<Inputs, 'maxCandidates' | 'similarityThreshold' | 'dryRun' | 'embeddingModel'>
  eventName: string
  payload: unknown
  octokit: Octokit
  repo: Repo
  llm: LlmClient
  log: Logger
}

export type TriageOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'triaged'; classification: Classification; labels: string[]; dryRun: boolean }

/**
 * Bir issue olayının baştan sona işlenmesi. GitHub ve model istemcisi dışarıdan verilir; testler sahteleriyle
 * uçtan uca çalıştırır. Sağlayıcı hataları (LlmError) çağırana gider, bozuk model cevabı "skipped" olur.
 */
export async function triage(deps: TriageDeps): Promise<TriageOutcome> {
  const { inputs, octokit, repo, llm, log } = deps

  const event = checkEvent(deps.eventName, deps.payload)
  if (!event.ok) return { status: 'skipped', reason: event.reason }
  const { issue } = event

  // Etiketsiz issue'da yorum aramaya gerek yok; etiketliyse botun önceki yorumu belirleyici.
  const previous = issue.labels.length > 0 ? await findTriageComment(octokit, repo, issue.number) : null
  const labelReason = checkLabels(issue, previous !== null)
  if (labelReason) return { status: 'skipped', reason: labelReason }

  log.info(`Triaging #${issue.number} (${event.action})${inputs.dryRun ? ' in dry-run mode' : ''}`)

  const [labels, recent] = await Promise.all([fetchLabels(octokit, repo), fetchRecentIssues(octokit, repo, issue.number)])
  const { method, candidates } = await findDuplicateCandidates({
    llm,
    issue,
    recent,
    maxCandidates: inputs.maxCandidates,
    threshold: inputs.similarityThreshold,
    useEmbeddings: inputs.embeddingModel !== '',
    warn: (message) => log.warning(message),
  })
  log.info(`Duplicate candidates (${method}): ${candidates.map((c) => `#${c.number}${c.similarity === null ? '' : ` ${c.similarity.toFixed(2)}`}`).join(', ') || 'none'}`)

  const result = await classifyIssue(llm, { issue, labels, candidates })
  // Modelin bozuk cevabı issue akışını durdurmaz: uyarı yazılır, iş başarılı biter.
  if (!result.ok) {
    log.warning(`Classification skipped: ${result.reason}`)
    return { status: 'skipped', reason: result.reason }
  }
  const c = result.classification
  log.info(`Classified as ${c.type}, ${c.priority} (${c.priorityReason}); missing: ${c.missing.join(', ') || 'none'}; duplicates: ${c.duplicates.map((n) => `#${n}`).join(', ') || 'none'}; language: ${c.language}`)

  const plan = planLabels(issue.labels, wantedLabels(c, labels), readLabelState(previous?.body ?? ''))
  const commentBody = renderComment({ classification: c, labelState: plan })

  if (inputs.dryRun) {
    // Okuma istekleri yapıldı, yazma yok: bakımcı Action'ı açmadan önce sonucu günlükte görür.
    log.info(`Dry run, nothing written. Would add: ${plan.add.join(', ') || 'none'}; would remove: ${plan.remove.join(', ') || 'none'}; comment:\n${commentBody}`)
    return { status: 'triaged', classification: c, labels: plan.owned, dryRun: true }
  }

  // Önce yorum: etiket isteği yarıda kalsa bile botun hangi etiketleri sahiplendiği kaybolmaz
  // (yorumda yazıp issue'da olmayan etiket sonraki çalıştırmada sahiplenilmiş sayılmaz).
  const commentResult = await upsertTriageComment(octokit, repo, issue.number, previous, commentBody)
  await addLabels(octokit, repo, issue.number, plan.add)
  await removeLabels(octokit, repo, issue.number, plan.remove)
  log.info(`Comment ${commentResult}; labels added: ${plan.add.join(', ') || 'none'}; removed: ${plan.remove.join(', ') || 'none'}`)
  return { status: 'triaged', classification: c, labels: plan.owned, dryRun: false }
}
