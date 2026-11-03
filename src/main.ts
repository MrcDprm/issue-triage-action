import * as core from '@actions/core'
import * as github from '@actions/github'
import { findDuplicateCandidates } from './duplicates.js'
import { fetchRecentIssues, findTriageComment } from './github.js'
import { checkEvent, checkLabels } from './issue.js'
import { createLlmClient } from './llm.js'

// İş akışını yöneten fonksiyon. Sonraki adımlar: sınıflandırma (#5), etiket ve yorum (#6), girdi doğrulaması (#7).
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

    const recent = await fetchRecentIssues(octokit, repo, issue.number)
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
  } catch (error) {
    // Beklenmeyen hata: iş akışı kırmızıya döner, mesaj günlükte görünür.
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

function skip(reason: string): void {
  core.info(`Skipped: ${reason}`)
}
