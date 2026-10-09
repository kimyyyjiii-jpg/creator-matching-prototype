// PRD 3.2 데이터 정제 + 3.4 지표·백분위 + 3.6 태그·배지 판정에 필요한 값을 로딩 시 한 번 계산한다.
// 원본 CSV는 건드리지 않고 메모리의 객체만 만든다.
import {
  TIERS,
  tierOf,
  NEUTRAL,
  RATING_PRIOR_COUNT,
  RATING_NORM_MIN,
  RATING_NORM_MAX,
  EXP_LOG_DENOMINATOR,
  TOP_10_PCT,
  COST_LOW_PCT,
  RATING_TOP_PCT,
  EXP_RICH_COUNT,
  FIT_PCT,
  VERIFY_SCORE_WEIGHTS,
  METRIC_LABELS,
  REC_PRICE_NEIGHBORS,
} from '../logic/constants.js';
import { groupPercentiles, median } from '../logic/percentile.js';

// 음수·형식 오류·결측은 null로 돌려 해당 지표만 중립 처리한다.
function toNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function safeDivide(a, b) {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

export function buildDataset(rows) {
  const dropped = [];
  const base = [];

  for (const row of rows) {
    const id = (row.creator_id ?? '').trim();
    const name = (row.creator_name ?? '').trim();
    if (!id || !name) {
      dropped.push(row);
      continue;
    }
    const followers = toNumber(row.followers);
    const count = toNumber(row.total_campaign_count);
    base.push({
      id,
      name,
      category: (row.category ?? '').trim(),
      platform: (row.platform ?? '').trim(),
      followers,
      views: toNumber(row.avg_view_count),
      er: toNumber(row.engagement_rate),
      count: count ?? 0,
      rawPrice: toNumber(row.avg_campaign_budget_krw),
      rating: toNumber(row.advertiser_rating),
      tier: tierOf(followers),
    });
  }

  // 이력이 있는 크리에이터 = 집행건수 1건 이상이고 단가가 0원이 아닌 경우
  for (const c of base) {
    c.hasHistory = c.count > 0 && c.rawPrice != null && c.rawPrice > 0;
  }

  // 같은 규모에서 이력이 있는 크리에이터의 단가 범위 (0원 제외)
  const priceRange = {};
  const medianViews = {};
  TIERS.forEach((_, t) => {
    const prices = base.filter((c) => c.tier === t && c.hasHistory).map((c) => c.rawPrice);
    priceRange[t] = prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
    medianViews[t] = median(base.filter((c) => c.tier === t && c.views != null).map((c) => c.views));
  });

  // 보정 평점의 전체 평균: 평점이 있는 크리에이터로 계산
  const rated = base.filter((c) => c.rating != null).map((c) => c.rating);
  const ratingMean = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

  for (const c of base) {
    // 신규(이력 없음)는 단가를 알 수 없다(협의 필요). 화면에는 같은 규모의 단가 범위를 보여주고,
    // 예산 판정·완화안·대안 계산에는 그 범위의 최저 단가를 쓴다 (PRD 3.2, 3.3)
    c.isNegotiable = !c.hasHistory;
    c.priceRange = c.isNegotiable && c.tier != null ? priceRange[c.tier] : null;
    c.price = c.hasHistory ? c.rawPrice : c.priceRange ? c.priceRange.min : null;

    c.adjRating =
      c.rating != null && ratingMean != null
        ? (c.count * c.rating + RATING_PRIOR_COUNT * ratingMean) / (c.count + RATING_PRIOR_COUNT)
        : ratingMean;

    c.raw = {
      vr: safeDivide(c.views, c.followers),
      // 비용 지표는 이력이 있을 때만 계산 (단가를 모르는 신규는 비교하지 않음)
      cpv: c.hasHistory ? safeDivide(c.price, c.views) : null,
      cpe: c.hasHistory && c.er != null ? safeDivide(c.price, c.followers != null ? c.followers * (c.er / 100) : null) : null,
    };
  }

  // 백분위: 모집단은 200명 전체를 구간(조회율은 플랫폼)별로 나눈 집단
  const byTier = (c) => c.tier;
  const pct = {
    er: groupPercentiles(base, { value: (c) => c.er, group: byTier }),
    vr: groupPercentiles(base, { value: (c) => c.raw.vr, group: (c) => c.platform || null }),
    views: groupPercentiles(base, { value: (c) => c.views, group: byTier }),
    cpv: groupPercentiles(base, { value: (c) => c.raw.cpv, group: byTier }),
    cpe: groupPercentiles(base, { value: (c) => c.raw.cpe, group: byTier }),
    ratingAll: groupPercentiles(base, { value: (c) => c.adjRating, group: () => 'all' }),
    ratingTier: groupPercentiles(base, { value: (c) => c.adjRating, group: byTier }),
    countTier: groupPercentiles(base, { value: (c) => c.count, group: byTier }),
  };

  for (const c of base) {
    const ratingNorm =
      c.adjRating != null ? (c.adjRating - RATING_NORM_MIN) / (RATING_NORM_MAX - RATING_NORM_MIN) : NEUTRAL;
    const expNorm = Math.min(1, Math.log(1 + c.count) / EXP_LOG_DENOMINATOR);
    const cpvPct = pct.cpv.get(c.id);
    const cpePct = pct.cpe.get(c.id);

    // 0~1 정규화 값. 계산할 수 없는 지표는 중립값 0.5
    c.norm = {
      er: pct.er.get(c.id) ?? NEUTRAL,
      vr: pct.vr.get(c.id) ?? NEUTRAL,
      views: pct.views.get(c.id) ?? NEUTRAL,
      rating: ratingNorm,
      cpv: cpvPct != null ? 1 - cpvPct : NEUTRAL,
      cpe: cpePct != null ? 1 - cpePct : NEUTRAL,
      exp: expNorm,
    };
    c.verifyScore = VERIFY_SCORE_WEIGHTS.rating * ratingNorm + VERIFY_SCORE_WEIGHTS.exp * expNorm;
    c.pct = {
      er: pct.er.get(c.id) ?? null,
      vr: pct.vr.get(c.id) ?? null,
      views: pct.views.get(c.id) ?? null,
      cpv: cpvPct ?? null,
      cpe: cpePct ?? null,
      ratingAll: pct.ratingAll.get(c.id) ?? null,
      ratingTier: pct.ratingTier.get(c.id) ?? null,
      countTier: pct.countTier.get(c.id) ?? null,
    };
  }

  const verifyPct = groupPercentiles(base, { value: (c) => c.verifyScore, group: byTier });

  for (const c of base) {
    c.pct.verify = verifyPct.get(c.id) ?? null;
    c.flags = {
      erTop: c.pct.er != null && c.pct.er >= TOP_10_PCT,
      vrTop: c.pct.vr != null && c.pct.vr >= TOP_10_PCT,
      cpvLow: c.pct.cpv != null && c.pct.cpv <= COST_LOW_PCT,
      cpeLow: c.pct.cpe != null && c.pct.cpe <= COST_LOW_PCT,
      ratingTop: c.pct.ratingAll != null && c.pct.ratingAll >= RATING_TOP_PCT,
      expRich: c.count >= EXP_RICH_COUNT,
      fitReach: c.pct.views != null && c.pct.views >= FIT_PCT,
      fitEngagement: c.pct.er != null && c.pct.er >= FIT_PCT,
      fitVerified: c.hasHistory && c.pct.verify != null && c.pct.verify >= FIT_PCT,
    };
  }

  assignRecommendedPrices(base);

  // 추천 기여 지표 계산용: 200명 전체의 정규화 값 평균 (예산적합도는 후보마다 달라 제외)
  const normMeans = {};
  for (const key of Object.keys(METRIC_LABELS).filter((k) => k !== 'budget')) {
    normMeans[key] = base.reduce((sum, c) => sum + c.norm[key], 0) / (base.length || 1);
  }

  // 평점 우수 기준값(표시·검증용): 상위 20%에 든 크리에이터 중 최저 보정 평점
  const topRated = base.filter((c) => c.flags.ratingTop).map((c) => c.adjRating);
  const ratingTopCut = topRated.length ? Math.min(...topRated) : null;

  const categories = [...new Set(base.map((c) => c.category).filter(Boolean))];

  return {
    creators: base,
    dropped,
    stats: { ratingMean, priceRange, medianViews, normMeans, ratingTopCut, categories },
  };
}

// 3.2 신규 추천 단가 (v1.0): 같은 플랫폼·같은 규모의 이력 있는 크리에이터 중
// 팔로워(로그)·조회율·참여율이 가장 비슷한 2명의 단가 평균을 만 원 단위로 반올림한다.
// 예산 판정에는 쓰지 않고(판정은 같은 규모 최저 단가), 화면의 참고 금액으로만 쓴다.
function assignRecommendedPrices(creators) {
  const features = (c) => [c.followers > 0 ? Math.log(c.followers) : null, c.raw.vr, c.er];
  const usable = (c) => features(c).every((x) => x != null && Number.isFinite(x));
  const history = creators.filter((c) => c.hasHistory && usable(c));

  // 이력 있는 크리에이터 기준으로 각 지표를 표준화해 단위 차이를 없앤다
  const scales = [0, 1, 2].map((i) => {
    const xs = history.map((c) => features(c)[i]);
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
    return { mean, sd };
  });
  const z = (c) => features(c).map((x, i) => (x - scales[i].mean) / scales[i].sd);

  for (const c of creators) {
    c.recPrice = null;
    c.recRefs = [];
    if (c.hasHistory || !usable(c)) continue;
    const zc = z(c);
    const nearest = history
      .filter((h) => h.platform === c.platform && h.tier === c.tier)
      .map((h) => ({ h, d: Math.hypot(...z(h).map((x, i) => x - zc[i])) }))
      .sort((a, b) => a.d - b.d || a.h.id.localeCompare(b.h.id))
      .slice(0, REC_PRICE_NEIGHBORS);
    if (!nearest.length) continue;
    const avg = nearest.reduce((sum, x) => sum + x.h.price, 0) / nearest.length;
    c.recPrice = Math.round(avg / 1e4) * 1e4;
    c.recRefs = nearest.map((x) => ({ id: x.h.id, name: x.h.name, price: x.h.price }));
  }
}
