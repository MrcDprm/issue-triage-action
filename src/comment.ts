import type { Classification, IssueType, Language, MissingDetail } from './classify.js'
import type { Candidate } from './duplicates.js'
import { TRIAGE_MARKER } from './issue.js'
import type { LabelState } from './labels.js'

// Botun etiket durumu yorumda gizli satırlarda saklanır; ayrı bir depolama gerekmez.
const OWNED_PREFIX = '<!-- issue-triage-labels: '
const DECLINED_PREFIX = '<!-- issue-triage-declined: '
const SUFFIX = ' -->'
export const TITLE_LIMIT = 80

const ZWSP = '​'

/**
 * Yoruma giren serbest metin (modelin gerekçesi, issue başlıkları) şablonu bozamaz:
 * Markdown/HTML karakterleri kaçışlanır, @ anmaları ve #/GH- referansları kimseyi etiketlemez ve başka
 * issue'lara bağlantı düşmez, adresler tıklanabilir bağlantıya dönmez (oltalama), satır sonları teke iner.
 */
export function sanitize(text: string, limit = 300): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
    .replace(/[\\`*_{}[\]()+\-.!|~>]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/@/g, `@${ZWSP}`)
    .replace(/#/g, `#${ZWSP}`)
    .replace(/\bGH\\-/gi, (match) => `${match.slice(0, 2)}${ZWSP}${match.slice(2)}`)
    .replace(/:\/\//g, `:${ZWSP}//`)
    .replace(/www\\\./gi, (match) => `${match.slice(0, 3)}${ZWSP}${match.slice(3)}`)
}

const TEXT = {
  en: {
    title: 'Automatic triage',
    type: 'Type',
    priority: 'Priority',
    labels: 'Labels added',
    none: 'none',
    types: { bug: 'Bug', feature: 'Feature request', question: 'Question', docs: 'Documentation' } satisfies Record<IssueType, string>,
    duplicates: 'This may be the same as:',
    missingIntro: 'To help reproduce this bug, please edit the issue and add:',
    missing: {
      version: 'the version you use',
      steps: 'the steps to reproduce it',
      expected: 'what you expected to happen',
      actual: 'what happened instead (error message or log)',
    } satisfies Record<MissingDetail, string>,
    footer: 'Written by a bot from the issue text; it is updated when the issue is edited. A maintainer will review it.',
  },
  tr: {
    title: 'Otomatik sınıflandırma',
    type: 'Tür',
    priority: 'Öncelik',
    labels: 'Eklenen etiketler',
    none: 'yok',
    types: { bug: 'Hata', feature: 'Özellik isteği', question: 'Soru', docs: 'Belgelendirme' } satisfies Record<IssueType, string>,
    duplicates: 'Şununla aynı olabilir:',
    missingIntro: 'Hatayı tekrar oluşturabilmemiz için lütfen issue\'yu düzenleyip şunları ekleyin:',
    missing: {
      version: 'kullandığınız sürüm',
      steps: 'hatayı oluşturan adımlar',
      expected: 'ne olmasını beklediğiniz',
      actual: 'bunun yerine ne olduğu (hata mesajı ya da günlük)',
    } satisfies Record<MissingDetail, string>,
    footer: 'Bu yorumu issue metninden bir bot yazdı; issue düzenlenince güncellenir. Bir bakımcı inceleyecek.',
  },
} satisfies Record<Language, unknown>

export interface CommentInput {
  classification: Classification
  /** Bu çalıştırmadan sonraki etiket durumu. */
  labelState: LabelState
  candidates: Candidate[]
}

/** Yorumun tamamı şablondan; modelden gelen tek serbest metin gerekçe ve o da temizlenir. */
export function renderComment({ classification: c, labelState, candidates }: CommentInput): string {
  const t = TEXT[c.language]
  const label = (name: string) => `\`${name.replace(/`/g, "'")}\``
  const lines = [
    TRIAGE_MARKER,
    markerLine(OWNED_PREFIX, labelState.owned),
    markerLine(DECLINED_PREFIX, labelState.declined),
    `### ${t.title}`,
    '',
    `| | |`,
    `|---|---|`,
    `| ${t.type} | ${t.types[c.type]} |`,
    `| ${t.priority} | **${c.priority}**${c.priorityReason ? `: ${sanitize(c.priorityReason)}` : ''} |`,
    `| ${t.labels} | ${labelState.owned.length > 0 ? labelState.owned.map(label).join(', ') : t.none} |`,
  ]

  if (c.duplicates.length > 0) {
    const titles = new Map(candidates.map((candidate) => [candidate.number, candidate.title]))
    lines.push('', t.duplicates, ...c.duplicates.map((number) => `- #${number} ${sanitize(titles.get(number) ?? '', TITLE_LIMIT)}`.trimEnd()))
  }
  if (c.missing.length > 0) {
    lines.push('', t.missingIntro, ...c.missing.map((detail) => `- ${t.missing[detail]}`))
  }
  lines.push('', `<sub>${t.footer}</sub>`)
  return lines.join('\n')
}

// encodeURIComponent virgülü ve "-->" dizisini kaçışlar: etiket adı listeyi ya da HTML yorumunu bozamaz.
function markerLine(prefix: string, names: string[]): string {
  return `${prefix}${names.map(encodeURIComponent).join(',')}${SUFFIX}`
}

function readMarkerList(body: string, prefix: string): string[] {
  const line = body.split('\n').find((row) => row.startsWith(prefix) && row.endsWith(SUFFIX))
  const value = line?.slice(prefix.length, -SUFFIX.length) ?? ''
  if (value === '') return []
  try {
    return value.split(',').map(decodeURIComponent)
  } catch {
    return []
  }
}

/** Önceki yorumdaki gizli satırlardan etiket durumunu okur; satır yoksa ya da bozuksa boş listeler. */
export function readLabelState(body: string): LabelState {
  return { owned: readMarkerList(body, OWNED_PREFIX), declined: readMarkerList(body, DECLINED_PREFIX) }
}
