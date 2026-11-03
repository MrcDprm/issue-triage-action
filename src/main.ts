import * as core from '@actions/core'
import * as github from '@actions/github'
import { findTriageComment } from './github.js'
import { checkEvent, checkLabels } from './issue.js'

// İş akışını yöneten fonksiyon. Sonraki adımlar: tekrar adayları (#4), sınıflandırma (#5), etiket ve yorum (#6);
// LLM istemcisi (src/llm.ts) onlarla birlikte bağlanır.
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
  } catch (error) {
    // Beklenmeyen hata: iş akışı kırmızıya döner, mesaj günlükte görünür.
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

function skip(reason: string): void {
  core.info(`Skipped: ${reason}`)
}
