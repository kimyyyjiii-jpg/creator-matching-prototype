// PRD 3.7 후보 없음 처리 + 3.8 유사 크리에이터 추천 (flowchart 다이어그램 3)
import { ALL_PLATFORMS, NANO, MACRO, MAX_ALTERNATIVES, MAX_SIMILAR } from './constants.js';
import { filterCandidates, inRange, scoreOf, byScore } from './recommend.js';

export function analyzeEmpty(creators, cond) {
  const relaxations = [];
  const rangeInfos = [];
  let alternatives = [];

  // 완화 1. 예산 조건만 해제
  const withoutBudget = filterCandidates(creators, cond, { ignoreBudget: true });
  if (withoutBudget.length) {
    const minPrice = Math.min(...withoutBudget.map((c) => c.price));
    relaxations.push({
      kind: 'budget',
      count: withoutBudget.filter((c) => c.price <= minPrice).length,
      budget: minPrice,
      apply: { budget: minPrice },
    });
    // 대안: 예산만 초과하는 후보 최대 3명, 초과 금액이 작은 순
    alternatives = withoutBudget
      .map((creator) => ({ creator, score: scoreOf(creator, cond.purpose), over: creator.price - cond.budget }))
      .sort((a, b) => a.over - b.over || byScore(a, b))
      .slice(0, MAX_ALTERNATIVES);
  }

  // 완화 2. 플랫폼을 선택한 경우에만 전체로
  if (cond.platform !== ALL_PLATFORMS) {
    const count = filterCandidates(creators, { ...cond, platform: ALL_PLATFORMS }).length;
    if (count) relaxations.push({ kind: 'platform', count, apply: { platform: ALL_PLATFORMS } });
  }

  // 완화 3. 넓힐 수 있는 방향마다 따로 계산 (아래쪽 → 위쪽 순)
  const [lo, hi] = cond.range;
  const directions = [];
  if (lo > NANO) directions.push(lo - 1);
  if (hi < MACRO) directions.push(hi + 1);
  for (const tier of directions) {
    const range = [Math.min(lo, tier), Math.max(hi, tier)];
    const count = filterCandidates(creators, { ...cond, range }).length;
    if (count) {
      relaxations.push({ kind: 'range', tier, count, apply: { range } });
      continue;
    }
    // 예산 때문에 0명인 방향: 버튼 없이 안내만. 완화안 개수에는 세지 않는다
    const inTier = filterCandidates(creators, { ...cond, range: [tier, tier] }, { ignoreBudget: true });
    if (inTier.length) rangeInfos.push({ tier, minPrice: Math.min(...inTier.map((c) => c.price)) });
  }

  // 완화 4. 카테고리를 선택한 경우에만 전체로
  if (cond.categories.length) {
    const count = filterCandidates(creators, { ...cond, categories: [] }).length;
    if (count) relaxations.push({ kind: 'category', count, apply: { categories: [] } });
  }

  const hasBudgetRelaxation = relaxations.some((r) => r.kind === 'budget');
  const similar = relaxations.length ? null : findSimilar(creators, cond);

  return {
    cause: hasBudgetRelaxation ? 'budget' : 'conditions',
    relaxations,
    rangeInfos,
    alternatives: hasBudgetRelaxation ? alternatives : [],
    similar,
  };
}

// 3.8 카테고리 고정, 규모는 위·아래 한 단계까지, 플랫폼 변경 가능.
// 원래 규모·플랫폼 조건에 그대로 맞는 크리에이터는 제외.
export function findSimilar(creators, cond, limit = MAX_SIMILAR) {
  const [lo, hi] = cond.range;
  const wideRange = [Math.max(NANO, lo - 1), Math.min(MACRO, hi + 1)];

  const pool = creators
    .filter((c) => (cond.categories.length === 0 || cond.categories.includes(c.category)) && inRange(c.tier, wideRange))
    .map((creator) => {
      const platformDiff = cond.platform !== ALL_PLATFORMS && creator.platform !== cond.platform;
      const tierDiff = !inRange(creator.tier, cond.range);
      return { creator, platformDiff, tierDiff };
    })
    .filter((x) => x.platformDiff || x.tierDiff);

  const withinBudget = pool.filter((x) => x.creator.price != null && x.creator.price <= cond.budget);
  const overBudget = withinBudget.length === 0;
  const items = (overBudget ? pool : withinBudget)
    .map((x) => ({
      ...x,
      score: scoreOf(x.creator, cond.purpose),
      over: Math.max(0, x.creator.price - cond.budget),
      group: changeGroup(x),
    }))
    // 덜 바뀐 순서: 플랫폼만 다름 → 규모만 다름 → 둘 다 다름, 같은 그룹 안에서는 추천순
    .sort((a, b) => a.group - b.group || byScore(a, b))
    .slice(0, limit);

  return { items, overBudget };
}

function changeGroup({ platformDiff, tierDiff }) {
  if (platformDiff && !tierDiff) return 0;
  if (!platformDiff && tierDiff) return 1;
  return 2;
}
