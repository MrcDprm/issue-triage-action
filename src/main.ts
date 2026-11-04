import * as core from '@actions/core'
import * as github from '@actions/github'
import { readInputs } from './inputs.js'
import { createLlmClient, LlmError } from './llm.js'
import { triage } from './triage.js'

// GitHub Actions'a bağlanan ince katman: girdileri okur, istemcileri kurar, sonucu çıktılara yazar.
export async function run(): Promise<void> {
  try {
    // Anahtar günlükte geçerse GitHub onu *** olarak gösterir; doğrulamadan önce maskelenir.
    const apiKey = core.getInput('api-key')
    if (apiKey) core.setSecret(apiKey)

    // Yanlış ayar her olayda, issue atlansa bile hemen görünsün diye ilk iş doğrulanır.
    const inputs = readInputs((name) => core.getInput(name))
    const outcome = await triage({
      inputs,
      eventName: github.context.eventName,
      payload: github.context.payload,
      octokit: github.getOctokit(inputs.githubToken),
      repo: github.context.repo,
      llm: createLlmClient(inputs),
      log: { info: core.info, warning: core.warning },
    })

    if (outcome.status === 'skipped') return core.info(`Skipped: ${outcome.reason}`)
    const c = outcome.classification
    core.setOutput('type', c.type)
    core.setOutput('priority', c.priority)
    core.setOutput('labels', outcome.labels.join(','))
    core.setOutput('duplicates', c.duplicates.join(','))
  } catch (error) {
    // Sağlayıcı ya da ağ hatası (kota, kesinti) issue akışını bloklamaz; uyarı olarak görünür.
    if (error instanceof LlmError) return core.warning(`LLM request failed: ${error.message}`)
    // Yazma izni yoksa GitHub 403 döner (hız sınırında da 403 gelebilir, mesaj korunur).
    if ((error as { status?: number }).status === 403) {
      const message = error instanceof Error ? error.message : ''
      return core.setFailed(`GitHub refused the request (403: ${message}). If it is a permission error, add "permissions: issues: write" to the workflow.`)
    }
    // Ayar hatası ya da beklenmeyen hata: iş akışı kırmızıya döner, mesaj günlükte görünür.
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
