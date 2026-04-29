# RL 暗杀神策略：训练方法与最终版本

本文总结本项目中 `rl-assassinate-god`（RL 暗杀神）AI 策略的实现方式、训练迭代过程、效果提升路径，以及最终使用的完整策略与权重。

## 目标与评估方式

目标在迭代过程中逐步收敛为：
- 训练与评估都在 `triple-standard` 环境：`1` 个 RL 玩家 vs `3` 个标准 AI。
- 主要优化指标：胜率（win rate）。
- 次要指标：平均分（avg score）。
- 交付要求：可在网页交互里选择并实际生效。

评估脚本与入口：
- 模拟对局脚本：`npm run simulate:ai:triple-standard -- <局数>`，实现见 [simulate_ai.ts](file:///Users/bytedance/Documents/Ascension/experiments/scripts/simulate_ai.ts)。
- 策略权重：见 [rl-weights.ts](file:///Users/bytedance/Documents/Ascension/src/game/rl-weights.ts)。

## 最终策略（线上生效版本）

最终策略是“线性打分 + 一步前瞻”的决策器：
- 将每个可选动作（出牌、发动神器、购买、击败、处理待选择、结束回合等）映射为一组特征 `features`。
- 用 `qValue = dot(weights, features) + lookahead(下一轮自己的机会价值)` 进行排序，取最高的动作。

核心实现位置：
- RL 权重默认值：`getDefaultRlWeights()`，见 [engine.ts](file:///Users/bytedance/Documents/Ascension/src/game/engine.ts#L1721-L1723)。
- RL 决策与评估：`chooseRlDecision()` / `evaluateRlDecisions()`，见 [engine.ts](file:///Users/bytedance/Documents/Ascension/src/game/engine.ts)。
- 权重来源：`rlAssassinateGodWeights`，见 [rl-weights.ts](file:///Users/bytedance/Documents/Ascension/src/game/rl-weights.ts)。

网页 UI 接入位置：
- 在策略下拉框中选择 `RL 暗杀神` 后，该玩家走 `rl-assassinate-god` 分支，见 [App.tsx](file:///Users/bytedance/Documents/Ascension/src/App.tsx)。

### 动作空间（AI 可选操作）

RL 评估的动作类型（简化描述）包括：
- `play_card`：打出手牌。
- `activate_construct`：发动已部署神器（每回合每张神器最多一次）。
- `acquire_center`：用符文购买中央牌列的英雄/神器。
- `defeat_center_monster`：用力量击败中央牌列的怪物。
- `acquire_reserve`：购买常驻牌（秘教士、重装步兵，受库存限制）。
- `defeat_cultist`：击败常驻怪物邪教徒。
- `resolve_pending_* / skip_pending`：处理待选择效果。
- `end_turn`：结束回合。

### 特征设计（Feature Vector）

当前 RL 使用的特征键集合由权重文件决定（即 `rlFeatureKeys = Object.keys(rlAssassinateGodWeights)`），实现见 [engine.ts](file:///Users/bytedance/Documents/Ascension/src/game/engine.ts)。

特征覆盖了几类信号：
- 立即收益：本步带来的分数/荣誉/资源变化、抽牌、是否击败怪物等。
- 目标质量：购买/击败目标的启发式价值（如 `targetCardValue`、`targetMonsterValue`）。
- 回合管理：剩余手牌、资源浪费惩罚、结束回合惩罚。
- 行为偏好：是否更倾向从常驻区购买、是否在能打怪时避免打邪教徒等。
- 派系联动：虚空、机械联动计数。

### 一步前瞻（One-step Lookahead）

为了避免“只看眼前”的短视行为，RL 在评估动作时会估计：
- 采取该动作后的状态，在继续推进直到“再次轮到自己”时的机会价值，并按折扣加入 Q 值（折扣与步数上限在 [engine.ts](file:///Users/bytedance/Documents/Ascension/src/game/engine.ts) 内配置）。

## 训练方法与迭代过程

训练在本项目经历了两条路线：
- TD(0) 风格的 Q-learning（后来发现易退化）。
- 进化策略（Evolution Strategy, ES），直接以胜率为优化目标（最终采用）。

### 阶段 1：Q-learning / TD(0)（用于探索可行解）

脚本：见 [train_rl_strategy.ts](file:///Users/bytedance/Documents/Ascension/experiments/scripts/train_rl_strategy.ts)。

关键做法：
- 策略：`epsilon-greedy`，对 RL 玩家在训练时加入一定探索（`epsilon`）。
- 更新：TD(0) 近似，通过 `reward + gamma * V(next)` 驱动权重调整。
- 稳定性措施：
  - 权重裁剪：`clipWeights()`，把每个权重夹在 `[-25, 25]`，见 [train_rl_strategy.ts](file:///Users/bytedance/Documents/Ascension/experiments/scripts/train_rl_strategy.ts#L97-L103)。
  - 周期性 checkpoint：用固定局数评估并保存最优权重（避免“训练越久越差”时丢失最好结果）。
- 训练环境：
  - 引入 `triple-standard` 预设：1 RL vs 3 标准 AI，见 [train_rl_strategy.ts](file:///Users/bytedance/Documents/Ascension/experiments/scripts/train_rl_strategy.ts#L161-L185)。

出现的问题（也是后续切换 ES 的原因）：
- 最优 checkpoint 经常出现在较早的 episode（例如 25 左右），继续训练反而退化。
- 根因是 TD 训练在最小化某种“自定义价值误差”，并不等价于“提高胜率/排名”，而且多智能体环境方差较大，reward 设计稍不稳就会把权重推向坏方向。

当时做过的关键改进（提升稳定性与可学性）：
- 简化 reward：主要用“分数增量、领先对手增量、荣誉增量”，并加入终局奖励，见 [train_rl_strategy.ts](file:///Users/bytedance/Documents/Ascension/experiments/scripts/train_rl_strategy.ts#L105-L153)。
- 加入回合浪费惩罚与结束回合惩罚：减少“留资源/不花完/不处理手牌”的策略。
- 引入构筑物发动限制：每回合每张神器只能发动一次，避免非法或异常循环收益。
- 引入一步前瞻：让策略更像“行动价值评估”而不是纯贪心。

### 阶段 2：进化策略（最终采用）

脚本：见 [train_rl_evolution.ts](file:///Users/bytedance/Documents/Ascension/experiments/scripts/train_rl_evolution.ts)。

核心思想：
- 直接把“胜率（主）+ 平均分（辅）”作为适应度函数。
- 每一代从当前 `baseWeights` 产生多个带噪声的候选权重（高斯扰动）。
- 用固定对局数评估每个候选，选出最优者与 baseline 对比，若更好则替换 `baseWeights`。
- `sigma` 逐代衰减（从大步探索逐步收敛）。
- 每一代都会把当前权重写回 `src/game/rl-weights.ts`，并把完整训练历史写到 `experiments/simulation/rl-evo-training.json`，防止中断丢数据，见 [train_rl_evolution.ts](file:///Users/bytedance/Documents/Ascension/experiments/scripts/train_rl_evolution.ts#L195-L229)。

为什么 ES 效果更好：
- 优化目标与真实目标一致：直接对 win rate 做选择压力。
- 对 reward 设计不敏感：不需要构造一个“能被 TD 学对”的细粒度奖励。
- 更适合本项目这种“线性权重 + 启发式特征”的策略形态。

训练命令入口（来自 [package.json](file:///Users/bytedance/Documents/Ascension/package.json)）：

```bash
# ES 训练：triple-standard
npm run train:evo:triple-standard -- <generations> <populationSize> <evalGames> <sigma> <sigmaDecay>

# 例子：20 代、每代 20 个候选、每候选评估 50 局、sigma=0.8、衰减=0.95
npm run train:evo:triple-standard -- 20 20 50 0.8 0.95
```

## 效果提升路径（按时间线摘要）

整体是“先跑通策略形态，再把目标对齐到胜率，再做稳定性与可解释性”的过程：
- 先把 RL 策略类型接入引擎与 UI，使权重文件可热替换并能跑仿真。
- 在 TD 路线中，用 reward 简化、权重裁剪、checkpoint、防死锁推进等手段，让训练产出“可用的权重”。
- 观察到 TD 的最优点很早出现且后续退化后，改用 ES 直接优化胜率。
- ES 训练过程中，按代保存权重与报告，最终选择 `gen20` 的权重写入线上权重文件。

## 最终权重（gen20，上线版本）

权重文件：见 [rl-weights.ts](file:///Users/bytedance/Documents/Ascension/src/game/rl-weights.ts)。

```ts
export const rlAssassinateGodWeights = {
  bias: 22.347076,
  immediateScore: 4.303752,
  immediateHonor: 0.335465,
  immediateRunes: 1.07881,
  immediatePower: 2.460259,
  drawCards: 4.225836,
  starterTrashRemoved: 3.737204,
  targetCardValue: 3.230746,
  targetMonsterValue: -6.476882,
  gainsConstruct: 1.952975,
  gainsHero: 2.401804,
  defeatsMonster: 5.180428,
  defeatsCultist: -4.56994,
  defeatsFallenGod: 17.343242,
  pendingResolved: -0.228963,
  endTurnPenalty: -4.733528,
  resourceWasteRunes: -2.922214,
  resourceWastePower: -4.278414,
  handCardsLeft: -1.530793,
  reserveInsteadOfCenterPenalty: 3.924041,
  cultistInsteadOfMonsterPenalty: -6.159261,
  voidSynergy: 1.440472,
  mechanaSynergy: 1.578516,
  reserveMysticPenalty: -6.834768,
  reserveHeavyInfantryBonus: -4.372008,
}
```

## 最终评估结果（对话内使用的基准）

在 `triple-standard` 环境做的 200 局评估（gen20 权重）：
- RL 暗杀神：胜率 `60%`，平均分 `81.17`。

说明：
- 训练、引擎规则、常驻库存限制、中央牌堆重洗规则等都会影响对局分布，因此当规则更新后，建议重新跑同样的评估脚本对齐新基准。

