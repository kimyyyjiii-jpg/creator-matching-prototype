// 브라우저에서 실행하는 추천 로직 테스트. PRD.md v0.7의 수치와 시나리오를 검증한다.
import { parseCSV } from '../src/data/csv.js';
import { buildDataset } from '../src/data/dataset.js';
import { loadDataset } from '../src/data/load.js';
import { midRankPercentiles } from '../src/logic/percentile.js';
import { PURPOSES, NANO, MICRO, MACRO, ALL_PLATFORMS, FULL_RANGE } from '../src/logic/constants.js';
import {
  validateBudget,
  normalizeConditions,
  filterCandidates,
  recommend,
  scoreOf,
  contributions,
  buildTags,
  budgetRoomIds,
  sortItems,
  filterByTags,
  tagCounts,
  displayedTags,
} from '../src/logic/recommend.js';
import { findSimilar } from '../src/logic/relax.js';
import { formatWon } from '../src/ui/format.js';
import { conditionsToQuery, queryToForm } from '../src/ui/urlState.js';

const sections = [];
let current = null;
function section(name) {
  current = { name, tests: [] };
  sections.push(current);
}
function test(name, fn) {
  try {
    fn();
    current.tests.push({ name, ok: true });
  } catch (e) {
    current.tests.push({ name, ok: false, msg: e.message });
  }
}
function info(name, text) {
  current.tests.push({ name, ok: true, msg: text });
}
function assert(cond, msg = '조건 불만족') {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} 기대값 ${b}, 실제값 ${a}`);
}
function near(actual, expected, eps, label = '') {
  if (Math.abs(actual - expected) > eps) throw new Error(`${label} 기대값 ${expected}±${eps}, 실제값 ${actual}`);
}

const cond = (o) => normalizeConditions({ ...o });

const ds = await loadDataset('../dummy_creators.csv');
const C = ds.creators;
const S = ds.stats;

// ---------------------------------------------------------------
section('1. 데이터 로딩과 정제 (PRD 3.2)');
test('200명 로드, 제외된 행 없음', () => {
  eq(C.length, 200, '인원');
  eq(ds.dropped.length, 0, '제외 행');
});
test('UTF-8 BOM을 제거하고 첫 컬럼을 creator_id로 읽음', () => {
  const rows = parseCSV('﻿creator_id,creator_name\nC1,"이름, 쉼표"\n');
  eq(Object.keys(rows[0])[0], 'creator_id');
  eq(rows[0].creator_name, '이름, 쉼표');
});
test('구간별 인원: 나노 44 / 마이크로 129 / 매크로 27 (PRD 2.2)', () => {
  eq([NANO, MICRO, MACRO].map((t) => C.filter((c) => c.tier === t).length), [44, 129, 27]);
});
test('신규(이력 없음) 27명: 평점 공란·단가 0원 → 단가 협의 필요, 판정 단가 = 같은 규모 최저 단가', () => {
  const none = C.filter((c) => !c.hasHistory);
  eq(none.length, 27);
  assert(none.every((c) => c.rating == null && c.rawPrice === 0 && c.isNegotiable), '평점 공란·단가 0원·협의 필요');
  assert(none.every((c) => c.price === S.priceRange[c.tier].min && c.priceRange === S.priceRange[c.tier]), '판정 단가·표시 범위');
  assert(C.filter((c) => c.hasHistory).every((c) => !c.isNegotiable && c.price === c.rawPrice), '이력 있으면 실제 단가');
});
test('같은 규모 단가 범위 (0원 제외): 나노 21만~50만 / 마이크로 51만~200만 / 매크로 224만~679만', () => {
  eq([NANO, MICRO, MACRO].map((t) => [S.priceRange[t].min, S.priceRange[t].max]), [[210000, 500000], [510000, 2000000], [2240000, 6790000]]);
});
test('보정 평점 전체 평균 ≈ 4.415', () => near(S.ratingMean, 4.415, 0.001));
test('보정 평점 예시: 1건 4.9점 → 4.50, 30건 5.0점 → 4.92 (PRD 3.4)', () => {
  const adj = (n, r) => (n * r + 5 * S.ratingMean) / (n + 5);
  near(adj(1, 4.9), 4.5, 0.005, '1건');
  near(adj(30, 5.0), 4.92, 0.005, '30건');
  const sample = C.find((c) => c.hasHistory);
  near(sample.adjRating, adj(sample.count, sample.rating), 1e-9, '데이터 적용값');
});
test('이력 없으면 보정 평점 = 전체 평균', () => {
  assert(C.filter((c) => !c.hasHistory).every((c) => c.adjRating === S.ratingMean));
});
test('ID·채널명 누락 행 제외, 음수·형식 오류·0 나누기는 해당 지표만 중립 0.5', () => {
  const header = 'creator_id,creator_name,category,platform,followers,avg_view_count,engagement_rate,total_campaign_count,total_campaign_budget_krw,avg_campaign_budget_krw,advertiser_rating';
  const csv = [
    header,
    ',이름없음ID,뷰티,유튜브,5000,1000,7,1,100,100000,4.5',
    'X1,,뷰티,유튜브,5000,1000,7,1,100,100000,4.5',
    'X2,음수조회,뷰티,유튜브,5000,-3,7,2,100,100000,4.5',
    'X3,팔로워0,뷰티,유튜브,0,1000,abc,2,100,100000,4.5',
    'X4,정상,뷰티,유튜브,5000,1000,7,2,100,100000,4.5',
  ].join('\n');
  const d = buildDataset(parseCSV(csv));
  eq(d.creators.map((c) => c.id), ['X2', 'X3', 'X4'], '남은 행');
  const x2 = d.creators.find((c) => c.id === 'X2');
  eq([x2.norm.views, x2.norm.cpv], [0.5, 0.5], '조회수 음수 → 조회수·조회당 비용 중립');
  const x3 = d.creators.find((c) => c.id === 'X3');
  eq([x3.norm.vr, x3.norm.er, x3.norm.cpe], [0.5, 0.5, 0.5], '팔로워 0·참여율 오류 → 조회율·참여율·참여당 비용 중립');
});

// ---------------------------------------------------------------
section('2. 백분위와 정규화 (PRD 3.4)');
test('평균 순위 백분위: [1,2,2,3] → [0.125, 0.5, 0.5, 0.875]', () => {
  eq(midRankPercentiles([1, 2, 2, 3]), [0.125, 0.5, 0.5, 0.875]);
});
test('비용 백분위는 이력 없는 크리에이터를 빼고 계산, 이들의 비용 점수는 0.5', () => {
  const none = C.filter((c) => !c.hasHistory);
  assert(none.every((c) => c.pct.cpv == null && c.pct.cpe == null && c.norm.cpv === 0.5 && c.norm.cpe === 0.5));
  assert(C.filter((c) => c.hasHistory).every((c) => c.pct.cpv != null && c.pct.cpe != null));
});
test('모든 정규화 값이 0~1 범위', () => {
  for (const c of C) for (const [k, v] of Object.entries(c.norm)) assert(v >= 0 && v <= 1, `${c.id} ${k}=${v}`);
});
test('평점 정규화 = (보정 평점 − 3.4) ÷ 1.6', () => {
  const c = C[0];
  near(c.norm.rating, (c.adjRating - 3.4) / 1.6, 1e-12);
});
test('캠페인 경험 = log(1+건수) ÷ log(31)', () => {
  const c = C.find((x) => x.count === 30);
  near(c.norm.exp, 1, 1e-12, '30건');
  eq(C.find((x) => x.count === 0).norm.exp, 0, '0건');
});

// ---------------------------------------------------------------
section('3. 입력 검증과 필터 (PRD 2.1, 3.3)');
test('예산 검증: 공란·0·음수·문자·"150만"·소수는 실패', () => {
  for (const s of ['', '   ', '0', '-1', 'abc', '150만', '1.5', '1e6']) assert(!validateBudget(s).ok, `"${s}"가 통과됨`);
});
test('예산 검증: 쉼표 허용 "1,500,000" → 1500000', () => eq(validateBudget('1,500,000'), { ok: true, value: 1500000 }));
test('미선택 기본값: 카테고리 전체 / 나노~매크로 / 플랫폼 전체 / 종합 추천', () => {
  const n = normalizeConditions({ budget: 1 });
  eq([n.categories, n.range, n.platform, n.purpose], [[], FULL_RANGE, ALL_PLATFORMS, 'balanced']);
});
test('시나리오 A: 예산 150만·뷰티·마이크로 → 10명 중 8명', () => {
  const all = filterCandidates(C, cond({ budget: 1500000, categories: ['뷰티'], range: [MICRO, MICRO] }), { ignoreBudget: true });
  eq(all.length, 10, '뷰티 마이크로 전체');
  const r = recommend(ds, cond({ budget: 1500000, categories: ['뷰티'], range: [MICRO, MICRO] }));
  eq(r.status, 'ok');
  eq(r.items.length, 8, '예산 통과');
  assert(r.items.every((x) => x.creator.price <= 1500000 && x.creator.category === '뷰티' && x.creator.tier === MICRO));
});
test('신규는 같은 규모 최저 단가로 예산 판정 (0원으로 통과하지 않음)', () => {
  const base = { categories: [], range: [MICRO, MICRO] };
  const fresh = C.filter((c) => c.tier === MICRO && !c.hasHistory).map((c) => c.id);
  const pass = (b) => filterCandidates(C, cond({ ...base, budget: b })).map((c) => c.id);
  eq(fresh.length, 14, '마이크로 신규');
  assert(fresh.every((id) => pass(510000).includes(id)), '51만 원에서 통과');
  assert(fresh.every((id) => !pass(509999).includes(id)), '51만 원 미만에서 제외');
});
test('TC-4-07: 예산 100만·식품·유튜브에서 신규 하은TALK81이 결과에 나옴', () => {
  const r = recommend(ds, cond({ budget: 1000000, categories: ['식품'], platform: '유튜브' }));
  assert(r.items.some((x) => x.creator.name === '하은TALK81'));
});
test('플랫폼 필터', () => {
  const r = filterCandidates(C, cond({ budget: 1e9, platform: '인스타그램' }));
  eq(r.length, 94);
  assert(r.every((c) => c.platform === '인스타그램'));
});
test('여러 구간 범위 선택: 나노~마이크로 173명, 마이크로~매크로 156명 (PRD 2.2)', () => {
  eq(filterCandidates(C, cond({ budget: 1e9, range: [NANO, MICRO] })).length, 173);
  eq(filterCandidates(C, cond({ budget: 1e9, range: [MICRO, MACRO] })).length, 156);
});

// ---------------------------------------------------------------
section('4. 점수와 정렬 (PRD 3.5, F2, F5)');
test('목적별 가중치 합계 = 100', () => {
  for (const [k, p] of Object.entries(PURPOSES)) eq(Object.values(p.weights).reduce((a, b) => a + b, 0), 100, k);
});
test('점수는 0~100, 결과는 점수 내림차순이고 순위는 1부터', () => {
  const r = recommend(ds, cond({ budget: 1e9 }));
  r.items.forEach((x, i) => {
    assert(x.score >= 0 && x.score <= 100);
    eq(x.rank, i + 1);
    if (i) assert(r.items[i - 1].score >= x.score, '내림차순');
  });
});
test('캠페인 목적은 후보를 걸러내지 않음 (목적별 인원 동일)', () => {
  const counts = Object.keys(PURPOSES).map((p) => recommend(ds, cond({ budget: 1500000, categories: ['뷰티'], purpose: p })).items.length);
  assert(counts.every((n) => n === counts[0]), JSON.stringify(counts));
});
test('목적을 바꾸면 순서가 달라짐 (시나리오 A: 종합 → 도달 중심)', () => {
  const a = recommend(ds, cond({ budget: 1500000, categories: ['뷰티'], range: [MICRO, MICRO] })).items.map((x) => x.creator.id);
  const b = recommend(ds, cond({ budget: 1500000, categories: ['뷰티'], range: [MICRO, MICRO], purpose: 'reach' })).items.map((x) => x.creator.id);
  assert(JSON.stringify(a) !== JSON.stringify(b));
});
test('재정렬: 단가 낮은 순(신규는 맨 뒤), 평점 없는 사람은 평점순 맨 뒤, 추천 순위 숫자 유지', () => {
  const r = recommend(ds, cond({ budget: 1e9, range: [NANO, NANO] }));
  const byPrice = sortItems(r.items, 'price');
  const known = byPrice.filter((x) => !x.creator.isNegotiable);
  for (let i = 1; i < known.length; i++) assert(known[i - 1].creator.price <= known[i].creator.price, '단가 오름차순');
  const firstNew = byPrice.findIndex((x) => x.creator.isNegotiable);
  assert(firstNew > 0 && byPrice.slice(firstNew).every((x) => x.creator.isNegotiable), '신규는 맨 뒤');
  const byRating = sortItems(r.items, 'rating');
  const firstNull = byRating.findIndex((x) => x.creator.rating == null);
  assert(firstNull > 0 && byRating.slice(firstNull).every((x) => x.creator.rating == null), '평점 없음 맨 뒤');
  const rankById = new Map(r.items.map((x) => [x.creator.id, x.rank]));
  assert(byPrice.every((x) => rankById.get(x.creator.id) === x.rank), '순위 유지');
  for (const key of ['er', 'views', 'count']) {
    const s = sortItems(r.items, key);
    for (let i = 1; i < s.length; i++) assert(s[i - 1].creator[key] >= s[i].creator[key], key);
  }
});
{
  // PRD 3.5 "프리셋의 효과 검증" 재계산 (참고용)
  const combos = [];
  for (const t of [NANO, MICRO, MACRO])
    for (const cat of S.categories) {
      const pool = C.filter((c) => c.tier === t && c.category === cat);
      if (pool.length >= 5) combos.push(pool);
    }
  const top = (pool, p) => [...pool].sort((a, b) => scoreOf(b, p) - scoreOf(a, p) || a.id.localeCompare(b.id));
  const lines = ['reach', 'engagement', 'verified'].map((p) => {
    let changed = 0;
    let overlap = 0;
    for (const pool of combos) {
      const base = top(pool, 'balanced');
      const other = top(pool, p);
      if (base[0].id !== other[0].id) changed++;
      const b3 = new Set(base.slice(0, 3).map((c) => c.id));
      overlap += other.slice(0, 3).filter((c) => b3.has(c.id)).length;
    }
    return `${PURPOSES[p].label}: 1위 변경 ${changed}/${combos.length}, 상위 3명 중 겹침 평균 ${(overlap / combos.length).toFixed(1)}명`;
  });
  info('참고: 목적별 결과 차이 (PRD 3.5 표: 도달 4·참여 12·검증 8 / 16개, 겹침 2.4·2.3·2.3명)', lines.join('\n'));
}

// ---------------------------------------------------------------
section('5. 근거 태그 (PRD 3.6)');
test('조회당·참여당 비용 낮음 대상 각 34명, 겹침 23명 (PRD 3.6)', () => {
  const a = C.filter((c) => c.flags.cpvLow).map((c) => c.id);
  const b = new Set(C.filter((c) => c.flags.cpeLow).map((c) => c.id));
  eq([a.length, b.size, a.filter((id) => b.has(id)).length], [34, 34, 23]);
});
test('광고주 평점 우수: 200명 중 상위 20% = 40명, 기준값 약 4.66', () => {
  eq(C.filter((c) => c.flags.ratingTop).length, 40);
  near(S.ratingTopCut, 4.66, 0.01);
});
test('캠페인 경험 풍부: 22건 이상 51명', () => eq(C.filter((c) => c.flags.expRich).length, 51));
test('태그 최대 3개, 성과 → 비용 → 검증 순, 주의 태그는 별도', () => {
  const order = { perf: 0, cost: 1, verify: 2 };
  for (const p of Object.keys(PURPOSES)) {
    for (const c of C) {
      const { tags, cautions } = buildTags(c, p, new Set([c.id]));
      assert(tags.length <= 3, `${c.id} 태그 ${tags.length}개`);
      for (let i = 1; i < tags.length; i++) assert(order[tags[i - 1].type] <= order[tags[i].type], `${c.id} 순서`);
      assert(cautions.every((t) => t.type === 'caution'));
      eq(cautions.length, c.hasHistory ? 0 : 2, `${c.id} 주의 태그`);
    }
  }
});
test('비용 태그는 목적에 따라 하나만: 참여 중심 = 참여당 비용, 그 외 = 조회당 비용', () => {
  for (const c of C) {
    const eng = buildTags(c, 'engagement').tags.map((t) => t.label);
    const bal = buildTags(c, 'balanced').tags.map((t) => t.label);
    assert(!eng.includes('조회당 비용 낮음') && !bal.includes('참여당 비용 낮음'));
  }
});
test('조건 일치 태그("카테고리 일치", "예산 적합")는 붙지 않음', () => {
  const r = recommend(ds, cond({ budget: 1e9 }));
  assert(r.items.every((x) => x.tags.every((t) => !['카테고리 일치', '예산 적합'].includes(t.label))));
});
test('예산 여유: 결과 8명 → 3명, 10명 → 3명, 1명 → 없음, 신규 제외', () => {
  const hist = C.filter((c) => c.hasHistory);
  eq(budgetRoomIds(hist.slice(0, 8)).size, 3, '8명');
  eq(budgetRoomIds(hist.slice(0, 10)).size, 3, '10명');
  eq(budgetRoomIds(hist.slice(0, 1)).size, 0, '1명');
  const mixed = [...C.filter((c) => !c.hasHistory).slice(0, 5), ...hist.slice(0, 5)];
  const ids = budgetRoomIds(mixed);
  eq(ids.size, 3, '10명 중 3명');
  assert([...ids].every((id) => C.find((c) => c.id === id).hasHistory), '신규 제외');
});
test('예산 여유는 결과 안에서 가장 저렴한 순', () => {
  const r = recommend(ds, cond({ budget: 1500000, categories: ['뷰티'], range: [MICRO, MICRO] }));
  const ids = [...budgetRoomIds(r.items.map((x) => x.creator))].sort();
  const cheapest = [...r.items].sort((a, b) => a.creator.price - b.creator.price).slice(0, 3).map((x) => x.creator.id);
  eq(ids, cheapest.sort());
});

// ---------------------------------------------------------------
section('6. 카드 상세 (PRD 3.6)');
test('추천 기여 지표: 최대 2개, 모두 양수, 선택한 목적의 지표만', () => {
  for (const p of Object.keys(PURPOSES)) {
    for (const c of C) {
      const list = contributions(c, p, S.normMeans);
      assert(list.length <= 2);
      assert(list.every((x) => x.value > 0 && x.metric in PURPOSES[p].weights));
      if (list.length === 2) assert(list[0].value >= list[1].value);
    }
  }
});
test('이력 없는 크리에이터는 "검증됨" 배지를 받지 않음', () => {
  assert(C.filter((c) => !c.hasHistory).every((c) => !c.flags.fitVerified));
});
{
  const reach = C.filter((c) => c.flags.fitReach);
  const eng = C.filter((c) => c.flags.fitEngagement);
  const ver = C.filter((c) => c.flags.fitVerified);
  const both = reach.filter((c) => c.flags.fitEngagement).length;
  const none = C.filter((c) => !c.flags.fitReach && !c.flags.fitEngagement).length;
  info(
    '참고: 목적 적합도 배지 인원 (PRD 3.6 표: 도달 60·참여 59·검증 61, 둘 다 11, 둘 다 아님 92)',
    `구현값: 도달 ${reach.length}·참여 ${eng.length}·검증 ${ver.length}, 둘 다 ${both}, 둘 다 아님 ${none}`,
  );
}

// ---------------------------------------------------------------
section('7. 후보 없음 처리 (PRD 3.7, 시나리오 B)');
const scenarioB = recommend(ds, cond({ budget: 400000, categories: ['뷰티'], range: [MICRO, MICRO] }));
test('예산 40만·뷰티·마이크로 → 0명, 원인 = 예산', () => {
  eq(scenarioB.status, 'empty');
  eq(scenarioB.cause, 'budget');
});
test('완화 1: "예산을 54만 원으로 올리면 1명"', () => {
  const r = scenarioB.relaxations.find((x) => x.kind === 'budget');
  eq([r.budget, r.count], [540000, 1]);
});
test('완화 3: 나노까지 넓히면 2명 (마이크로만 선택 → 두 방향 계산)', () => {
  const r = scenarioB.relaxations.filter((x) => x.kind === 'range');
  eq(r.map((x) => [x.tier, x.count]), [[NANO, 2]]);
});
test('매크로 쪽은 버튼 없이 "매크로는 예산 224만 원부터" 안내, 완화안 개수에 세지 않음', () => {
  // 뷰티 매크로 신규 1명을 매크로 최저 단가(224만 원)로 판정하므로 301만 원이 아니라 224만 원
  eq(scenarioB.rangeInfos, [{ tier: MACRO, minPrice: 2240000 }]);
  assert(!scenarioB.relaxations.some((x) => x.kind === 'range' && x.tier === MACRO));
});
test('플랫폼 미선택이라 완화 2 없음, 카테고리 해제는 0명이라 완화 4 없음', () => {
  eq(scenarioB.relaxations.map((x) => x.kind), ['budget', 'range']);
});
test('대안: 예산만 초과하는 후보 3명, 예산에 가까운 순 (54만·70만·71만 원)', () => {
  eq(scenarioB.alternatives.map((x) => x.creator.price), [540000, 700000, 710000]);
});
test('완화안이 있으면 유사 크리에이터는 보여주지 않음', () => eq(scenarioB.similar, null));
test('완화안을 적용하면 안내한 인원만큼 결과가 나옴', () => {
  for (const r of scenarioB.relaxations) {
    const applied = recommend(ds, { ...scenarioB.cond, ...r.apply });
    eq(applied.status, 'ok', r.kind);
    eq(applied.items.length, r.count, r.kind);
  }
});

// ---------------------------------------------------------------
section('8. 유사 크리에이터 (PRD 3.8, 시나리오 C)');
const scenarioC = recommend(ds, cond({ budget: 200000, categories: ['교육'], range: [NANO, NANO], platform: '유튜브' }));
test('예산 20만·교육·나노·유튜브 → 0명, 버튼이 있는 완화안 0개', () => {
  eq(scenarioC.status, 'empty');
  eq(scenarioC.relaxations.length, 0);
});
test('마이크로 쪽 안내: "마이크로는 예산 66만 원부터 가능합니다"', () => {
  eq(scenarioC.rangeInfos, [{ tier: MICRO, minPrice: 660000 }]);
});
test('유사 크리에이터 3명: 교육·나노·인스타그램(플랫폼만 다름), 모두 예산 초과', () => {
  const s = scenarioC.similar;
  eq(s.overBudget, true);
  eq(s.items.length, 3);
  assert(s.items.every((x) => x.creator.category === '교육' && x.creator.tier === NANO && x.creator.platform === '인스타그램'));
  assert(s.items.every((x) => x.platformDiff && !x.tierDiff && x.over > 0));
  for (let i = 1; i < s.items.length; i++) assert(s.items[i - 1].score >= s.items[i].score, '같은 그룹은 추천순');
});
test('덜 바뀐 순서: 플랫폼만 다름(0) → 규모만 다름(1) → 둘 다 다름(2)', () => {
  const s = findSimilar(C, cond({ budget: 200000, categories: ['교육'], range: [NANO, NANO], platform: '유튜브' }), 99);
  assert(new Set(s.items.map((x) => x.group)).size === 3, '세 그룹이 모두 있어야 함');
  for (let i = 1; i < s.items.length; i++) assert(s.items[i - 1].group <= s.items[i].group);
});
test('카테고리를 고르지 않으면 카테고리 조건 없이 규모·플랫폼 규칙만 적용', () => {
  // 매크로 + 인스타그램 + 아주 낮은 예산이면서 카테고리 미선택: 완화 1이 성립하므로 유사 대신 완화안
  const r = recommend(ds, cond({ budget: 10000, range: [MACRO, MACRO], platform: '인스타그램' }));
  eq(r.status, 'empty');
  assert(r.relaxations.length > 0);
});
test('완료 기준: 어떤 조건에서도 0명이면 완화안·대안·유사 크리에이터 중 1개 이상 제시', () => {
  const budgets = [10000, 100000, 200000, 300000, 500000, 800000, 1200000, 2000000, 3000000];
  const ranges = [[0, 0], [1, 1], [2, 2], [0, 1], [1, 2], [0, 2]];
  const platforms = ['전체', '유튜브', '인스타그램'];
  const catSets = [[], ...S.categories.map((c) => [c])];
  let empties = 0;
  for (const budget of budgets)
    for (const range of ranges)
      for (const platform of platforms)
        for (const categories of catSets) {
          const r = recommend(ds, cond({ budget, range, platform, categories }));
          if (r.status !== 'empty') continue;
          empties++;
          const offered = r.relaxations.length + r.alternatives.length + (r.similar ? r.similar.items.length : 0);
          assert(offered > 0, JSON.stringify({ budget, range, platform, categories }));
          if (r.similar) {
            // 유사 크리에이터는 카테고리를 유지하고, 원래 규모·플랫폼 조건에 그대로 맞는 사람은 없음
            for (const x of r.similar.items) {
              if (categories.length) assert(categories.includes(x.creator.category), '카테고리 유지');
              const sameTier = x.creator.tier >= range[0] && x.creator.tier <= range[1];
              const samePlatform = platform === '전체' || x.creator.platform === platform;
              assert(!(sameTier && samePlatform), '원래 조건과 동일');
              assert(x.creator.tier >= range[0] - 1 && x.creator.tier <= range[1] + 1, '규모는 한 단계까지');
            }
          }
        }
  assert(empties > 100, `0명 케이스가 충분히 검사되지 않음 (${empties})`);
});

// ---------------------------------------------------------------
section('9. 화면 표기 (TC-1-11)');
test('금액은 반올림 없이 정확하게 표기', () => {
  const cases = {
    9000: '9,000원',
    10000: '1만 원',
    365000: '36.5만 원',
    1500000: '150만 원',
    4725000: '472.5만 원',
    999999: '99만 9,999원',
    1234567: '123만 4,567원',
    100000000: '1억 원',
    150000000: '1억 5,000만 원',
    99999999999: '999억 9,999만 9,999원',
  };
  for (const [won, text] of Object.entries(cases)) eq(formatWon(Number(won)), text, won);
});

// ---------------------------------------------------------------
section('10. 결과가 1~3명일 때 "N명 더" 제안 (PRD 3.7.1)');
test('예산 54만·뷰티·마이크로(1명) → "예산 70만 원이면 1명 더", "나노까지 넓히면 3명 더"', () => {
  const r = recommend(ds, cond({ budget: 540000, categories: ['뷰티'], range: [MICRO, MICRO] }));
  eq(r.items.length, 1);
  eq(r.more.map((x) => [x.kind, x.budget ?? x.tier ?? null, x.added]), [['budget', 700000, 1], ['range', NANO, 3]]);
});
test('예산 80만·뷰티·마이크로·유튜브(1명) → 예산 +1명, 플랫폼 전체 +3명, 규모 확장 +1명 / 카테고리 해제는 없음', () => {
  const r = recommend(ds, cond({ budget: 800000, categories: ['뷰티'], range: [MICRO, MICRO], platform: '유튜브' }));
  eq(r.items.length, 1);
  eq(r.more.map((x) => [x.kind, x.added]), [['budget', 1], ['platform', 3], ['range', 1]]);
  assert(r.more.every((x) => x.kind !== 'category'));
});
test('플랫폼을 고르지 않았으면 플랫폼 제안 없음', () => {
  assert(recommend(ds, cond({ budget: 540000, categories: ['뷰티'], range: [MICRO, MICRO] })).more.every((x) => x.kind !== 'platform'));
});
test('결과가 4명 이상이면 제안 없음', () => {
  eq(recommend(ds, cond({ budget: 1500000, categories: ['뷰티'], range: [MICRO, MICRO] })).more, []);
});
test('제안을 적용하면 안내한 인원만큼 늘어남', () => {
  const base = recommend(ds, cond({ budget: 540000, categories: ['뷰티'], range: [MICRO, MICRO] }));
  for (const m of base.more) eq(recommend(ds, { ...base.cond, ...m.apply }).items.length, base.items.length + m.added, m.kind);
});

// ---------------------------------------------------------------
section('11. 태그 필터 (F7, OR)');
const tf = recommend(ds, cond({ budget: 3000000, categories: ['식품'], range: [MICRO, MICRO] }));
test('태그 칩 인원 = 그 태그가 카드에 표시된 크리에이터 수', () => {
  for (const [label, n] of tagCounts(tf.items)) eq(tf.items.filter((x) => displayedTags(x).includes(label)).length, n, label);
});
test('여러 태그를 고르면 하나라도 있는 크리에이터 (OR)', () => {
  const a = '예산 여유';
  const b = '신규(평점 없음)';
  const both = filterByTags(tf.items, new Set([a, b]));
  const union = new Set([...filterByTags(tf.items, new Set([a])), ...filterByTags(tf.items, new Set([b]))].map((x) => x.creator.id));
  eq(both.map((x) => x.creator.id).sort(), [...union].sort());
  eq(both.length, 11, '예산 여유 7명 + 신규 4명');
});
test('필터 없음 = 전체, 필터 후에도 추천 순위 숫자 유지', () => {
  eq(filterByTags(tf.items, new Set()).length, 21);
  const f = filterByTags(tf.items, new Set(['신규(평점 없음)']));
  eq(f.map((x) => x.rank), [8, 13, 15, 21]);
});

// ---------------------------------------------------------------
section('12. 주소(URL)로 조건 저장·복원 (뒤로가기)');
test('조건 → 주소 → 조건이 그대로 복원', () => {
  const c0 = cond({ budget: 3000000, categories: ['식품', '뷰티'], range: [MICRO, MICRO], platform: '유튜브', purpose: 'reach' });
  const f = queryToForm(conditionsToQuery(c0), S.categories);
  eq(normalizeConditions({ ...f, budget: Number(f.budgetText) }), c0);
});
test('기본값은 주소에 넣지 않음, 잘못된 값은 기본값으로', () => {
  eq(conditionsToQuery(cond({ budget: 1000 })), '?budget=1000');
  const f = queryToForm('?budget=5&cat=없는카테고리&range=2-0&platform=틱톡&purpose=x', S.categories);
  eq([f.categories, f.range, f.platform, f.purpose], [[], [0, 2], '전체', 'balanced']);
  eq(queryToForm('', S.categories), null, '조건 없는 주소');
});

// ---------------------------------------------------------------
render();

function render() {
  const all = sections.flatMap((s) => s.tests);
  const failed = all.filter((t) => !t.ok);
  const summary = document.getElementById('summary');
  summary.textContent = failed.length ? `FAIL ${failed.length} / ${all.length}` : `PASS ${all.length} / ${all.length}`;
  summary.className = failed.length ? 'fail' : 'pass';
  summary.dataset.failed = String(failed.length);
  document.getElementById('report').innerHTML = sections
    .map(
      (s) => `<h2>${s.name}</h2><ul>${s.tests
        .map((t) => `<li class="${t.ok ? 'ok' : 'ng'}">${escape(t.name)}${t.msg ? `<span class="msg">${escape(t.msg)}</span>` : ''}</li>`)
        .join('')}</ul>`,
    )
    .join('');
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
}
