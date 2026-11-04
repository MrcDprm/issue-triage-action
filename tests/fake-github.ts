import type { Octokit } from '../src/github.js'

// Testlerde kullanılan sahte GitHub istemcisi: akışın kullandığı REST çağrılarını taklit eder, her çağrıyı
// parametreleriyle kaydeder. Yazma çağrıları ayrıca süzülebilir ("dry-run hiçbir şey yazmaz" gibi testler için).
export const WRITES = new Set(['addLabels', 'removeLabel', 'createComment', 'updateComment'])

export interface FakeGitHubOptions {
  comments?: { id: number; body: string; user: { type: string } }[]
  labels?: { name: string; description: string | null }[]
  recent?: { number: number; title: string; body: string | null; state: string }[]
  /** Bu çağrı adı bu durum koduyla hata atar (ör. createComment: 403). */
  fail?: Record<string, number>
}

export interface Call {
  name: string
  params: Record<string, unknown>
}

export function fakeGitHub(options: FakeGitHubOptions = {}) {
  const calls: Call[] = []
  const labels = options.labels ?? [
    { name: 'bug', description: null },
    { name: 'P1', description: null },
  ]
  const recent = options.recent ?? [{ number: 3, title: 'App crashes on start', body: 'crash', state: 'closed' }]

  const handler = (name: string, result: () => unknown) => async (params: Record<string, unknown> = {}) => {
    calls.push({ name, params })
    const status = options.fail?.[name]
    if (status) throw Object.assign(new Error(`HTTP ${status}`), { status })
    return result()
  }
  const issues = {
    listComments: handler('listComments', () => ({ data: options.comments ?? [] })),
    listLabelsForRepo: handler('listLabelsForRepo', () => ({ data: labels })),
    listForRepo: handler('listForRepo', () => ({ data: recent })),
    addLabels: handler('addLabels', () => ({})),
    removeLabel: handler('removeLabel', () => ({})),
    createComment: handler('createComment', () => ({})),
    updateComment: handler('updateComment', () => ({})),
  }
  const octokit = {
    rest: { issues },
    // paginate tek sayfa döner: verilen yöntemi çağırıp data'sını açar.
    paginate: async (method: (params: Record<string, unknown>) => Promise<{ data: unknown }>, params: Record<string, unknown>) => (await method(params)).data,
  } as unknown as Octokit

  return {
    octokit,
    calls,
    writes: () => calls.filter((call) => WRITES.has(call.name)),
    writeNames: () => calls.filter((call) => WRITES.has(call.name)).map((call) => call.name),
  }
}
