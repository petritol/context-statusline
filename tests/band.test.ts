import { expect, mock, test } from 'claude-code/testing'
import type { RenderElement } from 'claude-code'

import { barCells, budgetTokens, colorFor, formatCountdown, LIMIT_YELLOW_SHARE, lineText, modelDisplayName, NEUTRAL_COLOR, statusLine, trackColorFor, usageLimits, type UsageLimit } from '../hooks/register'

const childrenOf = (node: RenderElement): readonly unknown[] => ('children' in node ? node.children ?? [] : [])

const shownText = (node: unknown): string =>
  typeof node === 'string' ? node : childrenOf(node as RenderElement).map(shownText).join('')

test('should format the line and degrade with width', async () => {
  const base = { model: 'Opus 5.5', project: 'Projects', tokens: 50_000, window: 1_000_000, percent: 5, budget: 200_000 }
  const at = (overrides: Partial<typeof base> & { columns: number }) => lineText(statusLine({ ...base, ...overrides }))

  expect(at({ columns: 120 })).toBe('Opus 5.5 | Projects | ctx 5% [█░░░│░░░░░░░░░░░░░░░] 50k/1M')
  expect(at({ columns: 80 })).toBe('Opus 5.5 | Projects | ctx 5% [█░│░░░░░░░░░] 50k/1M')
  expect(at({ columns: 40 })).toBe('Opus 5.5 | Projects | ctx 5% 50k/1M')
  expect(at({ tokens: 250_000, percent: 25, columns: 30 })).toBe('Opus 5.5 | ctx 25% 250k/1M')
  expect(at({ columns: 20 })).toBe('Opus 5.5 | ctx 5% 5~')
})

test('should mark the context budget on the bar', async () => {
  const cells = barCells({ percent: 35, width: 20, tokens: 350_000, window: 1_000_000, budget: 800_000 })
  const fill = colorFor(350_000, 800_000)

  expect(cells.map(cell => cell.glyph).join('')).toBe('███████░░░░░░░░░│░░░')
  expect(cells[0]).toEqual({ glyph: '█', color: fill })
  expect(cells[7]).toEqual({ glyph: '░', color: trackColorFor(375_000, 800_000) })
  expect(cells[16]).toEqual({ glyph: '│', color: fill })
  expect(cells[19]).toEqual({ glyph: '░', color: '#660000' })
})

test('should keep the budget marker visible inside the fill', async () => {
  const cells = barCells({ percent: 85, width: 20, tokens: 850_000, window: 1_000_000, budget: 800_000 })

  expect(cells.map(cell => cell.glyph).join('')).toBe('████████████████┃░░░')
  expect(cells[16]).toEqual({ glyph: '┃', color: '#ff0000' })
})

test('should leave the marker out when the budget is the whole window', async () => {
  const cells = barCells({ percent: 50, width: 12, tokens: 100_000, window: 200_000, budget: 200_000 })

  expect(cells.map(cell => cell.glyph).join('')).toBe('██████░░░░░░')
})

test('should turn model ids into display names', async () => {
  expect(modelDisplayName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelDisplayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelDisplayName('claude-opus-4-20250514')).toBe('Opus 4')
  expect(modelDisplayName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 (1M context)')
  expect(modelDisplayName('us.anthropic.claude-opus-5-5-v1:0')).toBe('us.anthropic.claude-opus-5-5-v1:0')
})

test('should darken the track to the gradient color at each point', async () => {
  expect(trackColorFor(0, 200_000)).toBe('#006600')
  expect(trackColorFor(150_000, 200_000)).toBe('#666600')
  expect(trackColorFor(500_000, 200_000)).toBe('#660000')
})

test('should run the gradient green to yellow to red', async () => {
  expect(colorFor(0, 200_000)).toBe('#00ff00')
  expect(colorFor(150_000, 200_000)).toBe('#ffff00')
  expect(colorFor(175_000, 200_000)).toBe('#ff8000')
  expect(colorFor(500_000, 200_000)).toBe('#ff0000')
})

test('should read the context budget as tokens or as a share of the window', async () => {
  expect(budgetTokens('200k', 1_000_000)).toBe(200_000)
  expect(budgetTokens('80%', 1_000_000)).toBe(800_000)
  expect(budgetTokens('1.5M', 2_000_000)).toBe(1_500_000)
  expect(budgetTokens('120000', 1_000_000)).toBe(120_000)
})

test('should fall back to 200k when the context budget is unreadable', async () => {
  expect(budgetTokens('lots', 1_000_000)).toBe(200_000)
  expect(budgetTokens('0%', 1_000_000)).toBe(200_000)
})

test('should draw the band from the session usage', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000, percent: 16 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: '/Users/me/Projects/app' }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'context-statusline',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    })

    const drawn = await ui.drawn()
    expect(drawn).toMatchObject({ type: 'Text', props: { color: NEUTRAL_COLOR, backgroundColor: '#000000', wrap: 'truncate' } })
    expect(shownText(drawn)).toBe('Opus 5.5 | app | ctx 16% [███░│░░░░░░░░░░░░░░░] 160k/1M')
    expect(childrenOf(drawn)[1]).toEqual({ type: 'Text', props: { color: '#ffcc00' }, children: ['ctx 16% ['] })
    expect(childrenOf(drawn)[6]).toEqual({ type: 'Text', props: { color: '#ffcc00' }, children: ['│'] })
    await ui.unmount()
  }
})

test('should key the color on a configured share of the window', { options: { contextBudget: '80%' } }, async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160_000, window: 1_000_000, percent: 16 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: '/Users/me/Projects/app' }))

  const ui = await $.ui.mount({
    plugin: 'context-statusline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })

  const drawn = await ui.drawn()
  expect(drawn).toMatchObject({ type: 'Text', props: { color: NEUTRAL_COLOR, backgroundColor: '#000000', wrap: 'truncate' } })
  expect(childrenOf(drawn)[1]).toMatchObject({ props: { color: '#44ff00' } })
  expect(shownText(drawn)).toBe('Opus 5.5 | app | ctx 16% [███░░░░░░░░░░░░░│░░░] 160k/1M')
})

test('should run the limit gradient green to yellow at half to red', async () => {
  expect(colorFor(0, 100, LIMIT_YELLOW_SHARE)).toBe('#00ff00')
  expect(colorFor(25, 100, LIMIT_YELLOW_SHARE)).toBe('#80ff00')
  expect(colorFor(50, 100, LIMIT_YELLOW_SHARE)).toBe('#ffff00')
  expect(colorFor(75, 100, LIMIT_YELLOW_SHARE)).toBe('#ff8000')
  expect(colorFor(100, 100, LIMIT_YELLOW_SHARE)).toBe('#ff0000')
  expect(colorFor(140, 100, LIMIT_YELLOW_SHARE)).toBe('#ff0000')
  expect(trackColorFor(50, 100, LIMIT_YELLOW_SHARE)).toBe('#666600')
})

test('should draw a limit bar without a budget marker', async () => {
  const cells = barCells({ percent: 37, width: 10, tokens: 37, window: 100, budget: 100, yellowShare: LIMIT_YELLOW_SHARE })

  expect(cells.map(cell => cell.glyph).join('')).toBe('████░░░░░░')
  expect(cells[0]).toEqual({ glyph: '█', color: '#bdff00' })
  expect(cells[4]).toEqual({ glyph: '░', color: '#5c6600' })
  expect(cells[9]).toEqual({ glyph: '░', color: '#660a00' })
})

const NOW = Date.parse('2026-10-19T12:00:00Z')

test('should read the session and week limits in that order', async () => {
  expect(usageLimits([
    { kind: 'seven_day', percentUsed: 19, resetsAt: '2026-10-22T18:00:00Z' },
    { kind: 'five_hour', percentUsed: 37, resetsAt: '2026-10-19T14:14:00Z' },
  ], NOW)).toEqual([
    { label: 'session', percentUsed: 37, resetsInMs: 134 * 60_000 },
    { label: 'week', percentUsed: 19, resetsInMs: 78 * 3_600_000 },
  ])
})

test('should ignore limit windows other than session and week', async () => {
  expect(usageLimits([{ kind: 'spend_limit', percentUsed: 120 }, { kind: 'seven_day_opus', percentUsed: 5 }], NOW)).toEqual([])
})

test('should keep a limit without a countdown when its reset time is missing or unreadable', async () => {
  const limits = usageLimits([{ kind: 'five_hour', percentUsed: 37 }, { kind: 'seven_day', percentUsed: 19, resetsAt: 'soon' }], NOW)

  expect(limits).toEqual([{ label: 'session', percentUsed: 37 }, { label: 'week', percentUsed: 19 }])
  expect(limits.every(limit => !('resetsInMs' in limit))).toBe(true)
})

test('should hide a limit once its reset time has passed', async () => {
  expect(usageLimits([{ kind: 'five_hour', percentUsed: 98, resetsAt: '2026-10-19T12:00:00Z' }], NOW)).toEqual([])
})

test('should format the countdown in minutes, hours or days', async () => {
  expect(formatCountdown(1_000)).toBe('1m')
  expect(formatCountdown(47 * 60_000)).toBe('47m')
  expect(formatCountdown(47 * 60_000 + 1)).toBe('48m')
  expect(formatCountdown(60 * 60_000)).toBe('1h 0m')
  expect(formatCountdown(134 * 60_000)).toBe('2h 14m')
  expect(formatCountdown(24 * 3_600_000)).toBe('1d 0h')
  expect(formatCountdown(78 * 3_600_000)).toBe('3d 6h')
})

const LIMITS: UsageLimit[] = [
  { label: 'session', percentUsed: 37, resetsInMs: 134 * 60_000 },
  { label: 'week', percentUsed: 19, resetsInMs: 78 * 3_600_000 },
]
const LINE = { model: 'Opus 5.5', project: 'Projects', tokens: 50_000, window: 1_000_000, percent: 5, budget: 200_000 }

test('should shrink the bars, drop them, then drop week and session as the line narrows', async () => {
  const at = (columns: number) => lineText(statusLine({ ...LINE, limits: LIMITS, columns }))

  expect(at(130)).toBe('Opus 5.5 | Projects | ctx 5% [█░░░│░░░░░░░░░░░░░░░] 50k/1M | session 37% [████░░░░░░] ↻2h 14m | week 19% [██░░░░░░░░] ↻3d 6h')
  expect(at(110)).toBe('Opus 5.5 | Projects | ctx 5% [█░│░░░░░░░░░] 50k/1M | session 37% [██░░░░] ↻2h 14m | week 19% [█░░░░░] ↻3d 6h')
  expect(at(100)).toBe('Opus 5.5 | Projects | ctx 5% 50k/1M | session 37% ↻2h 14m | week 19% ↻3d 6h')
  expect(at(74)).toBe('Opus 5.5 | Projects | ctx 5% 50k/1M | session 37% ↻2h 14m')
  expect(at(50)).toBe('Opus 5.5 | Projects | ctx 5% 50k/1M')
  expect(at(30)).toBe('Opus 5.5 | ctx 5% 50k/1M')
})

test('should not bring the context bar back after the limits drop out', async () => {
  const spans = statusLine({ ...LINE, project: 'a-really-long-folder-name', limits: LIMITS, columns: 72 })

  expect(lineText(spans)).toBe('Opus 5.5 | a-really-long-folder-na~ | ctx 5% 50k/1M')
})

test('should show a limit without a countdown when it has no reset time', async () => {
  const spans = statusLine({ ...LINE, limits: [{ label: 'session', percentUsed: 37 }], columns: 130 })

  expect(lineText(spans)).toBe('Opus 5.5 | Projects | ctx 5% [█░░░│░░░░░░░░░░░░░░░] 50k/1M | session 37% [████░░░░░░]')
})

test('should color each section by itself', async () => {
  const spans = statusLine({ ...LINE, limits: LIMITS, columns: 130 })

  expect(spans[0]).toEqual({ text: 'Opus 5.5 | Projects | ', color: NEUTRAL_COLOR })
  expect(spans[1]).toEqual({ text: 'ctx 5% [', color: '#55ff00' })
  expect(spans[22]).toEqual({ text: '] 50k/1M', color: '#55ff00' })
  expect(spans[23]).toEqual({ text: ' | ', color: NEUTRAL_COLOR })
  expect(spans[24]).toEqual({ text: 'session 37% [', color: '#bdff00' })
  expect(spans[25]).toEqual({ text: '█', color: '#bdff00' })
  expect(spans[35]).toEqual({ text: '] ↻2h 14m', color: '#bdff00' })
  expect(spans[36]).toEqual({ text: ' | ', color: NEUTRAL_COLOR })
  expect(spans[37]).toEqual({ text: 'week 19% [', color: '#61ff00' })
})

test('should keep each span color when the line is cut short', async () => {
  expect(statusLine({ ...LINE, columns: 20 })).toEqual([
    { text: 'Opus 5.5 | ', color: NEUTRAL_COLOR },
    { text: 'ctx 5%', color: '#55ff00' },
    { text: ' 5~', color: '#55ff00' },
  ])
})

const USAGE_LIMITS = [
  { kind: 'five_hour', percentUsed: 37, resetsAt: '2026-10-19T14:14:00Z' },
  { kind: 'seven_day', percentUsed: 19, resetsAt: '2026-10-22T18:00:00Z' },
]
const USAGE = { startedAt: 0, context: { tokens: 160_000, window: 1_000_000, percent: 16 }, rateLimits: USAGE_LIMITS }

test('should draw the usage limits after the context', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: '/Users/me/Projects/app' }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'context-statusline',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 130, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    })

    expect(shownText(await ui.drawn())).toBe('Opus 5.5 | app | ctx 16% [███░│░░░░░░░░░░░░░░░] 160k/1M | session 37% [████░░░░░░] ↻2h 14m | week 19% [██░░░░░░░░] ↻3d 6h')
    await ui.unmount()
  }
})

test('should leave the usage limits out when the setting is off', { options: { showUsageLimits: false } }, async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: '/Users/me/Projects/app' }))

  const ui = await $.ui.mount({
    plugin: 'context-statusline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 130, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })

  expect(shownText(await ui.drawn())).toBe('Opus 5.5 | app | ctx 16% [███░│░░░░░░░░░░░░░░░] 160k/1M')
  await ui.unmount()
})

test('should count the reset down once a minute and hide a limit once it resets', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: '/Users/me/Projects/app' }))
  await $.session.start({ cwd: '/Users/me/Projects/app', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'context-statusline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 130, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })

  expect(shownText(await ui.drawn())).toContain('↻2h 14m')
  await clock.advance(60_000)
  expect(shownText(await ui.drawn())).toContain('↻2h 13m')
  await clock.set(Date.parse('2026-10-19T14:14:00Z'))
  expect(shownText(await ui.drawn())).toBe('Opus 5.5 | app | ctx 16% [███░│░░░░░░░░░░░░░░░] 160k/1M | week 19% [██░░░░░░░░] ↻3d 3h')
  await ui.unmount()
})

test('should redraw when a limit moves', async ($, on) => {
  mock.clock(on, { now: NOW })
  let percentUsed = 37
  on('session.usage', () => ({ value: { ...USAGE, rateLimits: [{ ...USAGE_LIMITS[0]!, percentUsed }] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: '/Users/me/Projects/app' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  const ui = await $.ui.mount({
    plugin: 'context-statusline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 130, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })

  percentUsed = 52
  await $.session.measure({ context: USAGE.context, rateLimits: [{ ...USAGE_LIMITS[0]!, percentUsed }], changed: ['rateLimits'] })
  expect(shownText(await ui.drawn())).toContain('session 52% [')
  await ui.unmount()
})
