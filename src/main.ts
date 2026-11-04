import * as core from '@actions/core'
import * as github from '@actions/github'
import { classifyIssue } from './classify.js'
import { readLabelState, renderComment } from './comment.js'
import { findDuplicateCandidates } from './duplicates.js'
import { addLabels, fetchLabels, fetchRecentIssues, findTriageComment, removeLabels, upsertTriageComment } from './github.js'
import { checkEvent, checkLabels } from './issue.js'
import { planLabels, wantedLabels } from './labels.js'
import { createLlmClient, LlmError } from './llm.js'

// İş akışını yöneten fonksiyon. Sonraki adım: girdi doğrulaması, çıktılar ve dry-run (#7).
export async function run(): Promise<void> {
  try {
    // Anahtar günlükte geçerse GitHub onu *** olarak gösterir.
    const apiKey = core.getInput('api-key')
    if (apiKey) core.setSecret(apiKey)

    const event = checkEvent(github.context.eventName, github.context.payload)
    if (!event.ok) return skip(event.reason)
    const { issue } = event

    const octokit = github.getOctokit(core.getInput('github-token', { required: true }))
    const repo = github.context.repo

    // Etiketsiz issue'da yorum aramaya gerek yok; etiketliyse botun önceki yorumu belirleyici.
    const previous = issue.labels.length > 0 ? await findTriageComment(octokit, repo, issue.number) : null
    const labelReason = checkLabels(issue, previous !== null)
    if (labelReason) return skip(labelReason)

    core.info(`Triaging #${issue.number} (${event.action})`)

    const embeddingModel = core.getInput('embedding-model')
    const llm = createLlmClient({
      baseUrl: core.getInput('base-url'),
      apiKey: core.getInput('api-key', { required: true }),
      model: core.getInput('model'),
      embeddingModel,
    })

    const [labels, recent] = await Promise.all([fetchLabels(octokit, repo), fetchRecentIssues(octokit, repo, issue.number)])
    const { method, candidates } = await findDuplicateCandidates({
      llm,
      issue,
      recent,
      maxCandidates: Number(core.getInput('max-candidates') || 5),
      threshold: Number(core.getInput('similarity-threshold') || 0.75),
      useEmbeddings: embeddingModel !== '',
      warn: core.warning,
    })
    core.info(`Duplicate candidates (${method}): ${candidates.map((c) => `#${c.number}${c.similarity === null ? '' : ` ${c.similarity.toFixed(2)}`}`).join(', ') || 'none'}`)

    const result = await classifyIssue(llm, { issue, labels, candidates })
    // Modelin bozuk cevabı issue akışını durdurmaz: uyarı yazılır, iş başarılı biter.
    if (!result.ok) return core.warning(`Classification skipped: ${result.reason}`)
    const c = result.classification
    core.info(`Classified as ${c.type}, ${c.priority} (${c.priorityReason}); labels: ${c.labels.join(', ') || 'none'}; missing: ${c.missing.join(', ') || 'none'}; duplicates: ${c.duplicates.map((n) => `#${n}`).join(', ') || 'none'}; language: ${c.language}`)

    const plan = planLabels(issue.labels, wantedLabels(c, labels), readLabelState(previous?.body ?? ''))
    // Önce yorum: etiket isteği yarıda kalsa bile botun hangi etiketleri sahiplendiği kaybolmaz
    // (yorumda yazıp issue'da olmayan etiket sonraki çalıştırmada sahiplenilmiş sayılmaz).
    const commentBody = renderComment({ classification: c, labelState: plan, candidates })
    const commentResult = await upsertTriageComment(octokit, repo, issue.number, previous, commentBody)
    await addLabels(octokit, repo, issue.number, plan.add)
    await removeLabels(octokit, repo, issue.number, plan.remove)
    core.info(`Comment ${commentResult}; labels added: ${plan.add.join(', ') || 'none'}; removed: ${plan.remove.join(', ') || 'none'}`)
  } catch (error) {
    // Sağlayıcı ya da ağ hatası (kota, kesinti) issue akışını bloklamaz; uyarı olarak görünür.
    if (error instanceof LlmError) return core.warning(`LLM request failed: ${error.message}`)
    // Yazma izni yoksa GitHub 403 döner (hız sınırında da 403 gelebilir, mesaj korunur).
    if ((error as { status?: number }).status === 403) {
      const message = error instanceof Error ? error.message : ''
      return core.setFailed(`GitHub refused the request (403: ${message}). If it is a permission error, add "permissions: issues: write" to the workflow.`)
    }
    // Beklenmeyen hata: iş akışı kırmızıya döner, mesaj günlükte görünür.
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

function skip(reason: string): void {
  core.info(`Skipped: ${reason}`)
}
