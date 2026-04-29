export type Faction = 'enlightened' | 'lifebound' | 'mechana' | 'void' | 'neutral'

export type AiStrategy =
  | 'standard'
  | 'speedrun'
  | 'avoid-mystic-first-8'
  | 'avoid-heavy-infantry-first-8'
  | 'rl-assassinate-god'
  | 'rl-standard'
  | 'rl-versatile'

export type CardType = 'hero' | 'construct' | 'monster'
export type CardDestination = 'discard' | 'top_deck' | 'hand'

export type Effect =
  | { type: 'runes'; amount: number; oncePerTurn?: boolean }
  | { type: 'power'; amount: number; oncePerTurn?: boolean }
  | { type: 'draw'; amount: number; oncePerTurn?: boolean; condition?: string; threshold?: number }
  | { type: 'honor'; amount: number; oncePerTurn?: boolean }
  | { type: 'banish_hand_discard'; amount: number; optional?: boolean }
  | { type: 'banish_center_row'; amount: number; optional?: boolean }
  | { type: 'banish_center_row_and_hand_discard'; optional?: boolean }
  | { type: 'banish_hand'; amount: number }
  | { type: 'discard_then_draw'; discard: number; draw: number }
  | {
      type: 'acquire_from_center'
      maxCost?: number
      cardTypes?: CardType[]
      destination?: CardDestination
      optional?: boolean
    }
  | { type: 'acquire_any_center_card'; optional?: boolean }
  | { type: 'defeat_any_monster'; optional?: boolean }
  | { type: 'opponent_discard_artifact'; amount: number }
  | { type: 'opponent_destroy_artifacts_except_one'; optional?: boolean }
  | { type: 'steal_card_from_each_opponent'; amount: number }
  | { type: 'defeat_monster_upto_cost'; cost: number }
  | { type: 'copy_hero_effect'; optional?: boolean }
  | { type: 'honor_per_artifact_faction'; amount: number }
  | { type: 'draw_on_mechana_construct_play'; amount: number; oncePerTurn?: boolean }
  | { type: 'runes_for_mechana_artifacts'; amount: number; oncePerTurn?: boolean }
  | { type: 'power_per_mechana_artifact'; oncePerTurn?: boolean }
  | { type: 'all_artifacts_mechana' }
  | { type: 'mechana_artifact_to_hand'; oncePerTurn?: boolean }
  | { type: 'artifact_discount'; amount: number; duration: string }
  | { type: 'power_per_draw'; amount: number }
  | { type: 'honor_on_first_monster_defeat'; amount: number; oncePerTurn?: boolean }
  | {
      type: 'spend_runes'
      amount: number
      effects: Effect[]
    }
  | { type: 'extra_turn'; amount: number }
  | { type: 'choose'; label: string; options: ChoiceOption[] }

export interface ChoiceOption {
  id: string
  label: string
  effects: Effect[]
}

export type PendingChoice =
  | {
      type: 'banish_hand_discard'
      amount: number
      optional: boolean
      source: string
    }
  | {
      type: 'banish_hand'
      amount: number
      optional: boolean
      source: string
    }
  | {
      type: 'banish_center_row'
      amount: number
      optional: boolean
      source: string
    }
  | {
      type: 'banish_center_row_and_hand_discard'
      stage: 'center_row' | 'hand_discard'
      optional: boolean
      source: string
      remainingHandDiscard: boolean
    }
  | {
      type: 'discard_then_draw'
      discard: number
      draw: number
      source: string
    }
  | {
      type: 'defeat_monster_upto_cost'
      maxCost: number
      optional: boolean
      source: string
    }
  | {
      type: 'defeat_any_monster'
      optional: boolean
      source: string
    }
  | {
      type: 'acquire_from_center'
      maxCost: number
      cardTypes?: CardType[]
      destination: CardDestination
      optional: boolean
      source: string
    }
  | {
      type: 'choose'
      label: string
      source: string
      options: ChoiceOption[]
    }

export interface CardDefinition {
  id: string
  name: string
  type: CardType
  faction: Faction
  cost: number
  honor: number
  copies: number
  description: string
  effects: Effect[]
  factionBonus?: Effect[]
  defeatEffects?: Effect[]
  activatedDescription?: string
  activatedEffects?: Effect[]
  banishOnActivate?: boolean
}

export interface CardInstance {
  instanceId: string
  cardId: string
}

export interface TurnState {
  runes: number
  mechanaRunes?: number
  power: number
  factionCounts: Partial<Record<Faction, number>>
  artifactDiscount?: number
  firstMonsterDefeatTriggered?: boolean
  cardsDrawnThisTurn?: number
  activatedConstructIds?: string[]
}

export interface PlayerState {
  id: string
  name: string
  isAi: boolean
  aiStrategy?: AiStrategy
  deck: CardInstance[]
  hand: CardInstance[]
  discard: CardInstance[]
  inPlay: CardInstance[]
  constructs: CardInstance[]
  voided: CardInstance[]
  honor: number
  turnsTaken: number
}

export interface GameState {
  seed: number
  players: PlayerState[]
  currentPlayerIndex: number
  centerDeck: CardInstance[]
  centerRow: CardInstance[]
  reserveSupply: {
    mystic: number
    'heavy-infantry': number
  }
  honorPool: number
  turn: TurnState
  log: string[]
  winnerIds: string[]
  finalRoundTriggeredBy?: number
  gameOver: boolean
  pendingChoice?: PendingChoice
  extraTurns: number
}

export interface PlayerConfig {
  name: string
  isAi: boolean
  aiStrategy?: AiStrategy
}
