import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  alwaysAvailableIds,
  alwaysAvailableMonsterId,
  cardDefinitions,
  cardTypeLabels,
  factionLabels,
  getCard,
} from './game/cards'
import {
  acquireAlwaysAvailable,
  acquireCenterCard,
  activateConstruct,
  createGame,
  defeatCenterMonster,
  defeatCultist,
  endTurn,
  debugAddCardToCenterDeck,
  debugSetTurnResources,
  getCurrentPlayer,
  getPendingChoice,
  getPlayableHand,
  getScoreboard,
  playCard,
  playAllCards,
  resolvePendingChoiceOption,
  resolvePendingChoiceWithCard,
  runAiStep,
  skipPendingChoice,
} from './game/engine'
import type { CardDefinition, GameState, PlayerConfig } from './game/types'

const defaultPlayers: PlayerConfig[] = [
  { name: '玩家 1', isAi: false },
  { name: '电脑 1', isAi: true },
]

function resizePlayers(players: PlayerConfig[], count: number): PlayerConfig[] {
  return Array.from({ length: count }, (_, index) => {
    const existing = players[index]
    if (existing) {
      return existing
    }

    return {
      name: `玩家 ${index + 1}`,
      isAi: false,
    }
  })
}

function getCardClassName(definition: CardDefinition) {
  const factionClass = `faction-${definition.faction}`

  switch (definition.type) {
    case 'hero':
      return `card-hero ${factionClass}`
    case 'construct':
      return `card-construct ${factionClass}`
    case 'monster':
      return `card-monster ${factionClass}`
  }
}

function App() {
  const [playerConfigs, setPlayerConfigs] = useState<PlayerConfig[]>(defaultPlayers)
  const [game, setGame] = useState<GameState>(() => createGame(defaultPlayers))
  const [buyPulse, setBuyPulse] = useState(false)
  const [drawPulse, setDrawPulse] = useState(false)
  const [reservePulse, setReservePulse] = useState(false)
  const [reservePulseCardId, setReservePulseCardId] = useState<string | null>(null)
  const [reservePulseKind, setReservePulseKind] = useState<'buy' | 'defeat'>('buy')
  const [marketPulseKind, setMarketPulseKind] = useState<'buy' | 'defeat'>('buy')
  const [marketPulse, setMarketPulse] = useState(false)
  const [showDiscard, setShowDiscard] = useState(false)
  const [inspectPlayerId, setInspectPlayerId] = useState<string | null>(null)
  const [debugCardName, setDebugCardName] = useState('')
  const [debugRunes, setDebugRunes] = useState('')
  const [debugPower, setDebugPower] = useState('')

  const currentPlayer = getCurrentPlayer(game)
  const pendingChoice = getPendingChoice(game)
  const playableHand = getPlayableHand(game)
  const scoreboard = useMemo(() => getScoreboard(game), [game])
  const latestLog = game.log[0]
  const lastSeenLogHeadRef = useRef<string | null>(null)
  const currentTurnNumber = currentPlayer.turnsTaken + 1
  const discardPreview = useMemo(() => {
    return [...currentPlayer.discard].reverse()
  }, [currentPlayer.discard])
  const pendingCardTargets = useMemo(() => {
    if (!pendingChoice) {
      return []
    }

    if (pendingChoice.type === 'banish_hand_discard') {
      return [
        ...currentPlayer.hand.map((card) => ({
          ...card,
          zoneLabel: '手牌',
        })),
        ...currentPlayer.discard.map((card) => ({
          ...card,
          zoneLabel: '弃牌堆',
        })),
      ]
    }

    if (pendingChoice.type === 'banish_hand') {
      return currentPlayer.hand.map((card) => ({
        ...card,
        zoneLabel: '手牌',
      }))
    }

    if (pendingChoice.type === 'banish_center_row') {
      return game.centerRow.map((card) => ({
        ...card,
        zoneLabel: '中心牌列',
      }))
    }

    if (pendingChoice.type === 'defeat_monster_upto_cost' || pendingChoice.type === 'defeat_any_monster') {
      return game.centerRow.map((card) => ({
        ...card,
        zoneLabel: '中心牌列',
      }))
    }

    if (pendingChoice.type === 'acquire_from_center') {
      return game.centerRow.map((card) => ({
        ...card,
        zoneLabel: '中心牌列',
      }))
    }

    if (pendingChoice.type === 'discard_then_draw') {
      return currentPlayer.hand.map((card) => ({
        ...card,
        zoneLabel: '手牌',
      }))
    }

    return []
  }, [currentPlayer.discard, currentPlayer.hand, game.centerRow, pendingChoice])
  const actionCards = useMemo(
    () =>
      pendingChoice
        ? pendingCardTargets
        : playableHand.map((card) => ({
            ...card,
            zoneLabel: undefined as string | undefined,
          })),
    [pendingCardTargets, pendingChoice, playableHand],
  )

  useEffect(() => {
    if (game.gameOver || !currentPlayer.isAi) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setGame((prev) => runAiStep(prev))
    }, 550)

    return () => window.clearTimeout(timeoutId)
  }, [game, currentPlayer.isAi])

  useEffect(() => {
    const timeouts: number[] = []
    const restartPulse = (setter: (value: boolean) => void, duration = 520) => {
      // Ensures the CSS animation replays even if the previous pulse hasn't finished.
      setter(false)
      window.requestAnimationFrame(() => setter(true))
      timeouts.push(
        window.setTimeout(() => {
          setter(false)
        }, duration),
      )
    }

    const logs = game.log
    const previousHead = lastSeenLogHeadRef.current
    const previousIndex = previousHead ? logs.indexOf(previousHead) : -1
    const newLogs = previousIndex === -1 ? logs : logs.slice(0, previousIndex)
    lastSeenLogHeadRef.current = logs[0] ?? null

    if (newLogs.length === 0) {
      return
    }

    const hasMarketBuy = newLogs.some(
      (entry) =>
        (entry.includes('购买了') || entry.includes('免费获得了')) &&
        !entry.includes('购买了常驻卡'),
    )
    const hasMarketDefeat = newLogs.some(
      (entry) => entry.includes('击败了') && !entry.includes('击败了常驻怪物'),
    )
    const reserveEntry = newLogs.find(
      (entry) => entry.includes('购买了常驻卡') || entry.includes('击败了常驻怪物'),
    )
    const hasDraw = newLogs.some((entry) => entry.includes('抽了'))

    if (hasMarketBuy) {
      setMarketPulseKind('buy')
      restartPulse(setMarketPulse)
      restartPulse(setBuyPulse)
    }

    if (hasMarketDefeat) {
      setMarketPulseKind('defeat')
      restartPulse(setMarketPulse)
    }

    if (reserveEntry) {
      const pulseKind = reserveEntry.includes('击败了常驻怪物') ? 'defeat' : 'buy'
      setReservePulseKind(pulseKind)
      restartPulse(setReservePulse)

      const reserveCardId =
        pulseKind === 'defeat'
          ? alwaysAvailableMonsterId
          : alwaysAvailableIds.find((cardId) => reserveEntry.includes(getCard(cardId).name)) ?? null
      setReservePulseCardId(reserveCardId)

      timeouts.push(
        window.setTimeout(() => {
          setReservePulseCardId(null)
        }, 520),
      )
    }

    if (hasDraw) {
      restartPulse(setDrawPulse)
    }

    return () => {
      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [game.log])

  const humanPlayers = playerConfigs.filter((player) => !player.isAi).length
  const aiPlayers = playerConfigs.filter((player) => player.isAi).length

  const renderGameCard = ({
    cardId,
    instanceId,
    zoneLabel,
    actionLabel,
    onAction,
    disabled,
    extraText,
    compact = false,
    pulse,
  }: {
    cardId: string
    instanceId: string
    zoneLabel?: string
    actionLabel?: string
    onAction?: () => void
    disabled?: boolean
    extraText?: string
    compact?: boolean
    pulse?: 'buy' | 'defeat'
  }) => {
    const definition = getCard(cardId)
    const pulseClass =
      pulse === 'defeat' ? 'card-defeat-pulse' : pulse === 'buy' ? 'card-buy-pulse' : ''
    const cardClassName = `game-card ${getCardClassName(definition)} ${compact ? 'compact-card' : ''} ${pulseClass}`

    const monsterRewardHonor =
      definition.type === 'monster'
        ? definition.defeatEffects?.reduce((sum, effect) => {
            return effect.type === 'honor' ? sum + effect.amount : sum
          }, 0) ?? 0
        : 0
    const honorValue = definition.type === 'monster' ? monsterRewardHonor : definition.honor
    const honorLabel = definition.type === 'monster' ? `奖励 ${honorValue}` : `荣誉 ${honorValue}`

    const body = (
      <>
        <div className="card-cost">{definition.cost}</div>
        <div className="card-header">
          <span className="card-type-pill">{cardTypeLabels[definition.type]}</span>
          <span className="card-faction-pill">{factionLabels[definition.faction]}</span>
        </div>
        <div className="card-body">
          <strong className="card-title">{definition.name}</strong>
          {zoneLabel ? <span className="card-zone">{zoneLabel}</span> : null}
          <p className="card-text">{definition.description}</p>
          {extraText ? <p className="card-subtext">{extraText}</p> : null}
        </div>
        <div className="card-footer">
          <span className="card-honor">{honorLabel}</span>
          {actionLabel ? <span className="card-action-label">{actionLabel}</span> : null}
        </div>
      </>
    )

    if (onAction) {
      return (
        <button
          key={instanceId}
          type="button"
          className={cardClassName}
          disabled={disabled}
          onClick={onAction}
        >
          {body}
        </button>
      )
    }

    return (
      <article key={instanceId} className={cardClassName}>
        {body}
      </article>
    )
  }

  const startGame = () => {
    const sanitized = playerConfigs.map((player, index) => ({
      name: player.name.trim() || (player.isAi ? `电脑 ${index + 1}` : `玩家 ${index + 1}`),
      isAi: player.isAi,
    }))
    setPlayerConfigs(sanitized)
    setGame(createGame(sanitized))
  }

  const updatePlayerCount = (count: number) => {
    setPlayerConfigs((prev) => resizePlayers(prev, count))
  }

  const updatePlayer = (index: number, patch: Partial<PlayerConfig>) => {
    setPlayerConfigs((prev) =>
      prev.map((player, playerIndex) =>
        playerIndex === index ? { ...player, ...patch } : player,
      ),
    )
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Ascension 十周年纪念版</p>
          <h1>暗杀神Ascension</h1>
        </div>
        <div className="stats-strip">
          <div className="stat-card">
            <span>当前行动者</span>
            <strong>{currentPlayer.name}</strong>
            <small>{currentPlayer.isAi ? '电脑正在逐步操作' : '等待玩家操作'}</small>
          </div>
          <div className="stat-card">
            <span>荣誉池</span>
            <strong>{game.honorPool}</strong>
          </div>
          <div className="stat-card">
            <span>额外回合</span>
            <strong>{game.extraTurns}</strong>
          </div>
          <div className="stat-card">
            <span>当前回合数</span>
            <strong>
              第 {currentTurnNumber} 回合
            </strong>
          </div>
        </div>
      </section>

      <div className="table-layout">
        <section className="board-column">
          {pendingChoice ? (
            <section className="panel alert-panel">
              <div className="section-header compact-header">
                <h2>待处理效果</h2>
                <p>{pendingChoice.source}</p>
              </div>
              <div className="banner">
                {pendingChoice.type === 'banish_hand_discard'
                  ? '请选择 1 张手牌或弃牌堆中的牌进行放逐。'
                  : pendingChoice.type === 'banish_hand'
                    ? '请选择 1 张手牌进行放逐。'
                  : pendingChoice.type === 'banish_center_row'
                    ? '请选择 1 张中心牌列中的牌进行放逐。'
                    : pendingChoice.type === 'defeat_monster_upto_cost'
                      ? `请选择 1 个费用 ${pendingChoice.maxCost} 或以下的怪物免费击败。`
                      : pendingChoice.type === 'defeat_any_monster'
                        ? '请选择 1 个怪物免费击败。'
                    : pendingChoice.type === 'acquire_from_center'
                      ? `请选择 1 张费用 ${pendingChoice.maxCost} 或以下的中心牌列卡牌免费获得。`
                      : pendingChoice.type === 'discard_then_draw'
                        ? `请选择 ${pendingChoice.discard} 张手牌弃掉，然后抽 ${pendingChoice.draw} 张牌。`
                        : 'label' in pendingChoice
                          ? pendingChoice.label
                          : ''}
              </div>
            </section>
          ) : null}

          <section
            className={`panel market-panel ${buyPulse ? 'panel-buy-pulse' : ''} ${
              marketPulse ? (marketPulseKind === 'defeat' ? 'panel-defeat-pulse' : 'panel-buy-pulse') : ''
            }`}
          >
            <div className="section-header compact-header">
              <h2>中央牌列</h2>
              <p>英雄与神器用符文购买，怪物用力量击败。</p>
            </div>
            <div className="market-scroll-row center-row-grid">
              {game.centerRow.map((card) => {
                const definition = getCard(card.cardId)
                const canAcquire =
                  !currentPlayer.isAi &&
                  !game.gameOver &&
                  !pendingChoice &&
                  definition.type !== 'monster' &&
                  game.turn.runes >= definition.cost
                const canDefeat =
                  !currentPlayer.isAi &&
                  !game.gameOver &&
                  !pendingChoice &&
                  definition.type === 'monster' &&
                  game.turn.power >= definition.cost
                const actionLabel = definition.type === 'monster' ? '击败' : '购买'

                return renderGameCard({
                  cardId: card.cardId,
                  instanceId: card.instanceId,
                  actionLabel,
                  disabled: !canAcquire && !canDefeat,
                  onAction: () =>
                    setGame((prev) =>
                      definition.type === 'monster'
                        ? defeatCenterMonster(prev, card.instanceId)
                        : acquireCenterCard(prev, card.instanceId),
                    ),
                })
              })}
            </div>
          </section>

          <section
            className={`panel reserve-panel ${reservePulse ? 'panel-buy-pulse' : ''} ${
              reservePulseKind === 'defeat' ? 'panel-defeat-pulse' : ''
            }`}
          >
            <div className="section-header compact-header">
              <h2>常驻牌与怪物</h2>
              <p>这里始终可以买秘法师、重装步兵，或击败邪教徒。</p>
            </div>
            <div className="market-scroll-row reserve-row-grid">
              {alwaysAvailableIds.map((cardId) =>
                renderGameCard({
                  cardId,
                  instanceId: cardId,
                  actionLabel: '购买',
                  pulse: reservePulseCardId === cardId ? reservePulseKind : undefined,
                  disabled:
                    currentPlayer.isAi ||
                    game.gameOver ||
                    Boolean(pendingChoice) ||
                    game.turn.runes < getCard(cardId).cost,
                  onAction: () => setGame((prev) => acquireAlwaysAvailable(prev, cardId)),
                }),
              )}
              {renderGameCard({
                cardId: alwaysAvailableMonsterId,
                instanceId: alwaysAvailableMonsterId,
                actionLabel: '击败',
                pulse: reservePulseCardId === alwaysAvailableMonsterId ? reservePulseKind : undefined,
                disabled:
                  currentPlayer.isAi ||
                  game.gameOver ||
                  Boolean(pendingChoice) ||
                  game.turn.power < getCard(alwaysAvailableMonsterId).cost,
                onAction: () => setGame((prev) => defeatCultist(prev)),
              })}
            </div>
          </section>

          <section className={`panel action-panel ${drawPulse ? 'panel-draw-pulse' : ''}`}>
            <div className="section-header compact-header">
              <h2>{pendingChoice ? '效果处理' : '手牌区'}</h2>
              <p>
                {pendingChoice
                  ? '先完成当前效果，再继续其他操作。'
                  : '当前行动者的手牌放在这里，按横向牌带浏览。'}
              </p>
            </div>

            <div className="hand-status-bar">
              <div className="hand-status-chip">
                <span>荣誉池</span>
                <strong>{game.honorPool}</strong>
              </div>
              <div className="hand-status-chip">
                <span>当前资源</span>
                <strong>
                  {game.turn.runes} 符文 / {game.turn.power} 力量
                </strong>
              </div>
              <div className="hand-status-chip">
                <span>当前回合数</span>
                <strong>第 {currentTurnNumber} 回合</strong>
              </div>
              <div className="hand-status-chip">
                <span>牌库</span>
                <strong>{currentPlayer.deck.length}</strong>
              </div>
              <div className="hand-status-chip">
                <span>弃牌堆</span>
                <strong>{currentPlayer.discard.length}</strong>
              </div>
            </div>

            {!pendingChoice && !currentPlayer.isAi ? (
              <div className="hand-toolbar">
                <button
                  type="button"
                  disabled={game.gameOver || playableHand.length === 0}
                  onClick={() => setGame((prev) => playAllCards(prev))}
                >
                  一键打出所有牌
                </button>
                <button
                  type="button"
                  onClick={() => setGame((prev) => endTurn(prev))}
                  disabled={game.gameOver || Boolean(pendingChoice)}
                >
                  结束回合
                </button>
                <button
                  type="button"
                  disabled={game.gameOver || Boolean(pendingChoice) || currentPlayer.discard.length === 0}
                  onClick={() => setShowDiscard((prev) => !prev)}
                >
                  {showDiscard ? '收起弃牌堆' : '查看弃牌堆'}
                </button>
              </div>
            ) : null}

            {!pendingChoice && currentPlayer.isAi ? (
              <div className="ai-activity-banner">
                <strong>电脑回合执行中</strong>
                <span>{latestLog ?? '正在思考下一步操作...'}</span>
              </div>
            ) : null}

            {!pendingChoice && showDiscard ? (
              <div className="discard-view">
                <div className="discard-view-header">
                  <strong>弃牌堆</strong>
                  <button type="button" onClick={() => setShowDiscard(false)}>
                    关闭
                  </button>
                </div>
                {discardPreview.length === 0 ? (
                  <div className="empty-state inline-empty">弃牌堆为空。</div>
                ) : (
                  <div className="card-strip">
                    {discardPreview.map((card) => renderGameCard({
                      cardId: card.cardId,
                      instanceId: `discard-${card.instanceId}`,
                      compact: true,
                    }))}
                  </div>
                )}
              </div>
            ) : null}

            {pendingChoice?.type === 'choose' ? (
              <div className="card-strip">
                {pendingChoice.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="choice-card"
                    disabled={currentPlayer.isAi || game.gameOver}
                    onClick={() => setGame((prev) => resolvePendingChoiceOption(prev, option.id))}
                  >
                    <strong>{option.label}</strong>
                    <span>{pendingChoice.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="card-strip">
                {actionCards.map((card) =>
                  renderGameCard({
                    cardId: card.cardId,
                    instanceId: card.instanceId,
                    zoneLabel: card.zoneLabel,
                    actionLabel: pendingChoice ? '选择' : '打出',
                    disabled: currentPlayer.isAi || game.gameOver,
                    onAction: () =>
                      setGame((prev) =>
                        pendingChoice
                          ? resolvePendingChoiceWithCard(prev, card.instanceId)
                          : playCard(prev, card.instanceId),
                      ),
                  }),
                )}
                {!pendingChoice && playableHand.length === 0 ? (
                  <div className="empty-state inline-empty">当前没有可打出的手牌。</div>
                ) : null}
              </div>
            )}

            {pendingChoice &&
            (pendingChoice.type === 'banish_hand_discard' ||
              pendingChoice.type === 'banish_center_row' ||
              pendingChoice.type === 'acquire_from_center') ? (
              <div className="action-row single-row">
                <button
                  type="button"
                  disabled={currentPlayer.isAi || game.gameOver}
                  onClick={() => setGame((prev) => skipPendingChoice(prev))}
                >
                  跳过此效果
                </button>
              </div>
            ) : null}
          </section>
        </section>

        <aside className="sidebar-column">
          <details className="panel setup-panel">
            <summary>
              <span>对局设置</span>
              <span>
                {playerConfigs.length} 人局 / {humanPlayers} 真人 / {aiPlayers} 电脑
              </span>
            </summary>
            <div className="setup-content">
              <div className="config-toolbar">
                <label>
                  玩家数量
                  <select
                    value={playerConfigs.length}
                    onChange={(event) => updatePlayerCount(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4].map((count) => (
                      <option key={count} value={count}>
                        {count} 人
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={startGame}>
                  重新开局
                </button>
              </div>
              <div className="player-config-grid compact-config-grid">
                {playerConfigs.map((player, index) => (
                  <div key={`${player.name}-${index}`} className="player-config-card compact-config-card">
                    <h3>席位 {index + 1}</h3>
                    <label>
                      名称
                      <input
                        value={player.name}
                        onChange={(event) => updatePlayer(index, { name: event.target.value })}
                      />
                    </label>
                    <label>
                      身份
                      <select
                        value={player.isAi ? 'ai' : 'human'}
                        onChange={(event) =>
                          updatePlayer(index, { isAi: event.target.value === 'ai' })
                        }
                      >
                        <option value="human">真人</option>
                        <option value="ai">电脑</option>
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </details>

          {import.meta.env.DEV ? (
            <details className="panel compact-panel">
              <summary className="debug-summary">Debug 控制台</summary>

              <div className="config-toolbar">
                <label>
                  卡牌名称
                  <input
                    value={debugCardName}
                    placeholder="输入完整卡名，例如：阿罗拉门徒"
                    onChange={(event) => setDebugCardName(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const name = debugCardName.trim()
                    if (!name) {
                      return
                    }
                    const exact = cardDefinitions.find((card) => card.name === name)
                    const fuzzy = exact
                      ? undefined
                      : cardDefinitions.find((card) => card.name.includes(name))
                    const target = exact ?? fuzzy
                    if (!target) {
                      return
                    }
                    setGame((prev) => debugAddCardToCenterDeck(prev, target.id))
                  }}
                >
                  放入中央牌堆顶
                </button>
              </div>

              <div className="config-toolbar">
                <label>
                  符文
                  <input
                    value={debugRunes}
                    inputMode="numeric"
                    placeholder={`${game.turn.runes}`}
                    onChange={(event) => setDebugRunes(event.target.value)}
                  />
                </label>
                <label>
                  力量
                  <input
                    value={debugPower}
                    inputMode="numeric"
                    placeholder={`${game.turn.power}`}
                    onChange={(event) => setDebugPower(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={Boolean(pendingChoice) || currentPlayer.isAi || game.gameOver}
                  onClick={() => {
                    const runes = debugRunes.trim() === '' ? game.turn.runes : Number(debugRunes)
                    const power = debugPower.trim() === '' ? game.turn.power : Number(debugPower)
                    if (Number.isNaN(runes) || Number.isNaN(power)) {
                      return
                    }
                    setGame((prev) => debugSetTurnResources(prev, runes, power))
                  }}
                >
                  应用资源
                </button>
              </div>
            </details>
          ) : null}

          <section className="panel compact-panel">
            <div className="section-header compact-header">
              <h2>当前回合</h2>
              <p>
                {currentPlayer.name}
                {currentPlayer.isAi ? ' 由电脑控制' : ' 正在操作'}
              </p>
            </div>
            {currentPlayer.isAi ? (
              <div className="ai-status-card">
                <strong>电脑操作可见化</strong>
                <span>{latestLog ?? '等待电脑开始行动'}</span>
              </div>
            ) : null}
            <div className="turn-summary compact-turn-summary">
              <div>
                <span>手牌</span>
                <strong>{currentPlayer.hand.length}</strong>
              </div>
              <div>
                <span>弃牌</span>
                <strong>{currentPlayer.discard.length}</strong>
              </div>
              <div>
                <span>牌库</span>
                <strong>{currentPlayer.deck.length}</strong>
              </div>
              <div>
                <span>击败</span>
                <strong>{currentPlayer.voided.length}</strong>
              </div>
            </div>
            <div className="action-row sidebar-actions">
              <button type="button" onClick={startGame}>
                重开
              </button>
            </div>
            {game.gameOver ? (
              <div className="banner">
                获胜者：
                {scoreboard
                  .filter((entry) => game.winnerIds.includes(entry.id))
                  .map((entry) => entry.name)
                  .join('、')}
              </div>
            ) : null}
            <div className="construct-rack">
              {currentPlayer.constructs.length === 0 ? (
                <div className="empty-state inline-empty">没有已部署神器。</div>
              ) : (
                currentPlayer.constructs.map((card) => {
                  const definition = getCard(card.cardId)
                  return renderGameCard({
                    cardId: card.cardId,
                    instanceId: card.instanceId,
                    actionLabel: definition.activatedEffects?.length ? '发动' : undefined,
                    extraText: definition.activatedDescription,
                    compact: true,
                    disabled:
                      !definition.activatedEffects?.length ||
                      currentPlayer.isAi ||
                      game.gameOver ||
                      Boolean(pendingChoice),
                    onAction: definition.activatedEffects?.length
                      ? () => setGame((prev) => activateConstruct(prev, card.instanceId))
                      : undefined,
                  })
                })
              )}
            </div>
          </section>

          <section className="panel compact-panel">
            <div className="section-header compact-header">
              <h2>分数榜</h2>
              <p>得分 = 荣誉 + 所有已拥有卡牌的印刷荣誉。</p>
            </div>
            <div className="scoreboard compact-scoreboard">
              {scoreboard.map((entry) => (
                <article
                  key={entry.id}
                  className={entry.id === currentPlayer.id ? 'score-card active' : 'score-card'}
                >
                  <header>
                    <strong>{entry.name}</strong>
                    <span>{entry.isAi ? '电脑' : '真人'}</span>
                  </header>
                  <div>得分 {entry.score}</div>
                  <div>荣誉 {entry.honor}</div>
                  <div>牌库 {entry.deckSize}</div>
                  <div>神器 {entry.constructs}</div>
                  <button type="button" onClick={() => setInspectPlayerId(entry.id)}>
                    查看神器
                  </button>
                </article>
              ))}
            </div>
          </section>

          {inspectPlayerId ? (
            <section className="panel compact-panel">
              <div className="section-header compact-header">
                <h2>玩家神器</h2>
                <button type="button" onClick={() => setInspectPlayerId(null)}>
                  关闭
                </button>
              </div>
              {(() => {
                const player = game.players.find((candidate) => candidate.id === inspectPlayerId)
                if (!player) {
                  return <div className="empty-state">未找到该玩家。</div>
                }
                if (player.constructs.length === 0) {
                  return <div className="empty-state">该玩家没有已部署神器。</div>
                }
                return (
                  <div className="card-strip">
                    {player.constructs.map((card) =>
                      renderGameCard({
                        cardId: card.cardId,
                        instanceId: `inspect-${inspectPlayerId}-${card.instanceId}`,
                        compact: true,
                      }),
                    )}
                  </div>
                )
              })()}
            </section>
          ) : null}

          <section className="panel compact-panel log-panel">
            <div className="section-header compact-header">
              <h2>对局日志</h2>
              <p>最近的资源变化与电脑行动记录。</p>
            </div>
            <div className="log-list">
              {game.log.map((entry, index) => (
                <div key={`${entry}-${index}`} className="log-entry">
                  {entry}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  )
}

export default App
