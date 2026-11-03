import { z } from 'zod'

// Botun yorumunu bulmak için yorumun başına konan gizli işaret (Markdown'da görünmez).
export const TRIAGE_MARKER = '<!-- issue-triage -->'

// Sadece bu işlemlerde çalışılır; etiket ekleme gibi olaylar botun kendi işlemlerini tekrar tetiklemesin.
const HANDLED_ACTIONS = ['opened', 'edited', 'reopened'] as const

// Webhook verisi dışarıdan gelir: kullanılan alanlar doğrulanır, eksik ya da beklenmeyen biçimde gelirse çalışılmaz.
const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
  user: z.object({ login: z.string(), type: z.string() }).nullish(),
  labels: z.array(z.union([z.string(), z.object({ name: z.string() })])).default([]),
  pull_request: z.unknown().optional(),
})

const payloadSchema = z.object({
  action: z.string(),
  issue: issueSchema,
  changes: z.object({ title: z.unknown().optional(), body: z.unknown().optional() }).optional(),
})

export interface Issue {
  number: number
  title: string
  body: string
  labels: string[]
  author: string
}

export type EventCheck = { ok: true; issue: Issue; action: string } | { ok: false; reason: string }

/** API çağrısı gerektirmeyen kurallar: olay türü, işlem, PR, bot, kapalı issue, değişmeyen düzenleme. */
export function checkEvent(eventName: string, payload: unknown): EventCheck {
  if (eventName !== 'issues') return { ok: false, reason: `event "${eventName}" is not an issue event` }

  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, reason: 'the event has no readable issue' }
  const { action, issue, changes } = parsed.data

  if (!(HANDLED_ACTIONS as readonly string[]).includes(action)) return { ok: false, reason: `action "${action}" is not handled` }
  if (issue.pull_request !== undefined) return { ok: false, reason: 'pull requests are not triaged' }
  if (issue.user?.type === 'Bot') return { ok: false, reason: 'the issue was opened by a bot' }
  if (issue.state !== 'open') return { ok: false, reason: 'the issue is closed' }
  // Sadece etiket ya da başka bir alan değişmişse yeni bir sınıflandırmaya gerek yok.
  if (action === 'edited' && changes?.title === undefined && changes?.body === undefined) {
    return { ok: false, reason: 'neither the title nor the body changed' }
  }

  return {
    ok: true,
    action,
    issue: {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      labels: issue.labels.map((label) => (typeof label === 'string' ? label : label.name)),
      author: issue.user?.login ?? '',
    },
  }
}

/**
 * Etiketli issue'yu bir bakımcı sınıflandırmıştır, bot karışmaz. Tek istisna: bot daha önce yorum yazdıysa
 * etiketler botun olabilir; o zaman issue düzenlendiğinde yorum güncellenir.
 */
export function checkLabels(issue: Issue, hasTriageComment: boolean): string | null {
  if (issue.labels.length > 0 && !hasTriageComment) return 'the issue is already labelled by a maintainer'
  return null
}
