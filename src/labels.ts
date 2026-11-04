import type { Classification, IssueType, Priority } from './classify.js'
import type { RepoLabel } from './github.js'

// Reponun etiket adı türe karşılık geliyor mu: "bug", "type: bug", "kind/bug" gibi yazılışlar aynı sayılır.
const TYPE_NAMES: Record<IssueType, string[]> = {
  bug: ['bug'],
  feature: ['feature', 'enhancement', 'feature request'],
  question: ['question'],
  docs: ['documentation', 'docs'],
}

/** "Type: Bug", "kind/bug", "priority-P1" → "bug", "bug", "p1". */
export function normalizeLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(type|kind|priority|prio)\s*[:/-]\s*/, '')
    .trim()
}

/** Türe ve önceliğe karşılık gelen repo etiketleri; repoda yoksa eklenmez (yeni etiket açılmaz). */
export function matchingLabels(type: IssueType, priority: Priority, labels: RepoLabel[]): string[] {
  const find = (names: string[]) => names.map((wanted) => labels.find((label) => normalizeLabel(label.name) === wanted)?.name).find((name) => name !== undefined)
  return [find(TYPE_NAMES[type]), find([priority.toLowerCase()])].filter((name) => name !== undefined)
}

/** Bu çalıştırmada issue'da olması istenen etiketler: tür, öncelik, sonra modelin seçtikleri. */
export function wantedLabels(classification: Classification, labels: RepoLabel[]): string[] {
  return [...new Set([...matchingLabels(classification.type, classification.priority, labels), ...classification.labels])]
}

export interface LabelState {
  /** Botun eklediği ve hâlâ issue'da duran etiketler; sonraki düzenlemede yalnızca bunları kaldırabilir. */
  owned: string[]
  /** Botun eklediği ama bir insanın kaldırdığı etiketler; bot bunları bir daha eklemez. */
  declined: string[]
}

export interface LabelPlan extends LabelState {
  add: string[]
  remove: string[]
}

/**
 * Bot sadece kendi eklediği etiketi kaldırır. Issue'da zaten olan ve botun eklemediği her etiket bir insanındır:
 * istenen listede olmasa bile dokunulmaz ve bota ait sayılmaz. Botun eklediği bir etiketi bakımcı kaldırdıysa
 * bot onu tekrar eklemez; bakımcının kararı sonraki bütün düzenlemelerde geçerlidir.
 */
export function planLabels(current: string[], wanted: string[], previous: LabelState): LabelPlan {
  const has = new Set(current)
  const owned = new Set(previous.owned.filter((name) => has.has(name)))
  const declined = new Set([...previous.declined, ...previous.owned.filter((name) => !has.has(name))])
  const add = wanted.filter((name) => !has.has(name) && !declined.has(name))
  const remove = [...owned].filter((name) => !wanted.includes(name))
  return {
    add,
    remove,
    owned: wanted.filter((name) => add.includes(name) || owned.has(name)),
    // İnsan etiketi geri eklediyse artık onundur; reddedilenler listesinde tutmaya gerek yok.
    declined: [...declined].filter((name) => !has.has(name)),
  }
}
