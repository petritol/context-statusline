import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

const measured = atom({ plugin: 'context-statusline', key: 'measured' } as const, 0)

type Rgb = [number, number, number]

const GREEN: Rgb = [0, 255, 0]
const YELLOW: Rgb = [255, 255, 0]
const RED: Rgb = [255, 0, 0]

const DEFAULT_CONTEXT_BUDGET = '200k'
const YELLOW_SHARE = 0.75
export const LIMIT_YELLOW_SHARE = 0.5
const TRACK_BRIGHTNESS = 0.4

const UNITS: Record<string, number> = { '': 1, k: 1_000, m: 1_000_000 }

function parseThreshold(value: string, window: number): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(k|m|%)?\s*$/i.exec(value)
  if (!match) return undefined
  const amount = Number(match[1])
  const unit = (match[2] ?? '').toLowerCase()
  return unit === '%' ? (amount / 100) * window : amount * UNITS[unit]!
}

export function budgetTokens(contextBudget: string, window: number): number {
  return parseThreshold(contextBudget, window) || parseThreshold(DEFAULT_CONTEXT_BUDGET, window)!
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.trunc(tokens))
}

function clampText(value: string, limit: number): string {
  if (limit <= 0) return ''
  if (value.length <= limit) return value
  if (limit === 1) return value.slice(0, 1)
  return `${value.slice(0, limit - 1)}~`
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

function gradientAt(usedTokens: number, budget: number, yellowShare: number): Rgb {
  const gradient: [number, Rgb][] = [
    [0, GREEN],
    [budget * yellowShare, YELLOW],
    [budget, RED],
  ]
  let rgb = RED
  for (let i = 0; i < gradient.length - 1; i++) {
    const [t0, c0] = gradient[i]!
    const [t1, c1] = gradient[i + 1]!
    if (usedTokens <= t1) {
      const t = Math.max(0, (usedTokens - t0) / (t1 - t0))
      rgb = c0.map((c, j) => Math.round(c + (c1[j]! - c) * t)) as Rgb
      break
    }
  }
  return rgb
}

export function colorFor(usedTokens: number, budget: number, yellowShare = YELLOW_SHARE): string {
  return toHex(gradientAt(usedTokens, budget, yellowShare))
}

export function trackColorFor(usedTokens: number, budget: number, yellowShare = YELLOW_SHARE): string {
  return toHex(gradientAt(usedTokens, budget, yellowShare).map(c => Math.round(c * TRACK_BRIGHTNESS)) as Rgb)
}

export function modelDisplayName(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(id)
  if (!match) return id
  const [, family, major, minor, longContext] = match
  const name = `${family![0]!.toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ''}`
  return longContext ? `${name} (1M context)` : name
}

export type BarCell = { glyph: string; color: string }

export type Span = { text: string; color: string }

export const NEUTRAL_COLOR = '#b0b0b0'

export function barCells(args: {
  percent: number
  width: number
  tokens: number
  window: number
  budget: number
  yellowShare?: number
}): BarCell[] {
  const { percent, width, tokens, window, budget, yellowShare = YELLOW_SHARE } = args
  const fill = colorFor(tokens, budget, yellowShare)
  const filled = Math.round((Math.max(0, Math.min(100, percent)) * width) / 100)
  const marker = budget < window ? Math.floor((budget / window) * width) : -1

  return Array.from({ length: width }, (_, i) => {
    const isFilled = i < filled
    if (i === marker) return { glyph: isFilled ? '┃' : '│', color: fill }
    if (isFilled) return { glyph: '█', color: fill }
    return { glyph: '░', color: trackColorFor(((i + 0.5) / width) * window, budget, yellowShare) }
  })
}

export function lineText(spans: Span[]): string {
  return spans.map(span => span.text).join('')
}

export type UsageLimit = { label: 'session' | 'week'; percentUsed: number; resetsInMs?: number }

const LIMIT_KINDS = [
  ['five_hour', 'session'],
  ['seven_day', 'week'],
] as const

export function usageLimits(rateLimits: readonly SessionRateLimit[], now: number): UsageLimit[] {
  return LIMIT_KINDS.flatMap(([kind, label]) => {
    const limit = rateLimits.find(reading => reading.kind === kind)
    if (!limit) return []
    const resetsAt = Date.parse(limit.resetsAt ?? '')
    if (resetsAt <= now) return []
    return [{ label, percentUsed: limit.percentUsed, ...(Number.isNaN(resetsAt) ? {} : { resetsInMs: resetsAt - now }) }]
  })
}

export function formatCountdown(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (minutes < 1_440) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function sectionSpans(head: string, cells: BarCell[], suffix: string, color: string): Span[] {
  return [
    { text: cells.length ? `${head} [` : head, color },
    ...cells.map(cell => ({ text: cell.glyph, color: cell.color })),
    { text: `${cells.length ? ']' : ''}${suffix}`, color },
  ].filter(span => span.text)
}

function prefixSpans(prefix: string[]): Span[] {
  const text = prefix.filter(Boolean).map(part => `${part} | `).join('')
  return text ? [{ text, color: NEUTRAL_COLOR }] : []
}

function limitSpans(limit: UsageLimit, width: number): Span[] {
  const cells = barCells({ percent: limit.percentUsed, width, tokens: limit.percentUsed, window: 100, budget: 100, yellowShare: LIMIT_YELLOW_SHARE })
  const countdown = limit.resetsInMs === undefined ? '' : ` ↻${formatCountdown(limit.resetsInMs)}`
  return [
    { text: ' | ', color: NEUTRAL_COLOR },
    ...sectionSpans(`${limit.label} ${limit.percentUsed.toFixed(0)}%`, cells, countdown, colorFor(limit.percentUsed, 100, LIMIT_YELLOW_SHARE)),
  ]
}

function cutSpans(spans: Span[], columns: number): Span[] {
  const kept: Span[] = []
  let room = Math.max(0, columns - 1)
  for (const span of spans) {
    const text = span.text.slice(0, room)
    if (text) kept.push({ ...span, text })
    room -= text.length
    if (text.length < span.text.length) break
  }
  const last = kept.at(-1)
  if (last) last.text += '~'
  else kept.push({ text: '~', color: NEUTRAL_COLOR })
  return kept
}

export function statusLine(args: {
  model: string
  project: string
  tokens: number
  window: number
  percent: number
  budget: number
  columns: number
  limits?: UsageLimit[]
}): Span[] {
  const { model, project, tokens, window, percent, budget, columns, limits = [] } = args
  const maxBar = columns >= 100 ? 20 : columns >= 72 ? 12 : 0
  const fullPrefix = [clampText(model, 18), clampText(project, 24)]
  const modelPrefix = [clampText(model, 12)]
  const fits = (spans: Span[]) => lineText(spans).length <= columns

  const build = (prefix: string[], ctxBar: number, shown: UsageLimit[]): Span[] => [
    ...prefixSpans(prefix),
    ...sectionSpans(
      `ctx ${percent.toFixed(0)}%`,
      barCells({ percent, width: ctxBar, tokens, window, budget }),
      window ? ` ${formatTokens(tokens)}/${formatTokens(window)}` : '',
      colorFor(tokens, budget),
    ),
    ...shown.flatMap(limit => limitSpans(limit, ctxBar / 2)),
  ]

  if (limits.length) {
    for (const ctxBar of [20, 12, 0].filter(bar => bar <= maxBar)) {
      const line = build(fullPrefix, ctxBar, limits)
      if (fits(line)) return line
    }
    for (let shown = limits.length - 1; shown >= 1; shown--) {
      const line = build(fullPrefix, 0, limits.slice(0, shown))
      if (fits(line)) return line
    }
  }

  const ctxBar = limits.length ? 0 : maxBar
  let line = build(fullPrefix, ctxBar, [])
  if (!fits(line)) line = build(modelPrefix, ctxBar, [])
  if (ctxBar || fits(line)) return line
  return cutSpans(line, columns)
}

export const register: Register = (on, options) => {
  const contextBudget = String(options.contextBudget ?? DEFAULT_CONTEXT_BUDGET)
  const showUsageLimits = options.showUsageLimits !== false

  on('session.start', async ($, e, next) => {
    if (showUsageLimits) $.clock.every(60_000, () => void update($, measured, n => n + 1))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context') || e.changed.includes('rateLimits')) await update($, measured, n => n + 1)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, measured)

    const [{ context, rateLimits }, model, root] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.session.root(),
    ])
    const limits = showUsageLimits && rateLimits.length ? usageLimits(rateLimits, await $.clock.now()) : []
    const tokens = context.tokens ?? 0
    const budget = budgetTokens(contextBudget, context.window)
    const spans = statusLine({
      model: modelDisplayName(model),
      project: root.split(/[\\/]/).filter(Boolean).pop() ?? '',
      tokens,
      window: context.window,
      percent: Math.max(0, Math.min(100, context.percent ?? 0)),
      budget,
      columns: e.props.bodyColumns,
      limits,
    })

    const { Text } = $.ui.resolve(e)
    return (
      <Text color={NEUTRAL_COLOR} backgroundColor="#000000" wrap="truncate">
        {spans.map(span => (
          <Text color={span.color}>
            {span.text}
          </Text>
        ))}
      </Text>
    )
  })
}
