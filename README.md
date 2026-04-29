# Ascension

一个基于 `React + TypeScript + Vite` 的《Ascension 十周年纪念版》网页实现，包含：

- 可直接游玩的单机对局界面
- 多种电脑策略
- RL 权重实验、模拟对战与统计分析脚本

## 项目特点

- 支持 `1-4` 人对局配置
- 支持真人与 AI 混合开局
- 包含 `standard`、`speedrun`、`rl-assassinate-god`、`rl-versatile` 等策略
- 内置对局日志、分数榜、弃牌查看与开发调试面板

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发环境

```bash
npm run dev
```

默认会启动本地开发服务器，打开终端输出中的地址即可访问。

### 3. 打包生产版本

```bash
npm run build
```

### 4. 本地预览

```bash
npm run preview
```

## 常用脚本

### 前端运行

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

### AI 模拟与训练

```bash
# 标准三 AI 环境模拟
npm run simulate:ai:triple-standard -- 100

# RL 训练
npm run train:rl:triple-standard -- 500 0.005 0.95 400 25 50

# 进化策略训练
npm run train:evo:triple-standard -- 20 20 50 0.8 0.95

# 通用 RL 训练
npm run train:versatile -- 20 20 50 0.8 0.95
```

## 目录结构

```text
Ascension/
├── public/               # 静态资源
├── src/
│   ├── game/             # 游戏规则、卡牌定义、AI 权重
│   ├── App.tsx           # 主界面
│   └── main.tsx          # 应用入口
├── experiments/          # 与游戏本体分离的实验/分析资料
│   ├── docs/             # 卡表与研究文档
│   ├── scripts/          # 模拟、训练、分析脚本
│   └── simulation/       # 训练输出与对战结果
└── package.json
```

## 游戏代码位置

- 游戏核心规则在 `src/game/`
- 页面交互与 UI 在 `src/App.tsx`
- RL 权重文件在 `src/game/rl-weights.ts` 和 `src/game/rl-weights-versatile.ts`

## 关于 `experiments/`

为了让仓库首页更聚焦“游戏本体”，所有非直接运行所必需的内容已经集中整理到 `experiments/`：

- 对战模拟脚本
- 强化学习训练脚本
- 统计分析脚本
- 历史训练结果与分析文档

这部分不会影响网页游戏本身的启动与运行，但保留了 AI 实验过程，方便继续研究和复现。

## 技术栈

- `React 19`
- `TypeScript`
- `Vite`
- `ESLint`
- `tsx`（运行实验脚本）

## 后续可扩展方向

- 增加更多卡池或扩展包
- 完善 AI 决策可视化
- 提供回放、存档与局面导入
- 为训练脚本补充更系统的结果面板
