import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'

type Strategy = string

type ScoreboardEntry = {
  id: string
  name: string
  isAi: boolean
  strategy: Strategy
  score: number
  honor: number
  deckSize: number
  constructs: number
}

type PurchaseEvent = {
  step: number
  turnNumber: number
  playerId: string
  playerName: string
  kind: 'buy_center' | 'buy_reserve' | 'free_acquire'
  cardId: string
  cardName: string
}

type DefeatEvent = {
  step: number
  turnNumber: number
  playerId: string
  playerName: string
  cardId: string
  cardName: string
}

type GameRecord = {
  gameIndex: number
  seed: number
  steps: number
  gameOver: boolean
  endRoundCount?: number
  terminationReason?: string
  forceResolvedDeadlocks?: number
  winnerIds: string[]
  finalScoreboard: ScoreboardEntry[]
  purchases: PurchaseEvent[]
  banishes: unknown[]
  defeats: DefeatEvent[]
}

type SimulationFile = {
  generatedAt: string
  games: GameRecord[]
}

type RankedRow = {
  name: string
  count: number
  probability: number
}

type DiffRow = {
  name: string
  championCount: number
  championProbability: number
  allCount: number
  allProbability: number
  diff: number
}

function mean(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount)
}

function seatFromPlayerId(playerId: string) {
  const match = playerId.match(/player-(\d+)/)
  return match ? Number(match[1]) : -1
}

function toMarkdownTable(headers: string[], rows: string[][]) {
  const header = `| ${headers.join(' | ')} |`
  const divider = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  return [header, divider, body].filter(Boolean).join('\n')
}

function sortRankedRows(rows: RankedRow[]) {
  return [...rows].sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability
    if (b.count !== a.count) return b.count - a.count
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

function sortDiffRows(rows: DiffRow[]) {
  return [...rows].sort((a, b) => {
    if (b.diff !== a.diff) return b.diff - a.diff
    if (b.championProbability !== a.championProbability) return b.championProbability - a.championProbability
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

function rankedRowsFromMap(map: Map<string, number>, denominator: number): RankedRow[] {
  return sortRankedRows(
    [...map.entries()].map(([name, count]) => ({
      name,
      count,
      probability: denominator === 0 ? 0 : count / denominator,
    })),
  )
}

function diffRowsFromMaps(
  championMap: Map<string, number>,
  championDenominator: number,
  allMap: Map<string, number>,
  allDenominator: number,
): DiffRow[] {
  const keys = new Set<string>([...championMap.keys(), ...allMap.keys()])
  return sortDiffRows(
    [...keys].map((name) => {
      const championCount = championMap.get(name) ?? 0
      const allCount = allMap.get(name) ?? 0
      const championProbability = championDenominator === 0 ? 0 : championCount / championDenominator
      const allProbability = allDenominator === 0 ? 0 : allCount / allDenominator
      return {
        name,
        championCount,
        championProbability,
        allCount,
        allProbability,
        diff: championProbability - allProbability,
      }
    }),
  )
}

function rankedRowsTable(rows: RankedRow[], probabilityLabel: string) {
  return toMarkdownTable(
    ['名称', '样本数', probabilityLabel],
    rows.map((row) => [row.name, String(row.count), percent(row.probability)]),
  )
}

function diffRowsTable(rows: DiffRow[]) {
  return toMarkdownTable(
    ['名称', '第一名样本数', '第一名概率', '全体样本数', '全体概率', '差值'],
    rows.map((row) => [
      row.name,
      String(row.championCount),
      percent(row.championProbability),
      String(row.allCount),
      percent(row.allProbability),
      `${(row.diff * 100).toFixed(1)}%`,
    ]),
  )
}

function main() {
  const inputPath = resolve(
    process.argv[2] ?? '/Users/bytedance/Documents/Ascension/experiments/simulation/sim-results-100.json',
  )
  const raw = readFileSync(inputPath, 'utf8')
  const data = JSON.parse(raw) as SimulationFile
  const games = data.games
  const allStrategies = new Set<string>()

  const totalPlayerSamples = games.reduce((sum, game) => sum + game.finalScoreboard.length, 0)

  const allScores: number[] = []
  const allHonors: number[] = []
  const championScores: number[] = []
  const championHonors: number[] = []
  const completedGameEndRounds: number[] = []
  const completedGameEndRoundDistribution = new Map<string, number>()
  const strategyWinMap = new Map<string, number>()

  const winnerSeatMap = new Map<string, number>()

  const allPurchaseByPlayerMap = new Map<string, number>()
  const championPurchaseByPlayerMap = new Map<string, number>()

  const allDefeatByPlayerMap = new Map<string, number>()
  const championDefeatByPlayerMap = new Map<string, number>()

  const allFirstPurchaseMap = new Map<string, number>()
  const championFirstPurchaseMap = new Map<string, number>()

  const allFirstTwoRoundsPurchaseMap = new Map<string, number>()
  const championFirstTwoRoundsPurchaseMap = new Map<string, number>()

  let championSampleCount = 0

  for (const game of games) {
    const winners = new Set(game.winnerIds)

    for (const entry of game.finalScoreboard) {
      allStrategies.add(entry.strategy)
    }

    if (game.gameOver && typeof game.endRoundCount === 'number') {
      completedGameEndRounds.push(game.endRoundCount)
      increment(completedGameEndRoundDistribution, `第 ${game.endRoundCount} 轮`, 1)

      const winner = game.finalScoreboard.find((entry) => winners.has(entry.id))
      if (winner) {
        increment(strategyWinMap, winner.strategy)
      }
    }

    for (const entry of game.finalScoreboard) {
      allScores.push(entry.score)
      allHonors.push(entry.honor)

      const purchases = game.purchases
        .filter((event) => event.playerId === entry.id)
        .sort((a, b) => a.step - b.step)

      const defeats = game.defeats
        .filter((event) => event.playerId === entry.id)
        .sort((a, b) => a.step - b.step)

      const purchasedCards = new Set(purchases.map((event) => event.cardName))
      const defeatedMonsters = new Set(defeats.map((event) => event.cardName))
      const firstTwoRoundsCards = new Set(
        purchases.filter((event) => event.turnNumber <= 2).map((event) => event.cardName),
      )

      for (const cardName of purchasedCards) {
        increment(allPurchaseByPlayerMap, cardName)
      }

      for (const monsterName of defeatedMonsters) {
        increment(allDefeatByPlayerMap, monsterName)
      }

      for (const cardName of firstTwoRoundsCards) {
        increment(allFirstTwoRoundsPurchaseMap, cardName)
      }

      if (purchases[0]) {
        increment(allFirstPurchaseMap, purchases[0].cardName)
      }

      if (winners.has(entry.id)) {
        championSampleCount += 1
        championScores.push(entry.score)
        championHonors.push(entry.honor)

        increment(winnerSeatMap, `第 ${seatFromPlayerId(entry.id)} 位`)

        for (const cardName of purchasedCards) {
          increment(championPurchaseByPlayerMap, cardName)
        }

        for (const monsterName of defeatedMonsters) {
          increment(championDefeatByPlayerMap, monsterName)
        }

        for (const cardName of firstTwoRoundsCards) {
          increment(championFirstTwoRoundsPurchaseMap, cardName)
        }

        if (purchases[0]) {
          increment(championFirstPurchaseMap, purchases[0].cardName)
        }
      }
    }
  }

  for (const strategy of allStrategies) {
    if (!strategyWinMap.has(strategy)) {
      strategyWinMap.set(strategy, 0)
    }
  }

  const winnerSeatRows = rankedRowsFromMap(winnerSeatMap, championSampleCount)
  const championPurchaseRows = rankedRowsFromMap(championPurchaseByPlayerMap, championSampleCount)
  const allPurchaseRows = rankedRowsFromMap(allPurchaseByPlayerMap, totalPlayerSamples)
  const championDefeatRows = rankedRowsFromMap(championDefeatByPlayerMap, championSampleCount)
  const allDefeatRows = rankedRowsFromMap(allDefeatByPlayerMap, totalPlayerSamples)

  const purchaseDiffRows = diffRowsFromMaps(
    championPurchaseByPlayerMap,
    championSampleCount,
    allPurchaseByPlayerMap,
    totalPlayerSamples,
  )

  const defeatDiffRows = diffRowsFromMaps(
    championDefeatByPlayerMap,
    championSampleCount,
    allDefeatByPlayerMap,
    totalPlayerSamples,
  )

  const championFirstPurchaseRows = rankedRowsFromMap(championFirstPurchaseMap, championSampleCount)
  const allFirstPurchaseRows = rankedRowsFromMap(allFirstPurchaseMap, totalPlayerSamples)
  const firstPurchaseDiffRows = diffRowsFromMaps(
    championFirstPurchaseMap,
    championSampleCount,
    allFirstPurchaseMap,
    totalPlayerSamples,
  )

  const championFirstTwoRoundsRows = rankedRowsFromMap(
    championFirstTwoRoundsPurchaseMap,
    championSampleCount,
  )

  const allFirstTwoRoundsRows = rankedRowsFromMap(
    allFirstTwoRoundsPurchaseMap,
    totalPlayerSamples,
  )
  const firstTwoRoundsPurchaseDiffRows = diffRowsFromMaps(
    championFirstTwoRoundsPurchaseMap,
    championSampleCount,
    allFirstTwoRoundsPurchaseMap,
    totalPlayerSamples,
  )
  const endRoundDistributionRows = rankedRowsFromMap(
    completedGameEndRoundDistribution,
    completedGameEndRounds.length,
  )
  const strategyWinRows = rankedRowsFromMap(strategyWinMap, completedGameEndRounds.length)

  const report = `# ${games.length}局 AI 对战统计分析

数据文件：\`${inputPath}\`

## 统计口径

- 胜利规则：同分时末位玩家获胜，因此每局只有 1 个第一名。
- “所有人买牌/击杀怪物概率”按**人**统计，不按局统计。
- 分母：
  - 全体样本数：${totalPlayerSamples}（100 局 × 4 人）
  - 第一名样本数：${championSampleCount}
- 完整结束局数：${completedGameEndRounds.length}
- “前两轮买牌”按 \`turnNumber <= 2\` 统计。

## 平均分

${toMarkdownTable(
  ['指标', '数值'],
  [
    ['平均总分', mean(allScores).toFixed(2)],
    ['平均荣誉分', mean(allHonors).toFixed(2)],
    ['第一名平均总分', mean(championScores).toFixed(2)],
    ['第一名平均荣誉分', mean(championHonors).toFixed(2)],
  ],
)}

## 结束轮次

${toMarkdownTable(
  ['指标', '数值'],
  [
    ['完整结束局数', String(completedGameEndRounds.length)],
    ['平均结束轮次', mean(completedGameEndRounds).toFixed(2)],
  ],
)}

### 结束轮次分布

${rankedRowsTable(endRoundDistributionRows, '结束轮次占比')}

## AI策略胜率

${rankedRowsTable(strategyWinRows, '完整结束局胜率')}

## 第一名开局顺位排序

${rankedRowsTable(winnerSeatRows, '第一名概率')}

## 第一名买牌排序

${rankedRowsTable(championPurchaseRows, '第一名购买概率')}

## 所有人买牌排序（按人）

${rankedRowsTable(allPurchaseRows, '全体购买概率')}

## 第一名击杀怪物排序

${rankedRowsTable(championDefeatRows, '第一名击杀概率')}

## 所有人击杀怪物排序（按人）

${rankedRowsTable(allDefeatRows, '全体击杀概率')}

## 第一名 - 所有人买牌概率差值排序

${diffRowsTable(purchaseDiffRows)}

## 第一名 - 所有人击杀怪物概率差值排序

${diffRowsTable(defeatDiffRows)}

## 第一名买的第一张牌概率排序

${rankedRowsTable(championFirstPurchaseRows, '第一名首购概率')}

## 所有人买的第一张牌概率排序

${rankedRowsTable(allFirstPurchaseRows, '全体首购概率')}

## 第一名 - 所有人第一张牌概率差值排序

${diffRowsTable(firstPurchaseDiffRows)}

## 第一名前两轮买的牌概率排序

${rankedRowsTable(championFirstTwoRoundsRows, '第一名前两轮购买概率')}

## 所有人前两轮买的牌概率排序

${rankedRowsTable(allFirstTwoRoundsRows, '全体前两轮购买概率')}

## 第一名 - 所有人前两轮买牌概率差值排序

${diffRowsTable(firstTwoRoundsPurchaseDiffRows)}
`

  const baseName = basename(inputPath, extname(inputPath))
  const outputPath = join(dirname(inputPath), `${baseName}-analysis.md`)
  writeFileSync(outputPath, report, 'utf8')

  console.log(`分析完成：${outputPath}`)
}

main()
