import { describe, expect, it } from 'vitest'
import type { Classification } from '../src/classify.js'
import { matchingLabels, normalizeLabel, planLabels, wantedLabels } from '../src/labels.js'

const repoLabels = (...names: string[]) => names.map((name) => ({ name, description: '' }))

describe('normalizeLabel', () => {
  it('drops common prefixes and case', () => {
    expect(normalizeLabel('Type: Bug')).toBe('bug')
    expect(normalizeLabel('kind/bug')).toBe('bug')
    expect(normalizeLabel('priority-P1')).toBe('p1')
    expect(normalizeLabel('Priority: P0')).toBe('p0')
    expect(normalizeLabel('good first issue')).toBe('good first issue')
  })
})

describe('matchingLabels', () => {
  it('finds the type and priority labels in the repository spelling', () => {
    expect(matchingLabels('bug', 'P1', repoLabels('Type: Bug', 'priority/P1', 'P2'))).toEqual(['Type: Bug', 'priority/P1'])
  })

  it('uses GitHub default names for features and docs', () => {
    expect(matchingLabels('feature', 'P3', repoLabels('enhancement'))).toEqual(['enhancement'])
    expect(matchingLabels('docs', 'P3', repoLabels('documentation'))).toEqual(['documentation'])
  })

  it('creates nothing when the repository has no matching label', () => {
    expect(matchingLabels('question', 'P0', repoLabels('bug', 'P1'))).toEqual([])
    expect(matchingLabels('bug', 'P1', [])).toEqual([])
  })
})

describe('wantedLabels', () => {
  it('puts type and priority first and does not repeat a label', () => {
    const c = { type: 'bug', priority: 'P2', labels: ['ui', 'bug'] } as Classification
    expect(wantedLabels(c, repoLabels('bug', 'P2', 'ui'))).toEqual(['bug', 'P2', 'ui'])
  })
})

const state = (owned: string[] = [], declined: string[] = []) => ({ owned, declined })

describe('planLabels', () => {
  it('adds what is missing on a new issue and owns it', () => {
    expect(planLabels([], ['bug', 'P1'], state())).toEqual({ add: ['bug', 'P1'], remove: [], owned: ['bug', 'P1'], declined: [] })
  })

  it('removes only its own labels when the classification changes', () => {
    // Bot önce bug+P1 ekledi, bir insan "ui" ekledi; düzenlemeden sonra öncelik P2 oldu.
    expect(planLabels(['bug', 'P1', 'ui'], ['bug', 'P2'], state(['bug', 'P1']))).toEqual({ add: ['P2'], remove: ['P1'], owned: ['bug', 'P2'], declined: [] })
  })

  it('never removes a label a person added, even if it is not wanted', () => {
    const plan = planLabels(['wontfix', 'P0'], ['bug', 'P1'], state())
    expect(plan.remove).toEqual([])
    expect(plan.owned).toEqual(['bug', 'P1'])
  })

  it('does not take over a wanted label that a person already added', () => {
    expect(planLabels(['bug'], ['bug'], state()).owned).toEqual([])
  })

  it('does not add back a label that a person removed from the bot', () => {
    // Bot bug+P1 eklemişti, bakımcı P1'i kaldırdı; model yine P1 dese de bot geri eklemez ve sahiplenmez.
    const first = planLabels(['bug'], ['bug', 'P1'], state(['bug', 'P1']))
    expect(first).toEqual({ add: [], remove: [], owned: ['bug'], declined: ['P1'] })
    // Sonraki düzenlemede de hatırlanır.
    expect(planLabels(['bug'], ['bug', 'P1'], first).add).toEqual([])
  })

  it('lets a person take back a declined label', () => {
    const plan = planLabels(['bug', 'P1'], ['bug', 'P1'], state(['bug'], ['P1']))
    expect(plan).toEqual({ add: [], remove: [], owned: ['bug'], declined: [] })
  })
})
