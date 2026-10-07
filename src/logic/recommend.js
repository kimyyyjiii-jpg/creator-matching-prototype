// PRD 3.3 필터 → 3.5 점수 → 3.6 태그 → 정렬. 후보가 0명이면 relax.js로 넘긴다.
import {
  ALL_PLATFORMS,
  FULL_RANGE,
  DEFAULT_PURPOSE,
  PURPOSES,
  MAX_TAGS,
  BUDGET_ROOM_NUMERATOR,
  BUDGET_ROOM_DENOMINATOR,
  costMetricFor,
} from './constants.js';
import { analyzeEmpty } from './relax.js';

// 2.1 예산 검증: 원 단위 정수, 쉼표 허용. 0 이하·공란·숫자 외 입력은 실패
export function validateBudget(text) {
  const s = String(text ?? '').replace(/[,\s]/g, '');
  if (s === '') return { ok: false, error: '캠페인 예산을 입력해 주세요.' };
  if (!/^\d+$/.test(s)) return { ok: false, error: '예산은 원 단위 숫자로만 입력해 주세요. (예: 1500000)' };
  const value = Number(s);
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false, error: '예산은 0보다 큰 금액이어야 합니다.' };
  return { ok: true, value };
}

// 미선택 값에 기본값 적용 (flowchart 다이어그램 1의 DEFAULTS)
export function normalizeConditions({ budget, categories, range, platform, purpose }) {
  return {
    budget,
    categories: Array.isArray(categories) ? [...categories] : [],
    range: Array.isArray(range) && range.length === 2 ? [Math.min(...range), Math.max(...range)] : [...FULL_RANGE],
    platform: platform || ALL_PLATFORMS,
    purpose: PURPOSES[purpose] ? purpose : DEFAULT_PURPOSE,
  };
}

export function inRange(tier, [lo, hi]) {
  return tier != null && tier >= lo && tier <= hi;
}

export function matches(c, cond, { ignoreBudget = false } = {}) {
  if (cond.categories.length && !cond.categories.includes(c.category)) return false;
  if (!inRange(c.tier, cond.range)) return false;
  if (cond.platform !== ALL_PLATFORMS && c.platform !== cond.platform) return false;
  if (!ignoreBudget && !(c.price != null && c.price <= cond.budget)) return false;
  return true;
}

export function filterCandidates(creators, cond, opts) {
  return creators.filter((c) => matches(c, cond, opts));
}

// 3.5 매칭 점수 (100점 만점). 정렬에만 쓰고 화면에는 노출하지 않는다.
export function scoreOf(c, purpose) {
  const weights = PURPOSES[purpose].weights;
  let total = 0;
  for (const [metric, w] of Object.entries(weights)) total += w * c.norm[metric];
  return total;
}

export function byScore(a, b) {
  return b.score - a.score || a.creator.id.localeCompare(b.creator.id);
}

export function rankByScore(creators, purpose) {
  return creators.map((creator) => ({ creator, score: scoreOf(creator, purpose) })).sort(byScore);
}

// 3.6 추천 기여 지표: 가중치 × (내 정규화 값 − 200명 평균). 양수인 것 중 큰 순서로 최대 2개
export function contributions(c, purpose, normMeans) {
  return Object.entries(PURPOSES[purpose].weights)
    .map(([metric, w]) => ({ metric, value: w * (c.norm[metric] - normMeans[metric]) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);
}

// 3.6 예산 여유: 현재 결과 안에서 단가 하위 30%(올림). 결과 1명이면 없음, 추정 단가는 제외
export function budgetRoomIds(creators) {
  if (creators.length <= 1) return new Set();
  const k = Math.ceil((creators.length * BUDGET_ROOM_NUMERATOR) / BUDGET_ROOM_DENOMINATOR);
  return new Set(
    creators
      .filter((c) => !c.isEstimated)
      .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))
      .slice(0, k)
      .map((c) => c.id),
  );
}

// 3.6 카드 태그: 성과 → 비용 → 검증 순 최대 3개, 주의 태그는 별도
export function buildTags(c, purpose, roomIds = new Set()) {
  const perf = [];
  if (c.flags.erTop) perf.push({ type: 'perf', label: '참여율 상위 10%' });
  if (c.flags.vrTop) perf.push({ type: 'perf', label: '조회율 상위 10%' });

  const cost = [];
  const costMetric = costMetricFor(purpose);
  if (costMetric === 'cpv' && c.flags.cpvLow) cost.push({ type: 'cost', label: '조회당 비용 낮음' });
  if (costMetric === 'cpe' && c.flags.cpeLow) cost.push({ type: 'cost', label: '참여당 비용 낮음' });
  if (roomIds.has(c.id)) cost.push({ type: 'cost', label: '예산 여유' });

  const verify = [];
  if (c.flags.ratingTop) verify.push({ type: 'verify', label: '광고주 평점 우수' });
  if (c.flags.expRich) verify.push({ type: 'verify', label: '캠페인 경험 풍부' });

  const cautions = [];
  if (!c.hasHistory) cautions.push({ type: 'caution', label: '신규(평점 없음)' });
  if (c.isEstimated) cautions.push({ type: 'caution', label: '단가 추정' });

  return { tags: [...perf, ...cost, ...verify].slice(0, MAX_TAGS), cautions };
}

export function recommend(dataset, cond) {
  const matched = filterCandidates(dataset.creators, cond);
  if (!matched.length) {
    return { status: 'empty', cond, ...analyzeEmpty(dataset.creators, cond) };
  }
  const roomIds = budgetRoomIds(matched);
  const items = rankByScore(matched, cond.purpose).map((x, i) => ({
    ...x,
    rank: i + 1,
    ...buildTags(x.creator, cond.purpose, roomIds),
  }));
  return { status: 'ok', cond, items };
}

// F5 재정렬. 동점이면 추천순. 추천 순위 숫자(rank)는 바꾸지 않는다.
const SORTERS = {
  recommended: () => 0,
  er: (a, b) => desc(a.creator.er, b.creator.er),
  views: (a, b) => desc(a.creator.views, b.creator.views),
  rating: (a, b) => desc(a.creator.rating, b.creator.rating),
  count: (a, b) => desc(a.creator.count, b.creator.count),
  price: (a, b) => asc(a.creator.price, b.creator.price),
};

export function sortItems(items, key = 'recommended') {
  const cmp = SORTERS[key] ?? SORTERS.recommended;
  return [...items].sort((a, b) => cmp(a, b) || a.rank - b.rank);
}

// 값이 없는 항목(예: 평점 없음)은 정렬 방향과 관계없이 맨 뒤
function desc(x, y) {
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x;
}

function asc(x, y) {
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x - y;
}
