// 평균 순위 백분위: (값이 더 작은 개수 + 같은 값 개수 × 0.5) ÷ 모집단 수.
// 0~1 사이 값이며 클수록 값이 크다. 동점은 같은 백분위를 받는다(PRD 3.4 백분위 공통 규칙).
export function midRankPercentiles(values) {
  const n = values.length;
  if (!n) return [];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((x) => {
    const below = lowerBound(sorted, x);
    const equal = upperBound(sorted, x) - below;
    return (below + 0.5 * equal) / n;
  });
}

// 그룹별로 백분위를 계산해 id → 백분위 Map을 돌려준다. value가 null이면 모집단에서 뺀다.
export function groupPercentiles(items, { value, group }) {
  const groups = new Map();
  for (const item of items) {
    const v = value(item);
    if (v == null || !Number.isFinite(v)) continue;
    const g = group(item);
    if (g == null) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ id: item.id, v });
  }
  const result = new Map();
  for (const members of groups.values()) {
    const pcts = midRankPercentiles(members.map((m) => m.v));
    members.forEach((m, i) => result.set(m.id, pcts[i]));
  }
  return result;
}

// 화면 표시용 "상위 N%". 1% 미만은 1%로 올린다.
export function topPercent(pct) {
  return Math.max(1, Math.round((1 - pct) * 100));
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
