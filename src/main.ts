import * as core from '@actions/core'
import * as github from '@actions/github'

// İş akışını yöneten fonksiyon. Adımlar sonraki issue'larda eklenir:
// atlama kuralları (#2), LLM istemcisi (#3), tekrar adayları (#4), sınıflandırma (#5), etiket ve yorum (#6).
export async function run(): Promise<void> {
  try {
    const { eventName, payload } = github.context
    core.info(`Event: ${eventName}, issue: #${payload.issue?.number ?? '-'}`)
  } catch (error) {
    // Beklenmeyen hata: iş akışı kırmızıya döner, mesaj günlükte görünür.
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
