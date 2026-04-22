import {
  alwaysAvailableIds,
  alwaysAvailableMonsterId,
  buildCenterDeck,
  createInstance,
  getCard,
} from './cards'
import type {
  CardDefinition,
  CardDestination,
  CardInstance,
  CardType,
  Effect,
  Faction,
  GameState,
  PendingChoice,
  PlayerConfig,
  PlayerState,
} from './types'

const CENTER_ROW_SIZE = 6
const STARTING_HAND_SIZE = 5

function shuffle<T>(items: T[]): T[] {
  const next = [...items]

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }

  return next
}

function cloneCards(cards: CardInstance[]): CardInstance[] {
  return cards.map((card) => ({ ...card }))
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    deck: cloneCards(player.deck),
    hand: cloneCards(player.hand),
    discard: cloneCards(player.discard),
    inPlay: cloneCards(player.inPlay),
    constructs: cloneCards(player.constructs),
    voided: cloneCards(player.voided),
  }
}

function clonePendingChoice(choice: PendingChoice | undefined): PendingChoice | undefined {
  if (!choice) {
    return undefined
  }

  switch (choice.type) {
    case 'banish_hand_discard':
    case 'banish_center_row':
    case 'discard_then_draw':
    case 'acquire_from_center':
      return { ...choice }
    case 'choose':
      return {
        ...choice,
        options: choice.options.map((option) => ({
          ...option,
          effects: option.effects.map((effect) => ({ ...effect })),
        })),
      }
  }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map(clonePlayer),
    centerDeck: cloneCards(state.centerDeck),
    centerRow: cloneCards(state.centerRow),
    turn: {
      runes: state.turn.runes,
      power: state.turn.power,
      factionCounts: { ...state.turn.factionCounts },
    },
    log: [...state.log],
    winnerIds: [...state.winnerIds],
    pendingChoice: clonePendingChoice(state.pendingChoice),
    extraTurns: state.extraTurns,
  }
}

function addLog(state: GameState, message: string) {
  state.log = [message, ...state.log].slice(0, 80)
}

function hasPendingChoice(state: GameState) {
  return state.pendingChoice !== undefined
}

function setPendingChoice(state: GameState, choice: PendingChoice) {
  state.pendingChoice = choice
}

function clearPendingChoice(state: GameState) {
  state.pendingChoice = undefined
}

function drawOne(player: PlayerState) {
  if (player.deck.length === 0 && player.discard.length > 0) {
    player.deck = shuffle(player.discard)
    player.discard = []
  }

  const next = player.deck.shift()
  if (next) {
    player.hand.push(next)
  }
}

function drawCards(player: PlayerState, amount: number) {
  for (let index = 0; index < amount; index += 1) {
    drawOne(player)
  }
}

function awardHonor(state: GameState, player: PlayerState, amount: number, reason: string) {
  if (amount <= 0 || state.honorPool <= 0) {
    return
  }

  const gained = Math.min(amount, state.honorPool)
  player.honor += gained
  state.honorPool -= gained
  addLog(state, `${player.name} 获得 ${gained} 点荣誉${reason ? `（${reason}）` : ''}`)
}

function applyEffects(
  state: GameState,
  player: PlayerState,
  effects: Effect[] | undefined,
  source: string,
) {
  if (!effects?.length) {
    return
  }

  for (const effect of effects) {
    switch (effect.type) {
      case 'runes':
        state.turn.runes += effect.amount
        addLog(state, `${player.name} 从 ${source} 获得 ${effect.amount} 点符文`)
        break
      case 'power':
        state.turn.power += effect.amount
        addLog(state, `${player.name} 从 ${source} 获得 ${effect.amount} 点力量`)
        break
      case 'draw':
        if (effect.condition === 'has_artifacts' && player.constructs.length < (effect.threshold ?? 0)) {
          break
        }
        drawCards(player, effect.amount)
        state.turn.cardsDrawnThisTurn = (state.turn.cardsDrawnThisTurn ?? 0) + effect.amount
        addLog(state, `${player.name} 通过 ${source} 抽了 ${effect.amount} 张牌`)
        break
      case 'honor':
        awardHonor(state, player, effect.amount, source)
        break
      case 'power_per_draw': {
        const count = state.turn.cardsDrawnThisTurn ?? 0
        if (count <= 0) {
          break
        }
        const gained = effect.amount * count
        state.turn.power += gained
        addLog(state, `${player.name} 通过 ${source} 获得了 ${gained} 点力量（本回合抽牌 ${count} 张）`)
        break
      }
      case 'banish_hand_discard':
        if (player.hand.length + player.discard.length === 0) {
          break
        }
        setPendingChoice(state, {
          type: 'banish_hand_discard',
          amount: effect.amount,
          optional: effect.optional ?? true,
          source,
        })
        addLog(state, `${player.name} 可以通过 ${source} 放逐手牌或弃牌堆中的牌`)
        break
      case 'banish_hand':
        if (player.hand.length === 0) {
          break
        }
        setPendingChoice(state, {
          type: 'banish_hand',
          amount: effect.amount,
          optional: false,
          source,
        })
        addLog(state, `${player.name} 需要通过 ${source} 放逐手牌中的牌`)
        break
      case 'banish_center_row':
        if (state.centerRow.length === 0) {
          break
        }
        setPendingChoice(state, {
          type: 'banish_center_row',
          amount: effect.amount,
          optional: effect.optional ?? true,
          source,
        })
        addLog(state, `${player.name} 可以通过 ${source} 放逐中心牌列中的牌`)
        break
      case 'discard_then_draw':
        if (player.hand.length === 0) {
          drawCards(player, effect.draw)
          addLog(state, `${player.name} 通过 ${source} 抽了 ${effect.draw} 张牌`)
          break
        }
        setPendingChoice(state, {
          type: 'discard_then_draw',
          discard: effect.discard,
          draw: effect.draw,
          source,
        })
        addLog(state, `${player.name} 需要通过 ${source} 弃牌后再抽牌`)
        break
      case 'defeat_monster_upto_cost': {
        const canDefeatAny = state.centerRow.some((card) => {
          const definition = getCard(card.cardId)
          return definition.type === 'monster' && definition.cost <= effect.cost
        })
        if (!canDefeatAny) {
          break
        }
        setPendingChoice(state, {
          type: 'defeat_monster_upto_cost',
          maxCost: effect.cost,
          optional: false,
          source,
        })
        addLog(state, `${player.name} 可以通过 ${source} 免费击败一个费用 ${effect.cost} 或以下的怪物`)
        break
      }
      case 'acquire_from_center':
        if (
          !state.centerRow.some((card) =>
            matchesAcquireFilter(getCard(card.cardId), effect.maxCost, effect.cardTypes),
          )
        ) {
          break
        }
        setPendingChoice(state, {
          type: 'acquire_from_center',
          maxCost: effect.maxCost,
          cardTypes: effect.cardTypes,
          destination: effect.destination ?? 'discard',
          optional: effect.optional ?? true,
          source,
        })
        addLog(state, `${player.name} 可以通过 ${source} 免费获得中心牌列中的一张牌`)
        break
      case 'acquire_any_center_card': {
        const maxCost = 999
        if (!state.centerRow.some((card) => matchesAcquireFilter(getCard(card.cardId), maxCost, undefined))) {
          break
        }
        setPendingChoice(state, {
          type: 'acquire_from_center',
          maxCost,
          cardTypes: undefined,
          destination: 'discard',
          optional: effect.optional ?? true,
          source,
        })
        addLog(state, `${player.name} 可以通过 ${source} 免费获得中心牌列中的任意卡牌`)
        break
      }
      case 'defeat_any_monster': {
        const anyMonster = state.centerRow.some((card) => getCard(card.cardId).type === 'monster')
        if (!anyMonster) {
          break
        }
        setPendingChoice(state, {
          type: 'defeat_any_monster',
          optional: effect.optional ?? true,
          source,
        })
        addLog(state, `${player.name} 可以通过 ${source} 免费击败中心牌列中的任意怪物`)
        break
      }
      case 'steal_card_from_each_opponent': {
        for (const opponent of state.players) {
          if (opponent.id === player.id || opponent.hand.length === 0) {
            continue
          }
          const index = Math.abs(state.seed) % opponent.hand.length
          state.seed += 1
          const [stolen] = opponent.hand.splice(index, 1)
          if (stolen) {
            player.hand.push(stolen)
            addLog(state, `${player.name} 通过 ${source} 从 ${opponent.name} 手牌中获得了 ${getCard(stolen.cardId).name}`)
          }
        }
        break
      }
      case 'opponent_discard_artifact': {
        for (const opponent of state.players) {
          if (opponent.id === player.id || opponent.constructs.length === 0) {
            continue
          }
          const targetIndex = opponent.constructs
            .map((card, index) => ({ card, index }))
            .sort((left, right) => rateCard(getCard(left.card.cardId)) - rateCard(getCard(right.card.cardId)))[0]
            ?.index
          if (targetIndex === undefined) {
            continue
          }
          const [destroyed] = opponent.constructs.splice(targetIndex, 1)
          if (destroyed) {
            opponent.discard.push(destroyed)
            addLog(
              state,
              `${opponent.name} 通过 ${source} 弃掉了已装备的神器 ${getCard(destroyed.cardId).name}`,
            )
          }
        }
        break
      }
      case 'opponent_destroy_artifacts_except_one': {
        for (const opponent of state.players) {
          if (opponent.id === player.id || opponent.constructs.length <= 1) {
            continue
          }
          const keep = opponent.constructs
            .map((card, index) => ({ card, index }))
            .sort((left, right) => rateCard(getCard(right.card.cardId)) - rateCard(getCard(left.card.cardId)))[0]
          if (!keep) {
            continue
          }
          const remaining = opponent.constructs.filter((_, index) => index !== keep.index)
          opponent.constructs = [opponent.constructs[keep.index]]
          opponent.discard.push(...remaining)
          addLog(state, `${opponent.name} 通过 ${source} 摧毁了除 1 个之外的其他所有神器`)
        }
        break
      }
      case 'honor_per_artifact_faction': {
        const factions = hasAllArtifactsMechana(player)
          ? player.constructs.length > 0
            ? new Set<Faction>(['mechana'])
            : new Set<Faction>()
          : new Set<Faction>(player.constructs.map((card) => getCard(card.cardId).faction))
        const count = factions.size
        if (count > 0) {
          awardHonor(state, player, effect.amount * count, source)
        }
        break
      }
      case 'runes_for_mechana_artifacts':
        // Simplified: treat as normal runes (we don't model restricted currency yet).
        state.turn.runes += effect.amount
        addLog(state, `${player.name} 从 ${source} 获得 ${effect.amount} 点符文（机械神器限定符文，当前按普通符文处理）`)
        break
      case 'power_per_mechana_artifact': {
        const count = hasAllArtifactsMechana(player)
          ? player.constructs.length
          : player.constructs.filter((card) => getCard(card.cardId).faction === 'mechana').length
        if (count <= 0) {
          break
        }
        state.turn.power += count
        addLog(state, `${player.name} 从 ${source} 获得 ${count} 点力量（机械神器数量）`)
        break
      }
      case 'all_artifacts_mechana':
        // Passive marker handled by other effects.
        break
      case 'mechana_artifact_to_hand':
        // Handled during purchase.
        break
      case 'draw_on_mechana_construct_play':
        // Triggered when a Mechana artifact is played.
        break
      case 'artifact_discount':
        state.turn.artifactDiscount = (state.turn.artifactDiscount ?? 0) + effect.amount
        addLog(state, `${player.name} 通过 ${source} 获得了下一次购买神器 -${effect.amount} 符文的折扣`)
        break
      case 'spend_runes':
        if (state.turn.runes < effect.amount) {
          break
        }
        state.turn.runes -= effect.amount
        addLog(state, `${player.name} 通过 ${source} 花费了 ${effect.amount} 点符文`)
        applyEffects(state, player, effect.effects, source)
        break
      case 'extra_turn':
        state.extraTurns += effect.amount
        addLog(state, `${player.name} 通过 ${source} 获得了 ${effect.amount} 个额外回合`)
        break
      case 'copy_hero_effect': {
        const candidates = player.inPlay.filter((card) => {
          const definition = getCard(card.cardId)
          return definition.type === 'hero' && card.cardId !== 'ascia-the-twinned'
        })
        if (candidates.length === 0) {
          break
        }

        const options = candidates.map((card) => {
          const definition = getCard(card.cardId)
          return {
            id: card.instanceId,
            label: definition.name,
            // Copy the printed hero effects only (not alliance bonus).
            effects: definition.effects,
          }
        })

        if (effect.optional ?? true) {
          options.unshift({
            id: 'skip-copy',
            label: '不复制',
            effects: [],
          })
        }

        setPendingChoice(state, {
          type: 'choose',
          label: '选择要复制的英雄效果',
          source,
          options,
        })
        addLog(state, `${player.name} 需要为 ${source} 选择要复制的英雄效果`)
        break
      }
      case 'choose':
        setPendingChoice(state, {
          type: 'choose',
          label: effect.label,
          source,
          options: effect.options,
        })
        addLog(state, `${player.name} 需要为 ${source} 选择一个效果`)
        break
    }

    if (hasPendingChoice(state)) {
      break
    }
  }
}

function removeCard(cards: CardInstance[], instanceId: string): CardInstance | undefined {
  const index = cards.findIndex((card) => card.instanceId === instanceId)
  if (index === -1) {
    return undefined
  }

  return cards.splice(index, 1)[0]
}

function refillCenterRow(state: GameState) {
  while (state.centerRow.length < CENTER_ROW_SIZE && state.centerDeck.length > 0) {
    const next = state.centerDeck.shift()
    if (next) {
      state.centerRow.push(next)
    }
  }
}

function replaceCenterRowSlot(state: GameState, index: number) {
  // Keep other slots stable: replace the acquired/defeated card in-place when possible.
  const next = state.centerDeck.shift()
  if (next) {
    state.centerRow[index] = next
    return
  }

  state.centerRow.splice(index, 1)
}

function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex]
}

function removeCardFromHandOrDiscard(
  player: PlayerState,
  instanceId: string,
): CardInstance | undefined {
  return removeCard(player.hand, instanceId) ?? removeCard(player.discard, instanceId)
}

function moveCardToDestination(
  player: PlayerState,
  card: CardInstance,
  destination: CardDestination,
) {
  switch (destination) {
    case 'discard':
      player.discard.push(card)
      break
    case 'top_deck':
      player.deck.unshift(card)
      break
    case 'hand':
      player.hand.push(card)
      break
  }
}

function matchesAcquireFilter(
  definition: CardDefinition,
  maxCost: number,
  cardTypes: CardType[] | undefined,
) {
  if (definition.type === 'monster') {
    return false
  }

  if (definition.cost > maxCost) {
    return false
  }

  if (cardTypes && !cardTypes.includes(definition.type)) {
    return false
  }

  return true
}

function shouldTriggerFinalRound(state: GameState): boolean {
  return state.honorPool <= 0 || (state.centerDeck.length === 0 && state.centerRow.length < CENTER_ROW_SIZE)
}

function calculateScore(player: PlayerState): number {
  const ownedCards = [
    ...player.deck,
    ...player.hand,
    ...player.discard,
    ...player.inPlay,
    ...player.constructs,
  ]
  const cardHonor = ownedCards.reduce((total, card) => total + getCard(card.cardId).honor, 0)
  return player.honor + cardHonor
}

function finalizeIfNeeded(state: GameState, nextPlayerIndex: number) {
  if (state.finalRoundTriggeredBy === undefined && shouldTriggerFinalRound(state)) {
    state.finalRoundTriggeredBy = state.currentPlayerIndex
    addLog(state, '终局回合已触发，每位其他玩家还会再进行 1 回合')
  }

  if (
    state.finalRoundTriggeredBy !== undefined &&
    nextPlayerIndex === state.finalRoundTriggeredBy
  ) {
    const ranked = [...state.players]
      .map((player) => ({ player, score: calculateScore(player) }))
      .sort((left, right) => right.score - left.score)
    const topScore = ranked[0]?.score ?? 0
    state.winnerIds = ranked
      .filter((entry) => entry.score === topScore)
      .map((entry) => entry.player.id)
    state.gameOver = true
    addLog(state, '游戏结束，已统计最终分数')
  }
}

function startTurn(state: GameState) {
  state.turn = {
    runes: 0,
    power: 0,
    factionCounts: {},
    artifactDiscount: 0,
    firstMonsterDefeatTriggered: false,
    cardsDrawnThisTurn: 0,
  }

  const player = currentPlayer(state)
  applyEffects(state, player, player.constructs.flatMap((card) => getCard(card.cardId).effects), '已部署神器')
  addLog(state, `轮到 ${player.name} 行动`)
}

function hasAllArtifactsMechana(player: PlayerState): boolean {
  return player.constructs.some((card) =>
    getCard(card.cardId).effects?.some((candidate) => candidate.type === 'all_artifacts_mechana'),
  )
}

function isMechanaArtifact(player: PlayerState, definition: CardDefinition): boolean {
  if (definition.type !== 'construct') {
    return false
  }
  return definition.faction === 'mechana' || hasAllArtifactsMechana(player)
}

function triggerOnMechanaArtifactPlayed(state: GameState, player: PlayerState, played: CardDefinition) {
  if (!isMechanaArtifact(player, played)) {
    return
  }

  const drawAmount = player.constructs.reduce((total, card) => {
    const definition = getCard(card.cardId)
    return (
      total +
      (definition.effects?.reduce((sum, effect) => {
        return effect.type === 'draw_on_mechana_construct_play' ? sum + effect.amount : sum
      }, 0) ?? 0)
    )
  }, 0)

  if (drawAmount > 0) {
    drawCards(player, drawAmount)
    state.turn.cardsDrawnThisTurn = (state.turn.cardsDrawnThisTurn ?? 0) + drawAmount
    addLog(state, `${player.name} 通过机械神器联动额外抽了 ${drawAmount} 张牌`)
  }
}

function triggerFirstMonsterDefeatEffects(state: GameState, player: PlayerState) {
  if (state.turn.firstMonsterDefeatTriggered) {
    return
  }

  const honorGain = player.constructs.reduce((total, card) => {
    const definition = getCard(card.cardId)
    const gains = definition.effects?.reduce((sum, effect) => {
      return effect.type === 'honor_on_first_monster_defeat' ? sum + effect.amount : sum
    }, 0)
    return total + (gains ?? 0)
  }, 0)

  if (honorGain > 0) {
    awardHonor(state, player, honorGain, '首次击败怪物奖励')
  }

  state.turn.firstMonsterDefeatTriggered = true
}

function createStarterDeck(seedStart: number): { deck: CardInstance[]; nextSeed: number } {
  const cards: CardInstance[] = []
  let seed = seedStart

  for (let index = 0; index < 8; index += 1) {
    seed += 1
    cards.push(createInstance('apprentice', seed))
  }

  for (let index = 0; index < 2; index += 1) {
    seed += 1
    cards.push(createInstance('militia', seed))
  }

  return {
    deck: shuffle(cards),
    nextSeed: seed,
  }
}

export function createGame(playerConfigs: PlayerConfig[]): GameState {
  let seed = Date.now()
  const players: PlayerState[] = playerConfigs.map((config, index) => {
    const starter = createStarterDeck(seed)
    seed = starter.nextSeed
    const player: PlayerState = {
      id: `player-${index + 1}`,
      name: config.name,
      isAi: config.isAi,
      deck: starter.deck,
      hand: [],
      discard: [],
      inPlay: [],
      constructs: [],
      voided: [],
      honor: 0,
      turnsTaken: 0,
    }
    drawCards(player, STARTING_HAND_SIZE)
    return player
  })

  const center = buildCenterDeck(seed)
  seed = center.nextSeed

  const state: GameState = {
    seed,
    players,
    currentPlayerIndex: 0,
    centerDeck: shuffle(center.deck),
    centerRow: [],
    honorPool: Math.max(30, playerConfigs.length * 30),
    turn: {
      runes: 0,
      power: 0,
      factionCounts: {},
    },
    log: [],
    winnerIds: [],
    gameOver: false,
    extraTurns: 0,
  }

  refillCenterRow(state)
  startTurn(state)
  return state
}

export function getScoreboard(state: GameState) {
  return state.players
    .map((player) => ({
      id: player.id,
      name: player.name,
      isAi: player.isAi,
      score: calculateScore(player),
      honor: player.honor,
      deckSize:
        player.deck.length +
        player.hand.length +
        player.discard.length +
        player.inPlay.length +
        player.constructs.length,
      constructs: player.constructs.length,
    }))
    .sort((left, right) => right.score - left.score)
}

export function playCard(state: GameState, instanceId: string): GameState {
  const next = cloneState(state)
  if (next.gameOver || hasPendingChoice(next)) {
    return next
  }

  const player = currentPlayer(next)
  const card = removeCard(player.hand, instanceId)
  if (!card) {
    return next
  }

  const definition = getCard(card.cardId)
  const alreadyPlayedSameFaction =
    definition.faction !== 'neutral' && (next.turn.factionCounts[definition.faction] ?? 0) > 0

  next.turn.factionCounts[definition.faction] =
    (next.turn.factionCounts[definition.faction] ?? 0) + 1

  if (definition.type === 'construct') {
    player.constructs.push(card)
  } else {
    player.inPlay.push(card)
  }

  addLog(next, `${player.name} 打出了 ${definition.name}`)
  applyEffects(next, player, definition.effects, definition.name)
  if (definition.type === 'construct') {
    triggerOnMechanaArtifactPlayed(next, player, definition)
  }

  if (alreadyPlayedSameFaction && definition.factionBonus) {
    applyEffects(next, player, definition.factionBonus, `${definition.name} 的同盟效果`)
  }

  return next
}

export function playAllCards(state: GameState): GameState {
  let next = cloneState(state)

  while (!next.gameOver && !hasPendingChoice(next)) {
    const player = currentPlayer(next)
    if (player.hand.length === 0) {
      break
    }

    next = playCard(next, player.hand[0].instanceId)
  }

  return next
}

function canAfford(turnValue: number, cost: number) {
  return turnValue >= cost
}

export function acquireCenterCard(state: GameState, instanceId: string): GameState {
  const next = cloneState(state)
  if (next.gameOver || hasPendingChoice(next)) {
    return next
  }

  const player = currentPlayer(next)
  const index = next.centerRow.findIndex((candidate) => candidate.instanceId === instanceId)
  if (index === -1) {
    return next
  }
  const card = next.centerRow[index]

  const definition = getCard(card.cardId)
  const discount =
    definition.type === 'construct' ? Math.min(next.turn.artifactDiscount ?? 0, definition.cost) : 0
  const effectiveCost = definition.cost - discount
  if (definition.type === 'monster' || !canAfford(next.turn.runes, effectiveCost)) {
    return next
  }

  next.turn.runes -= effectiveCost
  if (discount > 0) {
    next.turn.artifactDiscount = Math.max(0, (next.turn.artifactDiscount ?? 0) - discount)
  }
  const hasMechanaToHand = player.constructs.some((owned) =>
    getCard(owned.cardId).effects?.some((effect) => effect.type === 'mechana_artifact_to_hand'),
  )
  if (hasMechanaToHand && isMechanaArtifact(player, definition)) {
    player.hand.push(card)
    addLog(next, `${player.name} 购买了 ${definition.name} 并将其加入手牌`)
  } else {
    player.discard.push(card)
    addLog(next, `${player.name} 购买了 ${definition.name}`)
  }
  replaceCenterRowSlot(next, index)
  return next
}

export function acquireAlwaysAvailable(state: GameState, cardId: string): GameState {
  const next = cloneState(state)
  if (next.gameOver || hasPendingChoice(next) || !alwaysAvailableIds.includes(cardId)) {
    return next
  }

  const player = currentPlayer(next)
  const definition = getCard(cardId)
  if (!canAfford(next.turn.runes, definition.cost)) {
    return next
  }

  next.turn.runes -= definition.cost
  next.seed += 1
  player.discard.push(createInstance(cardId, next.seed))
  addLog(next, `${player.name} 购买了常驻卡 ${definition.name}`)
  return next
}

export function defeatCenterMonster(state: GameState, instanceId: string): GameState {
  const next = cloneState(state)
  if (next.gameOver || hasPendingChoice(next)) {
    return next
  }

  const player = currentPlayer(next)
  const index = next.centerRow.findIndex((candidate) => candidate.instanceId === instanceId)
  if (index === -1) {
    return next
  }
  const card = next.centerRow[index]

  const definition = getCard(card.cardId)
  if (definition.type !== 'monster' || !canAfford(next.turn.power, definition.cost)) {
    return next
  }

  next.turn.power -= definition.cost
  player.voided.push(card)
  addLog(next, `${player.name} 击败了 ${definition.name}`)
  applyEffects(next, player, definition.defeatEffects, `${definition.name} 的击败奖励`)
  triggerFirstMonsterDefeatEffects(next, player)
  replaceCenterRowSlot(next, index)
  return next
}

export function defeatCultist(state: GameState): GameState {
  const next = cloneState(state)
  if (next.gameOver || hasPendingChoice(next)) {
    return next
  }

  const player = currentPlayer(next)
  const definition = getCard(alwaysAvailableMonsterId)
  if (!canAfford(next.turn.power, definition.cost)) {
    return next
  }

  next.turn.power -= definition.cost
  next.seed += 1
  player.voided.push(createInstance(alwaysAvailableMonsterId, next.seed))
  addLog(next, `${player.name} 击败了常驻怪物 ${definition.name}`)
  applyEffects(next, player, definition.defeatEffects, definition.name)
  triggerFirstMonsterDefeatEffects(next, player)
  return next
}

export function activateConstruct(state: GameState, instanceId: string): GameState {
  const next = cloneState(state)
  if (next.gameOver || hasPendingChoice(next)) {
    return next
  }

  const player = currentPlayer(next)
  const construct = removeCard(player.constructs, instanceId)
  if (!construct) {
    return next
  }

  const definition = getCard(construct.cardId)
  if (!definition.activatedEffects?.length) {
    player.constructs.push(construct)
    return next
  }

  if (definition.banishOnActivate) {
    player.voided.push(construct)
  } else {
    player.constructs.push(construct)
  }

  addLog(next, `${player.name} 发动了 ${definition.name}`)
  applyEffects(next, player, definition.activatedEffects, definition.name)
  return next
}

export function endTurn(state: GameState): GameState {
  const next = cloneState(state)
  if (next.gameOver || hasPendingChoice(next)) {
    return next
  }

  const player = currentPlayer(next)
  player.discard.push(...player.hand, ...player.inPlay)
  player.hand = []
  player.inPlay = []
  player.turnsTaken += 1
  drawCards(player, STARTING_HAND_SIZE)

  const willTakeExtraTurn = next.extraTurns > 0
  if (willTakeExtraTurn) {
    next.extraTurns -= 1
    addLog(next, `${player.name} 立即获得一个额外回合`)
  }

  const nextPlayerIndex =
    willTakeExtraTurn ? next.currentPlayerIndex : (next.currentPlayerIndex + 1) % next.players.length

  if (nextPlayerIndex !== next.currentPlayerIndex) {
    finalizeIfNeeded(next, nextPlayerIndex)
  }

  next.currentPlayerIndex = nextPlayerIndex

  if (!next.gameOver) {
    startTurn(next)
  }

  return next
}

export function resolvePendingChoiceWithCard(state: GameState, instanceId: string): GameState {
  const next = cloneState(state)
  if (next.gameOver || !next.pendingChoice) {
    return next
  }

  const player = currentPlayer(next)
  const pending = next.pendingChoice

  switch (pending.type) {
    case 'banish_hand_discard': {
      const card = removeCardFromHandOrDiscard(player, instanceId)
      if (!card) {
        return next
      }

      clearPendingChoice(next)
      addLog(next, `${player.name} 通过 ${pending.source} 放逐了 ${getCard(card.cardId).name}`)
      return next
    }
    case 'banish_hand': {
      const card = removeCard(player.hand, instanceId)
      if (!card) {
        return next
      }

      player.voided.push(card)
      clearPendingChoice(next)
      addLog(next, `${player.name} 通过 ${pending.source} 放逐了手牌中的 ${getCard(card.cardId).name}`)
      return next
    }
    case 'banish_center_row': {
      const index = next.centerRow.findIndex((candidate) => candidate.instanceId === instanceId)
      if (index === -1) {
        return next
      }
      const card = next.centerRow[index]

      clearPendingChoice(next)
      addLog(next, `${player.name} 通过 ${pending.source} 放逐了中心牌列中的 ${getCard(card.cardId).name}`)
      replaceCenterRowSlot(next, index)
      return next
    }
    case 'discard_then_draw': {
      const card = removeCard(player.hand, instanceId)
      if (!card) {
        return next
      }

      player.discard.push(card)
      clearPendingChoice(next)
      addLog(next, `${player.name} 为 ${pending.source} 弃掉了 ${getCard(card.cardId).name}`)
      drawCards(player, pending.draw)
      addLog(next, `${player.name} 通过 ${pending.source} 抽了 ${pending.draw} 张牌`)
      return next
    }
    case 'defeat_monster_upto_cost': {
      const index = next.centerRow.findIndex((candidate) => candidate.instanceId === instanceId)
      if (index === -1) {
        return next
      }
      const card = next.centerRow[index]
      const definition = getCard(card.cardId)
      if (definition.type !== 'monster' || definition.cost > pending.maxCost) {
        return next
      }

      player.voided.push(card)
      clearPendingChoice(next)
      addLog(next, `${player.name} 通过 ${pending.source} 免费击败了 ${definition.name}`)
      applyEffects(next, player, definition.defeatEffects, `${definition.name} 的击败奖励`)
      triggerFirstMonsterDefeatEffects(next, player)
      replaceCenterRowSlot(next, index)
      return next
    }
    case 'defeat_any_monster': {
      const index = next.centerRow.findIndex((candidate) => candidate.instanceId === instanceId)
      if (index === -1) {
        return next
      }
      const card = next.centerRow[index]
      const definition = getCard(card.cardId)
      if (definition.type !== 'monster') {
        return next
      }

      player.voided.push(card)
      clearPendingChoice(next)
      addLog(next, `${player.name} 通过 ${pending.source} 免费击败了 ${definition.name}`)
      applyEffects(next, player, definition.defeatEffects, `${definition.name} 的击败奖励`)
      triggerFirstMonsterDefeatEffects(next, player)
      replaceCenterRowSlot(next, index)
      return next
    }
    case 'acquire_from_center': {
      const index = next.centerRow.findIndex((candidate) => candidate.instanceId === instanceId)
      if (index === -1) {
        return next
      }
      const card = next.centerRow[index]

      const definition = getCard(card.cardId)
      if (!matchesAcquireFilter(definition, pending.maxCost, pending.cardTypes)) {
        return next
      }

      clearPendingChoice(next)
      moveCardToDestination(player, card, pending.destination)
      addLog(next, `${player.name} 通过 ${pending.source} 免费获得了 ${definition.name}`)
      replaceCenterRowSlot(next, index)
      return next
    }
    case 'choose':
      return next
  }
}

export function resolvePendingChoiceOption(state: GameState, optionId: string): GameState {
  const next = cloneState(state)
  if (next.gameOver || next.pendingChoice?.type !== 'choose') {
    return next
  }

  const player = currentPlayer(next)
  const pending = next.pendingChoice
  const option = pending.options.find((candidate) => candidate.id === optionId)
  if (!option) {
    return next
  }

  clearPendingChoice(next)
  addLog(next, `${player.name} 为 ${pending.source} 选择了“${option.label}”`)
  applyEffects(next, player, option.effects, `${pending.source}（${option.label}）`)
  return next
}

export function skipPendingChoice(state: GameState): GameState {
  const next = cloneState(state)
  if (next.gameOver || !next.pendingChoice) {
    return next
  }

  const player = currentPlayer(next)
  const pending = next.pendingChoice

  if (
    pending.type === 'choose' ||
    pending.type === 'discard_then_draw' ||
    (!pending.optional &&
      (pending.type === 'acquire_from_center' ||
        pending.type === 'defeat_any_monster' ||
        pending.type === 'defeat_monster_upto_cost' ||
        pending.type === 'banish_hand' ||
        pending.type === 'banish_hand_discard' ||
        pending.type === 'banish_center_row'))
  ) {
    return next
  }

  clearPendingChoice(next)
  addLog(next, `${player.name} 跳过了 ${pending.source} 的额外效果`)
  return next
}

function estimateEffects(effects: Effect[] | undefined): number {
  if (!effects?.length) {
    return 0
  }

  return effects.reduce((total, effect) => {
    const optionalFactor = 'optional' in effect && effect.optional ? 0.7 : 1
    switch (effect.type) {
      case 'runes':
        return total + effect.amount * 1.3
      case 'power':
        return total + effect.amount * 1.3
      case 'draw':
        return total + effect.amount * 2
      case 'honor':
        return total + effect.amount * 1.8
      case 'banish_hand_discard':
        return total + optionalFactor * 2.4 * effect.amount
      case 'banish_center_row':
        return total + optionalFactor * 1.2 * effect.amount
      case 'banish_hand':
        return total + 2.2 * effect.amount
      case 'discard_then_draw':
        return total + effect.draw * 1.5
      case 'acquire_from_center':
        return total + (effect.maxCost ?? 0) * 1.2
      case 'acquire_any_center_card':
        // Very strong swingy effect; approximate as "gain a good center card".
        return total + optionalFactor * 7
      case 'defeat_any_monster':
        // Strong swingy effect; defeating a monster often grants honor and tempo.
        return total + optionalFactor * 7
      case 'defeat_monster_upto_cost':
        return total + effect.cost * 1.1
      case 'steal_card_from_each_opponent':
        return total + effect.amount * 4
      case 'opponent_discard_artifact':
        return total + effect.amount * 2.5
      case 'opponent_destroy_artifacts_except_one':
        return total + optionalFactor * 3.5
      case 'copy_hero_effect':
        return total + optionalFactor * 3.2
      case 'honor_per_artifact_faction':
        // Scales with construct diversity; treat as a moderate payoff.
        return total + effect.amount * 2.6
      case 'draw_on_mechana_construct_play':
        return total + (effect.oncePerTurn ? 1 : 1.2) * effect.amount * 1.8
      case 'runes_for_mechana_artifacts':
        // Conditional runes spendable on Mechana only, discounted a bit.
        return total + (effect.oncePerTurn ? 1 : 1.1) * effect.amount * 1.0
      case 'power_per_mechana_artifact':
        // Potentially scales high in Mechana-heavy decks.
        return total + (effect.oncePerTurn ? 1 : 1.1) * 4.5
      case 'all_artifacts_mechana':
        // Enables synergies; value is context-dependent.
        return total + 3.5
      case 'mechana_artifact_to_hand':
        // Tempo: immediately usable next turns (or same turn with some effects).
        return total + (effect.oncePerTurn ? 1 : 1.1) * 2.5
      case 'artifact_discount':
        // Next construct purchase cheaper by N runes; modest value.
        return total + effect.amount * 1.1
      case 'power_per_draw':
        // Highly context-dependent; treat as small/moderate.
        return total + effect.amount * 1.4
      case 'honor_on_first_monster_defeat':
        return total + (effect.oncePerTurn ? 1 : 1.1) * effect.amount * 1.6
      case 'spend_runes': {
        // Treat as an exchange: value of the granted effects minus the rune opportunity cost.
        const gained = estimateEffects(effect.effects)
        const paid = effect.amount * 1.3
        return total + Math.max(0, gained - paid)
      }
      case 'extra_turn':
        return total + effect.amount * 7
      case 'choose':
        return (
          total +
          Math.max(...effect.options.map((option) => estimateEffects(option.effects)), 0)
        )
      default:
        // Unknown/unsupported effect types contribute 0 to the heuristic for now.
        return total
    }
  }, 0)
}

function rateCard(definition: CardDefinition): number {
  const base =
    definition.cost * 1.5 +
    definition.honor * 1.8 +
    estimateEffects(definition.effects) +
    estimateEffects(definition.factionBonus) +
    estimateEffects(definition.defeatEffects)

  if (definition.type === 'construct') {
    return base + 3
  }

  if (definition.type === 'monster') {
    return base + 1
  }

  return base
}

function pickWorstCenterRowCard(state: GameState): CardInstance | undefined {
  return [...state.centerRow].sort(
    (left, right) => rateCard(getCard(left.cardId)) - rateCard(getCard(right.cardId)),
  )[0]
}

function pickBestCenterRowCardForAcquire(
  state: GameState,
  maxCost: number,
  cardTypes: CardType[] | undefined,
): CardInstance | undefined {
  return [...state.centerRow]
    .filter((card) => matchesAcquireFilter(getCard(card.cardId), maxCost, cardTypes))
    .sort((left, right) => rateCard(getCard(right.cardId)) - rateCard(getCard(left.cardId)))[0]
}

function pickWeakestPlayerCard(player: PlayerState): CardInstance | undefined {
  const candidates = [...player.hand, ...player.discard]
  return candidates.sort(
    (left, right) => rateCard(getCard(left.cardId)) - rateCard(getCard(right.cardId)),
  )[0]
}

function chooseBestOptionId(state: GameState, pending: Extract<PendingChoice, { type: 'choose' }>) {
  let bestId = pending.options[0]?.id
  let bestScore = Number.NEGATIVE_INFINITY

  for (const option of pending.options) {
    let score = estimateEffects(option.effects)

    for (const effect of option.effects) {
      if (effect.type === 'runes') {
        const bestAffordable = [...state.centerRow, ...alwaysAvailableIds.map((id) => createInstance(id, -1))]
          .map((card) => getCard(card.cardId))
          .filter((card) => card.type !== 'monster' && card.cost <= state.turn.runes + effect.amount)
          .sort((left, right) => rateCard(right) - rateCard(left))[0]
        score += bestAffordable ? rateCard(bestAffordable) : 0
      }

      if (effect.type === 'power') {
        const bestMonster = state.centerRow
          .map((card) => getCard(card.cardId))
          .filter((card) => card.type === 'monster' && card.cost <= state.turn.power + effect.amount)
          .sort((left, right) => rateCard(right) - rateCard(left))[0]
        score += bestMonster ? rateCard(bestMonster) : 0
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestId = option.id
    }
  }

  return bestId
}

function autoResolvePendingChoice(state: GameState): GameState {
  let next = cloneState(state)

  while (next.pendingChoice) {
    const pending = next.pendingChoice
    const player = currentPlayer(next)

    switch (pending.type) {
      case 'banish_hand_discard': {
        const target = pickWeakestPlayerCard(player)
        next = target ? resolvePendingChoiceWithCard(next, target.instanceId) : skipPendingChoice(next)
        break
      }
      case 'banish_hand': {
        const target = [...player.hand].sort(
          (left, right) => rateCard(getCard(left.cardId)) - rateCard(getCard(right.cardId)),
        )[0]
        next = target ? resolvePendingChoiceWithCard(next, target.instanceId) : next
        break
      }
      case 'banish_center_row': {
        const target = pickWorstCenterRowCard(next)
        next = target ? resolvePendingChoiceWithCard(next, target.instanceId) : skipPendingChoice(next)
        break
      }
      case 'discard_then_draw': {
        const target = [...player.hand].sort(
          (left, right) => rateCard(getCard(left.cardId)) - rateCard(getCard(right.cardId)),
        )[0]
        next = target ? resolvePendingChoiceWithCard(next, target.instanceId) : next
        if (next.pendingChoice?.type === 'discard_then_draw') {
          clearPendingChoice(next)
        }
        break
      }
      case 'defeat_monster_upto_cost': {
        const target = [...next.centerRow]
          .filter((card) => {
            const definition = getCard(card.cardId)
            return definition.type === 'monster' && definition.cost <= pending.maxCost
          })
          .sort((left, right) => rateCard(getCard(right.cardId)) - rateCard(getCard(left.cardId)))[0]
        next = target ? resolvePendingChoiceWithCard(next, target.instanceId) : next
        break
      }
      case 'defeat_any_monster': {
        const target = [...next.centerRow]
          .filter((card) => getCard(card.cardId).type === 'monster')
          .sort((left, right) => rateCard(getCard(right.cardId)) - rateCard(getCard(left.cardId)))[0]
        next = target ? resolvePendingChoiceWithCard(next, target.instanceId) : skipPendingChoice(next)
        break
      }
      case 'acquire_from_center': {
        const target = pickBestCenterRowCardForAcquire(next, pending.maxCost, pending.cardTypes)
        next = target ? resolvePendingChoiceWithCard(next, target.instanceId) : skipPendingChoice(next)
        break
      }
      case 'choose': {
        const optionId = chooseBestOptionId(next, pending)
        next = optionId ? resolvePendingChoiceOption(next, optionId) : next
        break
      }
    }
  }

  return next
}

function nextMonsterCandidates(state: GameState): CardInstance[] {
  return state.centerRow
    .filter((card) => {
      const definition = getCard(card.cardId)
      return definition.type === 'monster' && definition.cost <= state.turn.power
    })
    .sort((left, right) => rateCard(getCard(right.cardId)) - rateCard(getCard(left.cardId)))
}

function nextCenterCardCandidates(state: GameState): CardInstance[] {
  return state.centerRow
    .filter((card) => {
      const definition = getCard(card.cardId)
      return definition.type !== 'monster' && definition.cost <= state.turn.runes
    })
    .sort((left, right) => rateCard(getCard(right.cardId)) - rateCard(getCard(left.cardId)))
}

function nextReserveCardCandidates(state: GameState): CardDefinition[] {
  return alwaysAvailableIds
    .map((cardId) => getCard(cardId))
    .filter((card) => card.cost <= state.turn.runes)
    .sort((left, right) => rateCard(right) - rateCard(left))
}

export function runAiStep(state: GameState): GameState {
  let next = cloneState(state)
  if (next.gameOver || !currentPlayer(next).isAi) {
    return next
  }

  if (next.pendingChoice) {
    return autoResolvePendingChoice(next)
  }

  const aiPlayer = currentPlayer(next)
  if (aiPlayer.hand.length > 0) {
    return playCard(next, aiPlayer.hand[0].instanceId)
  }

  const activatableConstructs = currentPlayer(next).constructs.filter(
    (card) => getCard(card.cardId).activatedEffects?.length,
  )
  if (activatableConstructs.length > 0) {
    return activateConstruct(next, activatableConstructs[0].instanceId)
  }

  const affordableMonsters = nextMonsterCandidates(next)
  if (affordableMonsters.length > 0) {
    return defeatCenterMonster(next, affordableMonsters[0].instanceId)
  }

  const affordableCenterCards = nextCenterCardCandidates(next)
  const affordableReserveCards = nextReserveCardCandidates(next)
  const bestCenter = affordableCenterCards[0]
  const bestReserve = affordableReserveCards[0]

  if (bestCenter && (!bestReserve || rateCard(getCard(bestCenter.cardId)) >= rateCard(bestReserve))) {
    return acquireCenterCard(next, bestCenter.instanceId)
  }

  if (bestReserve) {
    return acquireAlwaysAvailable(next, bestReserve.id)
  }

  if (next.turn.power >= getCard(alwaysAvailableMonsterId).cost) {
    return defeatCultist(next)
  }

  return endTurn(next)
}

export function runAiTurn(state: GameState): GameState {
  let next = cloneState(state)

  while (!next.gameOver && currentPlayer(next).isAi) {
    const afterStep = runAiStep(next)
    if (JSON.stringify(afterStep) === JSON.stringify(next)) {
      break
    }
    next = afterStep
  }

  return next
}

export function getPlayableHand(state: GameState): CardInstance[] {
  return currentPlayer(state).hand
}

export function getPendingChoice(state: GameState) {
  return state.pendingChoice
}

export function getCurrentPlayer(state: GameState): PlayerState {
  return currentPlayer(state)
}

export function debugSetTurnResources(state: GameState, runes: number, power: number): GameState {
  const next = cloneState(state)
  if (next.gameOver || hasPendingChoice(next)) {
    return next
  }

  next.turn.runes = Math.max(0, Math.floor(runes))
  next.turn.power = Math.max(0, Math.floor(power))
  addLog(next, `Debug：设置资源为 ${next.turn.runes} 符文 / ${next.turn.power} 力量`)
  return next
}

export function debugAddCardToCenterDeck(state: GameState, cardId: string): GameState {
  const next = cloneState(state)
  if (next.gameOver) {
    return next
  }

  const definition = getCard(cardId)
  next.seed += 1
  // Add to the top of the center deck so it appears next time a slot refills.
  next.centerDeck.unshift(createInstance(cardId, next.seed))
  addLog(next, `Debug：已将 ${definition.name} 放入中央牌堆顶`)
  return next
}

export function getFactionName(faction: Faction): string {
  switch (faction) {
    case 'enlightened':
      return '圣贤'
    case 'lifebound':
      return '命约'
    case 'mechana':
      return '机械'
    case 'void':
      return '虚空'
    case 'neutral':
      return '中立'
  }
}
