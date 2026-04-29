import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getCard } from '../../src/game/cards'
import {
  canAcquireCard,
  chooseRlDecision,
  createGame,
  endTurn,
  getCurrentPlayer,
  getDefaultRlWeights,
  getScoreboard,
  runAiStep,
} from '../../src/game/engine'
import type { RlWeights } from '../../src/game/engine'
import type { AiStrategy, GameState, PlayerConfig } from '../../src/game/types'

type TrainingPreset = 'mixed' | 'triple-standard'
type TrainingSummary = ReturnType<typeof trainOneEpisode>

type CheckpointMetrics = {
  preset: TrainingPreset
  games: number
  wins: number
  winRate: number
  topTwoRate: number
  averagePlacement: number
  averageScore: number
  averageHonor: number
}

function shuffleArray<T>(items: T[]): T[] {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }
  return next
}

function isRlPlayersTurn(state: GameState, rlPlayerId: string): boolean {
  const player = getCurrentPlayer(state)
  return player.id === rlPlayerId && player.aiStrategy === 'rl-assassinate-god'
}

function statesEqual(left: GameState, right: GameState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function advanceUntilRlTurn(state: GameState, rlPlayerId: string): GameState {
  let next = state
  let guard = 0

  while (!next.gameOver && !isRlPlayersTurn(next, rlPlayerId) && guard < 10000) {
    const afterStep = runAiStep(next)
    if (statesEqual(afterStep, next)) {
      const forcedEndTurn = endTurn(next)
      if (statesEqual(forcedEndTurn, next)) {
        break
      }
      next = forcedEndTurn
    } else {
      next = afterStep
    }
    guard += 1
  }

  return next
}

function formatWeightValue(value: number): string {
  return Number(value.toFixed(6)).toString()
}

function formatWeightsModule(weights: RlWeights): string {
  const lines = Object.entries(weights).map(([key, value]) => `  ${key}: ${formatWeightValue(value)},`)
  return `export const rlAssassinateGodWeights = {\n${lines.join('\n')}\n}\n`
}

function getPlayerState(state: GameState, playerId: string) {
  return state.players.find((player) => player.id === playerId)
}

function countAffordableCenterBuys(state: GameState) {
  return state.centerRow.filter((card) => {
    const definition = getCard(card.cardId)
    return definition.type !== 'monster' && canAcquireCard(state, definition)
  }).length
}

function countAffordableCenterMonsters(state: GameState) {
  return state.centerRow.filter((card) => {
    const definition = getCard(card.cardId)
    return definition.type === 'monster' && definition.cost <= state.turn.power
  }).length
}

const WEIGHT_CLIP = 25

function clipWeights(weights: RlWeights): void {
  for (const key of Object.keys(weights) as Array<keyof RlWeights>) {
    weights[key] = Math.max(-WEIGHT_CLIP, Math.min(WEIGHT_CLIP, weights[key]))
  }
}

function getTrainingReward(
  state: GameState,
  features: RlWeights,
  rlPlayerId: string,
  nextState: GameState,
): number {
  const previousPlayer = getPlayerState(state, rlPlayerId)
  const nextPlayer = getPlayerState(nextState, rlPlayerId)
  if (!previousPlayer || !nextPlayer) {
    return 0
  }

  const previousScoreboard = getScoreboard(state)
  const nextScoreboard = getScoreboard(nextState)
  const previousScore = previousScoreboard.find((entry) => entry.id === rlPlayerId)?.score ?? 0
  const nextScore = nextScoreboard.find((entry) => entry.id === rlPlayerId)?.score ?? 0
  const previousBestOpponentScore = previousScoreboard
    .filter((entry) => entry.id !== rlPlayerId)
    .reduce((best, entry) => Math.max(best, entry.score), Number.NEGATIVE_INFINITY)
  const nextBestOpponentScore = nextScoreboard
    .filter((entry) => entry.id !== rlPlayerId)
    .reduce((best, entry) => Math.max(best, entry.score), Number.NEGATIVE_INFINITY)
  const leadDelta = (nextScore - nextBestOpponentScore) - (previousScore - previousBestOpponentScore)

  let reward = 0
  reward += (nextScore - previousScore) * 2.0
  reward += leadDelta * 3.0
  reward += (nextPlayer.honor - previousPlayer.honor) * 1.0

  if (features.endTurnPenalty > 0) {
    reward -= state.turn.runes * 0.8
    reward -= state.turn.power * 1.0
    reward -= countAffordableCenterBuys(state) * 3.0
    reward -= countAffordableCenterMonsters(state) * 3.0
    reward -= getCurrentPlayer(state).hand.length * 2.0
  }

  if (features.defeatsCultist > 0 && countAffordableCenterMonsters(state) > 0) {
    reward -= 2.0
  }

  if (nextState.gameOver) {
    const bestScore = nextScoreboard[0]?.score ?? 0
    const myScore = nextScoreboard.find((entry) => entry.id === rlPlayerId)?.score ?? nextPlayer.honor
    const leadBonus = Math.max(0, myScore - nextBestOpponentScore)
    reward += nextState.winnerIds.includes(rlPlayerId) ? 80 + leadBonus * 2 : (myScore - bestScore) * 2.0
  }

  return reward
}

function getPlacement(scoreboard: Array<{ id: string; score: number }>, playerId: string): number {
  const index = scoreboard.findIndex((entry) => entry.id === playerId)
  return index >= 0 ? index + 1 : scoreboard.length
}

function buildTrainingPlayers(preset: TrainingPreset): PlayerConfig[] {
  const rlPlayer: PlayerConfig = { name: 'RL 暗杀神', isAi: true, aiStrategy: 'rl-assassinate-god' }

  const presets: Record<TrainingPreset, Array<{ name: string; aiStrategy: AiStrategy }>> = {
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

  return shuffleArray([
    rlPlayer,
    ...presets[preset].map((player) => ({
      name: player.name,
      isAi: true,
      aiStrategy: player.aiStrategy,
    })),
  ])
}

function runOneGameWithWeights(weights: RlWeights, preset: TrainingPreset, epsilon = 0) {
  const players = buildTrainingPlayers(preset)
  let state = createGame(players)
  const rlPlayerId = state.players.find((player) => player.aiStrategy === 'rl-assassinate-god')?.id
  if (!rlPlayerId) {
    throw new Error('未找到 RL 玩家')
  }

  let guard = 0
  while (!state.gameOver && guard < 100000) {
    const currentPlayer = getCurrentPlayer(state)
    const next =
      currentPlayer.aiStrategy === 'rl-assassinate-god'
        ? (chooseRlDecision(state, weights, epsilon)?.nextState ?? state)
        : runAiStep(state)

    if (statesEqual(next, state)) {
      const forcedEndTurn = endTurn(state)
      if (statesEqual(forcedEndTurn, state)) {
        break
      }
      state = forcedEndTurn
    } else {
      state = next
    }

    guard += 1
  }

  return {
    rlPlayerId,
    gameOver: state.gameOver,
    winnerIds: state.winnerIds,
    scoreboard: getScoreboard(state),
  }
}

function evaluateWeights(weights: RlWeights, preset: TrainingPreset, gameCount: number): CheckpointMetrics {
  let wins = 0
  let topTwoFinishes = 0
  let placementTotal = 0
  let totalScore = 0
  let totalHonor = 0

  for (let gameIndex = 0; gameIndex < gameCount; gameIndex += 1) {
    const result = runOneGameWithWeights(weights, preset, 0)
    const rlEntry = result.scoreboard.find((entry) => entry.id === result.rlPlayerId)
    if (!rlEntry) {
      continue
    }

    totalScore += rlEntry.score
    totalHonor += rlEntry.honor
    const placement = getPlacement(result.scoreboard, result.rlPlayerId)
    placementTotal += placement
    if (placement <= 2) {
      topTwoFinishes += 1
    }
    if (result.winnerIds.includes(result.rlPlayerId)) {
      wins += 1
    }
  }

  return {
    preset,
    games: gameCount,
    wins,
    winRate: gameCount === 0 ? 0 : wins / gameCount,
    topTwoRate: gameCount === 0 ? 0 : topTwoFinishes / gameCount,
    averagePlacement: gameCount === 0 ? 0 : placementTotal / gameCount,
    averageScore: gameCount === 0 ? 0 : totalScore / gameCount,
    averageHonor: gameCount === 0 ? 0 : totalHonor / gameCount,
  }
}

function isBetterCheckpoint(candidate: CheckpointMetrics, best: CheckpointMetrics | undefined) {
  if (!best) {
    return true
  }

  if (candidate.winRate !== best.winRate) {
    return candidate.winRate > best.winRate
  }

  if (candidate.topTwoRate !== best.topTwoRate) {
    return candidate.topTwoRate > best.topTwoRate
  }

  if (candidate.averagePlacement !== best.averagePlacement) {
    return candidate.averagePlacement < best.averagePlacement
  }

  if (candidate.averageScore !== best.averageScore) {
    return candidate.averageScore > best.averageScore
  }

  return candidate.averageHonor > best.averageHonor
}

function trainOneEpisode(
  episodeIndex: number,
  totalEpisodes: number,
  weights: RlWeights,
  alpha: number,
  gamma: number,
  maxSteps: number,
  preset: TrainingPreset,
) {
  const players = buildTrainingPlayers(preset)

  let state = createGame(players)
  const rlPlayerId = state.players.find((player) => player.aiStrategy === 'rl-assassinate-god')?.id
  if (!rlPlayerId) {
    throw new Error('未找到 RL 玩家')
  }

  let rlDecisions = 0
  let steps = 0
  let stateForRl = advanceUntilRlTurn(state, rlPlayerId)
  const epsilon = Math.max(0.05, 0.35 * (1 - episodeIndex / totalEpisodes))

  while (!stateForRl.gameOver && steps < maxSteps) {
    const decision = chooseRlDecision(stateForRl, weights, epsilon)
    if (!decision) {
      break
    }

    const advancedState = advanceUntilRlTurn(decision.nextState, rlPlayerId)
    const nextQValue = advancedState.gameOver
      ? 0
      : (chooseRlDecision(advancedState, weights)?.immediateValue ?? 0)
    const reward = getTrainingReward(stateForRl, decision.features, rlPlayerId, decision.nextState)
    const tdError = reward + gamma * nextQValue - decision.immediateValue

    for (const [key, featureValue] of Object.entries(decision.features)) {
      weights[key as keyof RlWeights] += alpha * tdError * featureValue
    }
    clipWeights(weights)

    state = advancedState
    stateForRl = state
    rlDecisions += 1
    steps += 1
  }

  return {
    rlPlayerId,
    epsilon,
    rlDecisions,
    gameOver: state.gameOver,
    winnerIds: state.winnerIds,
    scoreboard: getScoreboard(state),
  }
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const numericArgs = args.filter((arg) => /^-?\d+(\.\d+)?$/.test(arg))
  const episodes = Number(numericArgs[0] ?? 500)
  const alpha = Number(numericArgs[1] ?? 0.005)
  const gamma = Number(numericArgs[2] ?? 0.95)
  const maxSteps = Number(numericArgs[3] ?? 400)
  const presetArg = args.find((arg) => arg === 'mixed' || arg === 'triple-standard') as
    | TrainingPreset
    | undefined
  const preset: TrainingPreset = presetArg === 'triple-standard' ? 'triple-standard' : 'mixed'
  const checkpointEvery = Number(numericArgs[4] ?? 25)
  const checkpointGames = Number(numericArgs[5] ?? 50)
  const weights = getDefaultRlWeights()
  const startingWeights = { ...weights }
  const summaries: TrainingSummary[] = []
  const checkpoints: Array<{ episode: number; metrics: CheckpointMetrics }> = []
  let bestWeights = { ...weights }
  let bestCheckpoint: { episode: number; metrics: CheckpointMetrics } | undefined

  for (let episodeIndex = 0; episodeIndex < episodes; episodeIndex += 1) {
    const summary = trainOneEpisode(episodeIndex, episodes, weights, alpha, gamma, maxSteps, preset)
    summaries.push(summary)

    const completedEpisodes = episodeIndex + 1
    if (checkpointEvery > 0 && (completedEpisodes % checkpointEvery === 0 || completedEpisodes === episodes)) {
      const metrics = evaluateWeights(weights, preset, checkpointGames)
      const checkpoint = { episode: completedEpisodes, metrics }
      checkpoints.push(checkpoint)
      if (isBetterCheckpoint(metrics, bestCheckpoint?.metrics)) {
        bestCheckpoint = checkpoint
        bestWeights = { ...weights }
      }
      console.log(
        `[checkpoint] episode=${completedEpisodes}, preset=${preset}, winRate=${(metrics.winRate * 100).toFixed(1)}%, avgScore=${metrics.averageScore.toFixed(2)}`,
      )
    }

    if ((episodeIndex + 1) % 50 === 0 || episodeIndex === episodes - 1) {
      console.log(
        `[train-rl] ${episodeIndex + 1}/${episodes} episodes, preset=${preset}, epsilon=${summary.epsilon.toFixed(3)}, decisions=${summary.rlDecisions}`,
      )
    }
  }

  const weightsPath = resolve(process.cwd(), 'src', 'game', 'rl-weights.ts')
  const reportPath = resolve(process.cwd(), 'experiments', 'simulation', 'rl-assassinate-god-training.json')

  writeFileSync(weightsPath, formatWeightsModule(bestWeights), 'utf8')
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        episodes,
        alpha,
        gamma,
        maxSteps,
        preset,
        checkpointEvery,
        checkpointGames,
        startingWeights,
        latestWeights: weights,
        bestWeights,
        bestCheckpoint,
        lastEpisodes: summaries.slice(-10),
        checkpoints,
      },
      null,
      2,
    ),
    'utf8',
  )

  if (bestCheckpoint) {
    console.log(
      `best checkpoint: episode ${bestCheckpoint.episode}, winRate=${(bestCheckpoint.metrics.winRate * 100).toFixed(1)}%, avgScore=${bestCheckpoint.metrics.averageScore.toFixed(2)}`,
    )
  }
  console.log(`updated weights(best): ${weightsPath}`)
  console.log(`training report: ${reportPath}`)
}

main()
