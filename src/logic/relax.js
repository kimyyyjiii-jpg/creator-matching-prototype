// PRD 3.7 조건 넓히기 제안 + 3.8 가까운 후보 (flowchart 다이어그램 3)
// v1.0: 0명일 때와 1~3명일 때 같은 규칙을 쓴다. 카테고리는 바꾸지 않는다.
import { ALL_PLATFORMS, NANO, MACRO, MAX_NEARBY } from './constants.js';
import { filterCandidates, inRange, scoreOf, byScore } from './recommend.js';

// 예산 상향 → 플랫폼 해제 → 규모 확장(방향별) 순. 늘어나는 인원(added)이 1명 이상인 것만 버튼으로 제안하고,
// 규모 방향이 예산 때문에 0명이면 누를 수 없는 안내 줄(infos)로 알려준다.
export function suggestWider(creators, cond, currentCount) {
  const suggestions = [];
  const infos = [];

  // 예산: 예산 때문에 빠진 후보 중 가장 낮은 단가까지 올리면
  const overBudget = filterCandidates(creators, cond, { ignoreBudget: true }).filter((c) => c.price > cond.budget);
  if (overBudget.length) {
    const budget = Math.min(...overBudget.map((c) => c.price));
    const added = overBudget.filter((c) => c.price <= budget).length;
    suggestions.push({ kind: 'budget', budget, added, apply: { budget } });
  }

  if (cond.platform !== ALL_PLATFORMS) {
    const added = filterCandidates(creators, { ...cond, platform: ALL_PLATFORMS }).length - currentCount;
    if (added > 0) suggestions.push({ kind: 'platform', added, apply: { platform: ALL_PLATFORMS } });
  }

  const [lo, hi] = cond.range;
  const directions = [];
  if (lo > NANO) directions.push(lo - 1);
  if (hi < MACRO) directions.push(hi + 1);
  for (const tier of directions) {
    const range = [Math.min(lo, tier), Math.max(hi, tier)];
    const added = filterCandidates(creators, { ...cond, range }).length - currentCount;
    if (added > 0) {
      suggestions.push({ kind: 'range', tier, added, apply: { range } });
      continue;
    }
    const inTier = filterCandidates(creators, { ...cond, range: [tier, tier] }, { ignoreBudget: true });
    if (inTier.length) infos.push({ tier, minPrice: Math.min(...inTier.map((c) => c.price)) });
  }

  return { suggestions, infos };
}

// 0명일 때 보여주는 가까운 후보. 카테고리는 고정, 규모는 위·아래 한 단계까지, 플랫폼·예산은 바뀔 수 있다.
// 덜 바뀐 순(바뀐 조건 수 → 예산 → 플랫폼 → 규모 순) → 예산에 가까운 순 → 추천순으로 최대 3명.
export function findNearby(creators, cond, limit = MAX_NEARBY) {
  const [lo, hi] = cond.range;
  const wideRange = [Math.max(NANO, lo - 1), Math.min(MACRO, hi + 1)];

  return creators
    .filter((c) => (cond.categories.length === 0 || cond.categories.includes(c.category)) && inRange(c.tier, wideRange))
    .map((creator) => {
      const platformDiff = cond.platform !== ALL_PLATFORMS && creator.platform !== cond.platform;
      const tierDiff = !inRange(creator.tier, cond.range);
      const over = Math.max(0, creator.price - cond.budget);
      const changes = (over > 0) + platformDiff + tierDiff;
      // 바뀐 조건 수가 같으면 예산만 > 플랫폼만 > 규모만 (2개일 때도 같은 우선순위)
      const kindRank = (platformDiff ? 1 : 0) + (tierDiff ? 2 : 0);
      return { creator, platformDiff, tierDiff, over, changes, kindRank, score: scoreOf(creator, cond.purpose) };
    })
    .filter((x) => x.changes > 0)
    .sort((a, b) => a.changes - b.changes || a.kindRank - b.kindRank || a.over - b.over || byScore(a, b))
    .slice(0, limit);
}
