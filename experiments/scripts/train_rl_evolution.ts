import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  chooseRlDecision,
  createGame,
  endTurn,
  getCurrentPlayer,
  getDefaultRlWeights,
  getScoreboard,
  runAiStep,
} from '../../src/game/engine'
import type { RlWeights } from '../../src/game/engine'
import type { AiStrategy, PlayerConfig } from '../../src/game/types'

type EvoPreset = 'mixed' | 'triple-standard'

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

function buildPlayers(preset: EvoPreset): PlayerConfig[] {
  const rlPlayer: PlayerConfig = { name: 'RL 暗杀神', isAi: true, aiStrategy: 'rl-assassinate-god' }
  const presets: Record<EvoPreset, Array<{ name: string; aiStrategy: AiStrategy }>> = {
    mixed: [
      { name: '电脑 标准', aiStrategy: 'standard' },
      { name: '电脑 速刷', aiStrategy: 'speedrun' },
      { name: '电脑 不买秘教士', aiStrategy: 'avoid-mystic-first-8' },
    ],
    'triple-standard': [
      { name: '电脑 标准 1', aiStrategy: 'standard' },
      { name: '电脑 标准 2', aiStrategy: 'standard' },
      { name: '电脑 标准 3', aiStrategy: 'standard' },
    ],
  }
  const opponents = presets[preset].map((p) => ({ name: p.name, isAi: true, aiStrategy: p.aiStrategy }))
  const all = [rlPlayer, ...opponents]
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]]
  }
  return all
}

function runOneGame(weights: RlWeights, preset: EvoPreset): { won: boolean; score: number; honor: number } {
  const players = buildPlayers(preset)
  let state = createGame(players)
  const rlPlayerId = state.players.find((p) => p.aiStrategy === 'rl-assassinate-god')?.id
  if (!rlPlayerId) return { won: false, score: 0, honor: 0 }

  let guard = 0
  while (!state.gameOver && guard < 100000) {
    const cp = getCurrentPlayer(state)
    const next = cp.aiStrategy === 'rl-assassinate-god'
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

function evaluateCandidate(weights: RlWeights, preset: EvoPreset, games: number): CandidateResult {
  let wins = 0
  let totalScore = 0
  let totalHonor = 0
  for (let i = 0; i < games; i += 1) {
    const result = runOneGame(weights, preset)
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

function formatWeightsModule(weights: RlWeights): string {
  const lines = Object.entries(weights).map(([key, value]) => `  ${key}: ${Number(value.toFixed(6))},`)
  return `export const rlAssassinateGodWeights = {\n${lines.join('\n')}\n}\n`
}

function isBetter(a: CandidateResult, b: CandidateResult): boolean {
  if (a.winRate !== b.winRate) return a.winRate > b.winRate
  return a.avgScore > b.avgScore
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const numericArgs = args.filter((arg) => /^-?\d+(\.\d+)?$/.test(arg))
  const generations = Number(numericArgs[0] ?? 30)
  const populationSize = Number(numericArgs[1] ?? 20)
  const evalGames = Number(numericArgs[2] ?? 50)
  const sigma = Number(numericArgs[3] ?? 0.8)
  const sigmaDecay = Number(numericArgs[4] ?? 0.95)
  const presetArg = args.find((arg) => arg === 'mixed' || arg === 'triple-standard') as EvoPreset | undefined
  const preset: EvoPreset = presetArg === 'triple-standard' ? 'triple-standard' : 'mixed'

  let baseWeights = getDefaultRlWeights()
  let currentSigma = sigma
  const reports: GenerationReport[] = []

  console.log(`[evo] starting evolution strategy training`)
  console.log(`[evo] preset=${preset}, generations=${generations}, population=${populationSize}, evalGames=${evalGames}, sigma=${sigma}`)

  const baselineResult = evaluateCandidate(baseWeights, preset, evalGames)
  console.log(`[evo] baseline: winRate=${(baselineResult.winRate * 100).toFixed(1)}%, avgScore=${baselineResult.avgScore.toFixed(2)}`)

  for (let gen = 0; gen < generations; gen += 1) {
    const candidates: Array<{ weights: RlWeights; result: CandidateResult }> = []

    for (let i = 0; i < populationSize; i += 1) {
      const mutated = mutateWeights(baseWeights, currentSigma)
      const result = evaluateCandidate(mutated, preset, evalGames)
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

    const weightsPath = resolve(process.cwd(), 'src', 'game', 'rl-weights.ts')
    writeFileSync(weightsPath, formatWeightsModule(baseWeights), 'utf8')

    const reportPath = resolve(process.cwd(), 'experiments', 'simulation', 'rl-evo-training.json')
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          method: 'evolution-strategy',
          preset,
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
      `[evo] gen=${gen + 1}/${generations}, sigma=${currentSigma.toFixed(3)}, ` +
      `best=${(best.result.winRate * 100).toFixed(1)}%/${best.result.avgScore.toFixed(1)}, ` +
      `baseline=${(baselineResult.winRate * 100).toFixed(1)}%, ` +
      `improved=${improved}`
    )
  }

  console.log(`\n[evo] training complete`)
  console.log(`[evo] final weights: ${resolve(process.cwd(), 'src', 'game', 'rl-weights.ts')}`)
  console.log(`[evo] full report: ${resolve(process.cwd(), 'experiments', 'simulation', 'rl-evo-training.json')}`)
}

main()
