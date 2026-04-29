import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGame, endTurn, getScoreboard, runAiStep } from '../../src/game/engine'
import type { AiStrategy, GameState, PlayerConfig } from '../../src/game/types'
import { getCard } from '../../src/game/cards'

type SimulationPreset = 'mixed' | 'triple-standard' | 'quad-avoid-reserve' | 'versatile' | 'versatile-standard' | 'versatile-quad-avoid'

type Zone =
  | 'centerDeck'
  | 'centerRow'
  | 'deck'
  | 'hand'
  | 'discard'
  | 'inPlay'
  | 'constructs'
  | 'voided'

type LocatedInstance = {
  instanceId: string
  cardId: string
  zone: Zone
  playerId?: string
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

type BanishEvent = {
  step: number
  turnNumber: number
  playerId: string
  playerName: string
  kind: 'banish_hand_discard' | 'banish_hand' | 'banish_center_row'
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

function listInstances(state: GameState): LocatedInstance[] {
  const instances: LocatedInstance[] = []

  for (const card of state.centerDeck) {
    instances.push({ instanceId: card.instanceId, cardId: card.cardId, zone: 'centerDeck' })
  }

  for (const card of state.centerRow) {
    instances.push({ instanceId: card.instanceId, cardId: card.cardId, zone: 'centerRow' })
  }

  for (const player of state.players) {
    for (const card of player.deck) {
      instances.push({ instanceId: card.instanceId, cardId: card.cardId, zone: 'deck', playerId: player.id })
    }
    for (const card of player.hand) {
      instances.push({ instanceId: card.instanceId, cardId: card.cardId, zone: 'hand', playerId: player.id })
    }
    for (const card of player.discard) {
      instances.push({
        instanceId: card.instanceId,
        cardId: card.cardId,
        zone: 'discard',
        playerId: player.id,
      })
    }
    for (const card of player.inPlay) {
      instances.push({ instanceId: card.instanceId, cardId: card.cardId, zone: 'inPlay', playerId: player.id })
    }
    for (const card of player.constructs) {
      instances.push({
        instanceId: card.instanceId,
        cardId: card.cardId,
        zone: 'constructs',
        playerId: player.id,
      })
    }
    for (const card of player.voided) {
      instances.push({ instanceId: card.instanceId, cardId: card.cardId, zone: 'voided', playerId: player.id })
    }
  }

  return instances
}

function buildIndex(state: GameState): Map<string, LocatedInstance> {
  const map = new Map<string, LocatedInstance>()
  for (const located of listInstances(state)) {
    map.set(located.instanceId, located)
  }
  return map
}

function getPlayerName(state: GameState, playerId: string): string {
  return state.players.find((player) => player.id === playerId)?.name ?? playerId
}

function shuffleArray<T>(items: T[]): T[] {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }
  return next
}

function buildSimulationPlayers(preset: SimulationPreset): PlayerConfig[] {
  const versatileRlPlayer: PlayerConfig = { name: '电脑 RL（通用）', isAi: true, aiStrategy: 'rl-versatile' }
  const presets: Record<SimulationPreset, { rl: PlayerConfig; opponents: Array<{ name: string; aiStrategy: AiStrategy }> }> = {
    mixed: {
      rl: { name: '电脑 RL 暗杀神', isAi: true, aiStrategy: 'rl-assassinate-god' },
      opponents: [
        { name: '电脑 标准', aiStrategy: 'standard' },
        { name: '电脑 速刷', aiStrategy: 'speedrun' },
        { name: '电脑 不买秘教士', aiStrategy: 'avoid-mystic-first-8' },
      ],
    },
    'triple-standard': {
      rl: { name: '电脑 RL 暗杀神', isAi: true, aiStrategy: 'rl-assassinate-god' },
      opponents: [
        { name: '电脑 标准 1', aiStrategy: 'standard' },
        { name: '电脑 标准 2', aiStrategy: 'standard' },
        { name: '电脑 标准 3', aiStrategy: 'standard' },
      ],
    },
    'quad-avoid-reserve': {
      rl: { name: '电脑 RL 暗杀神', isAi: true, aiStrategy: 'rl-assassinate-god' },
      opponents: [
        { name: '电脑 标准', aiStrategy: 'standard' },
        { name: '电脑 不买秘教士', aiStrategy: 'avoid-mystic-first-8' },
        { name: '电脑 不买重装步兵', aiStrategy: 'avoid-heavy-infantry-first-8' },
      ],
    },
    versatile: {
      rl: versatileRlPlayer,
      opponents: [
        { name: '电脑 标准', aiStrategy: 'standard' },
        { name: '电脑 速刷', aiStrategy: 'speedrun' },
        { name: '电脑 不买秘教士', aiStrategy: 'avoid-mystic-first-8' },
      ],
    },
    'versatile-standard': {
      rl: versatileRlPlayer,
      opponents: [
        { name: '电脑 标准 1', aiStrategy: 'standard' },
        { name: '电脑 标准 2', aiStrategy: 'standard' },
        { name: '电脑 标准 3', aiStrategy: 'standard' },
      ],
    },
    'versatile-quad-avoid': {
      rl: versatileRlPlayer,
      opponents: [
        { name: '电脑 标准', aiStrategy: 'standard' },
        { name: '电脑 不买秘教士', aiStrategy: 'avoid-mystic-first-8' },
        { name: '电脑 不买重装步兵', aiStrategy: 'avoid-heavy-infantry-first-8' },
      ],
    },
  }

  const config = presets[preset]
  return shuffleArray([
    config.rl,
    ...config.opponents.map((player) => ({
      name: player.name,
      isAi: true,
      aiStrategy: player.aiStrategy,
    })),
  ])
}

function simulateOneGame(gameIndex: number, preset: SimulationPreset) {
  const players = buildSimulationPlayers(preset)

  let state = createGame(players)
  const seed = state.seed

  const purchases: PurchaseEvent[] = []
  const banishes: BanishEvent[] = []
  const defeats: DefeatEvent[] = []
  let forceResolvedDeadlocks = 0

  let steps = 0
  const maxSteps = 100000

  while (!state.gameOver && steps < maxSteps) {
    const prev = state
    const prevIndex = buildIndex(prev)
    const prevCenterRowIds = new Set(prev.centerRow.map((card) => card.instanceId))
    const prevPending = prev.pendingChoice
    const prevCurrentPlayer = prev.players[prev.currentPlayerIndex]
    const prevCurrentPlayerId = prevCurrentPlayer?.id ?? 'unknown'
    const currentTurnNumber = (prevCurrentPlayer?.turnsTaken ?? 0) + 1

    const next = runAiStep(prev)
    steps += 1

    // Recover from AI deadlocks so simulations can finish.
    if (JSON.stringify(next) === JSON.stringify(prev)) {
      const recovered = structuredClone(prev) as GameState

      if (recovered.pendingChoice) {
        recovered.pendingChoice = undefined
        recovered.log = [
          `Simulation fallback：清除了未能自动处理的待选择效果`,
          ...recovered.log,
        ].slice(0, 80)
        state = recovered
        forceResolvedDeadlocks += 1
        continue
      }

      const forcedEndTurn = endTurn(prev)
      if (JSON.stringify(forcedEndTurn) !== JSON.stringify(prev)) {
        state = forcedEndTurn
        forceResolvedDeadlocks += 1
        continue
      }

      state = recovered
      recovered.gameOver = true
      recovered.log = [
        `Simulation fallback：无法继续推进，本局被强制终止`,
        ...recovered.log,
      ].slice(0, 80)
      break
    }

    const nextIndex = buildIndex(next)
    const nextCenterRowIds = new Set(next.centerRow.map((card) => card.instanceId))

    // 1) Purchases / free acquires from center row: a card leaves centerRow and appears in a player's zones.
    for (const instanceId of prevCenterRowIds) {
      if (nextCenterRowIds.has(instanceId)) {
        continue
      }
      const from = prevIndex.get(instanceId)
      const to = nextIndex.get(instanceId)
      if (!from) {
        continue
      }
      if (to && to.playerId && (to.zone === 'discard' || to.zone === 'hand' || to.zone === 'deck')) {
        const playerId = to.playerId
        const playerName = getPlayerName(next, playerId)
        const cardName = getCard(from.cardId).name
        const spentRunes = prev.turn.runes > next.turn.runes
        purchases.push({
          step: steps,
          turnNumber: currentTurnNumber,
          playerId,
          playerName,
          kind: spentRunes ? 'buy_center' : 'free_acquire',
          cardId: from.cardId,
          cardName,
        })
      }
    }

    // 2) Reserve purchases and cultist defeats: new instance appears in player zones.
    for (const [instanceId, located] of nextIndex.entries()) {
      if (prevIndex.has(instanceId)) {
        continue
      }
      if (!located.playerId) {
        continue
      }
      const def = getCard(located.cardId)
      const playerId = located.playerId
      const playerName = getPlayerName(next, playerId)

      if (def.type === 'monster' && located.zone === 'voided') {
        defeats.push({
          step: steps,
          turnNumber: currentTurnNumber,
          playerId,
          playerName,
          cardId: located.cardId,
          cardName: def.name,
        })
        continue
      }

      if (def.type !== 'monster' && (located.zone === 'discard' || located.zone === 'hand' || located.zone === 'deck')) {
        purchases.push({
          step: steps,
          turnNumber: currentTurnNumber,
          playerId,
          playerName,
          kind: 'buy_reserve',
          cardId: located.cardId,
          cardName: def.name,
        })
      }
    }

    // 3) Center row defeats: card leaves centerRow and appears in player's voided as a monster.
    for (const instanceId of prevCenterRowIds) {
      if (nextCenterRowIds.has(instanceId)) {
        continue
      }
      const from = prevIndex.get(instanceId)
      const to = nextIndex.get(instanceId)
      if (!from || !to || to.zone !== 'voided' || !to.playerId) {
        continue
      }
      const def = getCard(from.cardId)
      if (def.type !== 'monster') {
        continue
      }
      defeats.push({
        step: steps,
        turnNumber: currentTurnNumber,
        playerId: to.playerId,
        playerName: getPlayerName(next, to.playerId),
        cardId: from.cardId,
        cardName: def.name,
      })
    }

    // 4) Banish tracking driven by the pendingChoice that just resolved.
    if (prevPending && !next.pendingChoice) {
      const kind = prevPending.type
      if (kind === 'banish_center_row') {
        // Identify which center-row instance disappeared without being relocated.
        for (const instanceId of prevCenterRowIds) {
          if (nextCenterRowIds.has(instanceId)) {
            continue
          }
          const to = nextIndex.get(instanceId)
          if (to) {
            continue
          }
          const from = prevIndex.get(instanceId)
          if (!from) {
            continue
          }
          banishes.push({
            step: steps,
            turnNumber: currentTurnNumber,
            playerId: prevCurrentPlayerId,
            playerName: getPlayerName(prev, prevCurrentPlayerId),
            kind: 'banish_center_row',
            cardId: from.cardId,
            cardName: getCard(from.cardId).name,
          })
          break
        }
      }

      if (kind === 'banish_hand' || kind === 'banish_hand_discard') {
        const prevPlayer = prev.players.find((p) => p.id === prevCurrentPlayerId)
        const nextPlayer = next.players.find((p) => p.id === prevCurrentPlayerId)
        if (prevPlayer && nextPlayer) {
          const prevIds = new Set(
            [...prevPlayer.hand, ...prevPlayer.discard].map((card) => card.instanceId),
          )
          const nextIds = new Set(
            [...nextPlayer.hand, ...nextPlayer.discard].map((card) => card.instanceId),
          )
          const removed = [...prevIds].find((id) => !nextIds.has(id))
          if (removed) {
            const removedInfo = prevIndex.get(removed)
            if (removedInfo) {
              banishes.push({
                step: steps,
                turnNumber: currentTurnNumber,
                playerId: prevCurrentPlayerId,
                playerName: getPlayerName(prev, prevCurrentPlayerId),
                kind,
                cardId: removedInfo.cardId,
                cardName: getCard(removedInfo.cardId).name,
              })
            }
          }
        }
      }
    }

    state = next
  }

  const finalScoreboard = getScoreboard(state).map((entry) => ({
    id: entry.id,
    name: entry.name,
    isAi: entry.isAi,
    strategy: (state.players.find((p) => p.id === entry.id)?.aiStrategy ?? 'standard') as AiStrategy,
    score: entry.score,
    honor: entry.honor,
    deckSize: entry.deckSize,
    constructs: entry.constructs,
  }))

  return {
    gameIndex,
    seed,
    steps,
    gameOver: state.gameOver,
    endRoundCount: Math.max(...state.players.map((player) => player.turnsTaken), 0),
    terminationReason: state.gameOver ? 'completed' : steps >= maxSteps ? 'max_steps' : 'forced_abort',
    forceResolvedDeadlocks,
    winnerIds: state.winnerIds,
    finalScoreboard,
    purchases,
    banishes,
    defeats,
  }
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const numericArg = args.find((arg) => /^\d+$/.test(arg))
  const presetArg = args.find((arg) =>
    arg === 'mixed' || arg === 'triple-standard' || arg === 'quad-avoid-reserve' || arg === 'versatile' || arg === 'versatile-standard' || arg === 'versatile-quad-avoid',
  )
  const gameCount = Number(numericArg ?? 100)
  const validPresets: SimulationPreset[] = ['mixed', 'triple-standard', 'quad-avoid-reserve', 'versatile', 'versatile-standard', 'versatile-quad-avoid']
  const preset: SimulationPreset = validPresets.includes(presetArg as SimulationPreset) ? (presetArg as SimulationPreset) : 'triple-standard'
  const games = Array.from({ length: gameCount }, (_, index) => simulateOneGame(index + 1, preset))
  const outputFileName =
    preset === 'mixed' ? `sim-results-${gameCount}.json` : `sim-results-${gameCount}-${preset}.json`
  const outputPath = resolve(process.cwd(), 'experiments', 'simulation', outputFileName)
  writeFileSync(
    outputPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), preset, games }, null, 2),
    'utf8',
  )
  console.log(`Wrote ${games.length} games to ${outputPath}`)
}

main()
