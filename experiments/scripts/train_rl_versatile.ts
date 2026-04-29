import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  chooseRlDecision,
  createGame,
  endTurn,
  getCurrentPlayer,
  getDefaultRlWeightsForStrategy,
  getScoreboard,
  runAiStep,
} from '../../src/game/engine'
import type { RlWeights } from '../../src/game/engine'
import type { AiStrategy, PlayerConfig } from '../../src/game/types'

const RL_STRATEGY: AiStrategy = 'rl-versatile'

const OPPONENT_POOL: Array<{ name: string; aiStrategy: AiStrategy }> = [
  { name: '电脑 标准', aiStrategy: 'standard' },
  { name: '电脑 速刷', aiStrategy: 'speedrun' },
  { name: '电脑 不买秘教士', aiStrategy: 'avoid-mystic-first-8' },
  { name: '电脑 不买重装步兵', aiStrategy: 'avoid-heavy-infantry-first-8' },
]

type CandidateResult = {
  wins: number
  games: number
  winRate: number
  totalScore: number
  totalHonor: number
  avgScore: number
  avgHonor: number
}

type GenerationReport = {
  generation: number
  sigma: number
  populationSize: number
  evalGames: number
  bestWinRate: number
  bestAvgScore: number
  baselineWinRate: number
  baselineAvgScore: number
  improved: boolean
  bestWeights: RlWeights
}

function pickRandomOpponents(count: number): Array<{ name: string; aiStrategy: AiStrategy }> {
  const picked: Array<{ name: string; aiStrategy: AiStrategy }> = []
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(Math.random() * OPPONENT_POOL.length)
    const base = OPPONENT_POOL[index]
    const suffix = picked.filter((p) => p.aiStrategy === base.aiStrategy).length + 1
    picked.push({
      name: suffix > 1 ? `${base.name} ${suffix}` : base.name,
      aiStrategy: base.aiStrategy,
    })
  }
  return picked
}

function buildPlayers(): PlayerConfig[] {
  const rlPlayer: PlayerConfig = { name: 'RL（通用）', isAi: true, aiStrategy: RL_STRATEGY }
  const opponents = pickRandomOpponents(3).map((p) => ({ name: p.name, isAi: true, aiStrategy: p.aiStrategy }))
  const all = [rlPlayer, ...opponents]
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all
}

function runOneGame(weights: RlWeights): { won: boolean; score: number; honor: number } {
  const players = buildPlayers()
  let state = createGame(players)
  const rlPlayerId = state.players.find((p) => p.aiStrategy === RL_STRATEGY)?.id
  if (!rlPlayerId) return { won: false, score: 0, honor: 0 }

  let guard = 0
  while (!state.gameOver && guard < 100000) {
    const cp = getCurrentPlayer(state)
    const next =
      cp.aiStrategy === RL_STRATEGY
        ? (chooseRlDecision(state, weights, 0)?.nextState ?? state)
        : runAiStep(state)
    const stateStr = JSON.stringify(state)
    if (JSON.stringify(next) === stateStr) {
      const forced = endTurn(state)
      if (JSON.stringify(forced) === stateStr) break
      state = forced
    } else {
      state = next
    }
    guard += 1
  }

  const scoreboard = getScoreboard(state)
  const rlEntry = scoreboard.find((e) => e.id === rlPlayerId)
  return {
    won: state.winnerIds.includes(rlPlayerId),
    score: rlEntry?.score ?? 0,
    honor: rlEntry?.honor ?? 0,
  }
}

function evaluateCandidate(weights: RlWeights, games: number): CandidateResult {
  let wins = 0
  let totalScore = 0
  let totalHonor = 0
  for (let i = 0; i < games; i += 1) {
    const result = runOneGame(weights)
    if (result.won) wins += 1
    totalScore += result.score
    totalHonor += result.honor
  }
  return {
    wins,
    games,
    winRate: games > 0 ? wins / games : 0,
    totalScore,
    totalHonor,
    avgScore: games > 0 ? totalScore / games : 0,
    avgHonor: games > 0 ? totalHonor / games : 0,
  }
}

function mutateWeights(base: RlWeights, sigma: number): RlWeights {
  const mutated = { ...base }
  for (const key of Object.keys(mutated) as Array<keyof RlWeights>) {
    const noise = gaussianRandom() * sigma
    mutated[key] = Math.max(-25, Math.min(25, mutated[key] + noise))
  }
  return mutated
}

function gaussianRandom(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function formatVersatileWeightsModule(weights: RlWeights): string {
  const lines = Object.entries(weights).map(([key, value]) => `  ${key}: ${Number(value.toFixed(6))},`)
  return `export const rlVersatileWeights = {\n${lines.join('\n')}\n}\n`
}

function isBetter(a: CandidateResult, b: CandidateResult): boolean {
  if (a.winRate !== b.winRate) return a.winRate > b.winRate
  return a.avgScore > b.avgScore
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const numericArgs = args.filter((arg) => /^-?\d+(\.\d+)?$/.test(arg))
  const generations = Number(numericArgs[0] ?? 20)
  const populationSize = Number(numericArgs[1] ?? 20)
  const evalGames = Number(numericArgs[2] ?? 50)
  const sigma = Number(numericArgs[3] ?? 0.8)
  const sigmaDecay = Number(numericArgs[4] ?? 0.95)

  let baseWeights = getDefaultRlWeightsForStrategy(RL_STRATEGY)
  let currentSigma = sigma
  const reports: GenerationReport[] = []

  console.log(`[versatile] starting versatile RL training`)
  console.log(`[versatile] opponents=random(standard,speedrun,avoid-mystic,avoid-heavy)`)
  console.log(`[versatile] generations=${generations}, population=${populationSize}, evalGames=${evalGames}, sigma=${sigma}`)

  const baselineResult = evaluateCandidate(baseWeights, evalGames)
  console.log(`[versatile] baseline: winRate=${(baselineResult.winRate * 100).toFixed(1)}%, avgScore=${baselineResult.avgScore.toFixed(2)}`)

  for (let gen = 0; gen < generations; gen += 1) {
    const candidates: Array<{ weights: RlWeights; result: CandidateResult }> = []

    for (let i = 0; i < populationSize; i += 1) {
      const mutated = mutateWeights(baseWeights, currentSigma)
      const result = evaluateCandidate(mutated, evalGames)
      candidates.push({ weights: mutated, result })
    }

    candidates.sort((a, b) => (isBetter(a.result, b.result) ? -1 : 1))
    const best = candidates[0]
    const improved = isBetter(best.result, baselineResult)

    const report: GenerationReport = {
      generation: gen + 1,
      sigma: currentSigma,
      populationSize,
      evalGames,
      bestWinRate: best.result.winRate,
      bestAvgScore: best.result.avgScore,
      baselineWinRate: baselineResult.winRate,
      baselineAvgScore: baselineResult.avgScore,
      improved,
      bestWeights: best.weights,
    }
    reports.push(report)

    if (improved) {
      baseWeights = { ...best.weights }
    }

    const weightsPath = resolve(process.cwd(), 'src', 'game', 'rl-weights-versatile.ts')
    writeFileSync(weightsPath, formatVersatileWeightsModule(baseWeights), 'utf8')

    const reportPath = resolve(process.cwd(), 'experiments', 'simulation', 'rl-versatile-training.json')
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          method: 'evolution-strategy-versatile',
          opponents: 'random(standard,speedrun,avoid-mystic,avoid-heavy)',
          generations,
          populationSize,
          evalGames,
          initialSigma: sigma,
          sigmaDecay,
          currentGeneration: gen + 1,
          currentWeights: baseWeights,
          generationHistory: reports.map((r) => ({
            generation: r.generation,
            sigma: r.sigma,
            bestWinRate: r.bestWinRate,
            bestAvgScore: r.bestAvgScore,
            baselineWinRate: r.baselineWinRate,
            baselineAvgScore: r.baselineAvgScore,
            improved: r.improved,
            weights: r.bestWeights,
          })),
        },
        null,
        2,
      ),
      'utf8',
    )

    currentSigma *= sigmaDecay

    console.log(
      `[versatile] gen=${gen + 1}/${generations}, sigma=${currentSigma.toFixed(3)}, ` +
      `best=${(best.result.winRate * 100).toFixed(1)}%/${best.result.avgScore.toFixed(1)}, ` +
      `baseline=${(baselineResult.winRate * 100).toFixed(1)}%, ` +
      `improved=${improved}`
    )
  }

  console.log(`\n[versatile] training complete`)
  console.log(`[versatile] final weights: ${resolve(process.cwd(), 'src', 'game', 'rl-weights-versatile.ts')}`)
  console.log(`[versatile] full report: ${resolve(process.cwd(), 'experiments', 'simulation', 'rl-versatile-training.json')}`)
}

main()
