// 추천 조건 ↔ 주소창 쿼리 (PRD 4장 "브라우저 이동"). 뒤로가기로 이전 조건·결과로 돌아가고, 주소로 같은 결과를 공유한다.
// 예: ?budget=3000000&cat=식품,뷰티&range=1-1&platform=유튜브&purpose=reach
import { PLATFORMS, PURPOSES, ALL_PLATFORMS, DEFAULT_PURPOSE, NANO, MACRO, FULL_RANGE } from '../logic/constants.js';

export function conditionsToQuery(cond) {
  const q = new URLSearchParams();
  q.set('budget', String(cond.budget));
  if (cond.categories.length) q.set('cat', cond.categories.join(','));
  if (cond.range[0] !== FULL_RANGE[0] || cond.range[1] !== FULL_RANGE[1]) q.set('range', `${cond.range[0]}-${cond.range[1]}`);
  if (cond.platform !== ALL_PLATFORMS) q.set('platform', cond.platform);
  if (cond.purpose !== DEFAULT_PURPOSE) q.set('purpose', cond.purpose);
  return `?${q.toString()}`;
}

// 잘못된 값은 버리고 기본값을 쓴다. budget이 없으면 null (추천을 실행하지 않음)
export function queryToForm(search, knownCategories) {
  const q = new URLSearchParams(search);
  if (!q.has('budget')) return null;
  const categories = (q.get('cat') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((c) => knownCategories.includes(c));
  let range = [...FULL_RANGE];
  const m = /^(\d)-(\d)$/.exec(q.get('range') ?? '');
  if (m) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (lo >= NANO && hi <= MACRO && lo <= hi) range = [lo, hi];
  }
  const platform = PLATFORMS.includes(q.get('platform')) ? q.get('platform') : ALL_PLATFORMS;
  const purpose = PURPOSES[q.get('purpose')] ? q.get('purpose') : DEFAULT_PURPOSE;
  return { budgetText: q.get('budget') ?? '', categories, range, platform, purpose };
}
