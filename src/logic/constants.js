// PRD.md v0.7 기준 상수. 값을 바꾸면 추천 결과가 바뀌므로 PRD와 함께 수정한다.

export const DATA_URL = 'dummy_creators.csv';

// 2.2 팔로워 규모 구간
export const TIERS = [
  { key: 'nano', label: '나노', criteria: '1만 미만' },
  { key: 'micro', label: '마이크로', criteria: '1만~10만' },
  { key: 'macro', label: '매크로', criteria: '10만 이상' },
];
export const NANO = 0;
export const MICRO = 1;
export const MACRO = 2;
export const FULL_RANGE = [NANO, MACRO];

export function tierOf(followers) {
  if (followers == null) return null;
  if (followers < 10000) return NANO;
  if (followers < 100000) return MICRO;
  return MACRO;
}

// 2.3 플랫폼
export const ALL_PLATFORMS = '전체';
export const PLATFORMS = [ALL_PLATFORMS, '유튜브', '인스타그램'];

// 3.5 캠페인 목적별 가중치 (합계 100)
export const PURPOSES = {
  balanced: {
    label: '종합 추천',
    description: '성과·집행 이력·비용을 고루 반영',
    // v0.9: 실제 도달 규모를 반영하려고 평균 조회수 10 추가 (조회율 25→20, 조회당 비용 20→15)
    weights: { er: 25, vr: 20, views: 10, rating: 20, cpv: 15, exp: 10 },
  },
  reach: {
    label: '도달 중심',
    description: '많은 사람에게 보이는 것이 목표',
    weights: { views: 40, vr: 20, er: 15, rating: 15, exp: 10 },
  },
  engagement: {
    label: '참여 중심',
    description: '좋아요·댓글 등 반응이 목표',
    weights: { er: 45, cpe: 20, rating: 15, vr: 10, exp: 10 },
  },
  verified: {
    label: '검증된 크리에이터',
    description: '실패 위험을 줄이는 것이 목표',
    weights: { rating: 40, exp: 25, er: 15, vr: 10, cpv: 10 },
  },
};
export const DEFAULT_PURPOSE = 'balanced';

export const METRIC_LABELS = {
  er: '참여율',
  vr: '조회율',
  views: '평균 조회수',
  rating: '광고주 평점',
  cpv: '조회당 비용',
  cpe: '참여당 비용',
  exp: '캠페인 경험',
};

// 3.6 비용 태그·카드 상세의 비용 지표는 목적에 따라 하나만 쓴다
export function costMetricFor(purpose) {
  return purpose === 'engagement' ? 'cpe' : 'cpv';
}

// 3.4 보정 평점과 정규화
export const RATING_PRIOR_COUNT = 5;
export const RATING_NORM_MIN = 3.4;
export const RATING_NORM_MAX = 5.0;
export const EXP_LOG_DENOMINATOR = Math.log(31);
export const NEUTRAL = 0.5;

// 3.6 태그·배지 기준 (백분위는 0~1, 높을수록 값이 큼)
export const TOP_10_PCT = 0.9;
export const COST_LOW_PCT = 0.2;
export const RATING_TOP_PCT = 0.8;
export const EXP_RICH_COUNT = 22;
export const FIT_PCT = 0.7;
export const VERIFY_SCORE_WEIGHTS = { rating: 0.6, exp: 0.4 };
export const MAX_TAGS = 3;

// 3.6 예산 여유: 결과 수 × 30% 올림 (부동소수 오차를 피하려고 정수 비율로 둔다)
export const BUDGET_ROOM_NUMERATOR = 3;
export const BUDGET_ROOM_DENOMINATOR = 10;

// 3.7 / 3.8
export const MAX_ALTERNATIVES = 3;
export const MAX_SIMILAR = 3;
// 3.7.1 결과가 이 인원 이하이면 "N명 더" 제안을 함께 보여준다
export const FEW_RESULTS_MAX = 3;

// 3.7 완화안 3의 구간별 안내 문구. 단가 숫자만 로딩 시 계산하고 나머지는 PRD 문구 그대로 쓴다.
// 마이크로는 어느 쪽에서 넓히는지에 따라 문구가 다르다 (나노에서 위로 / 매크로에서 아래로)
export const RANGE_COPY = {
  [NANO]: { lead: '단가가 낮은 크리에이터를 원한다면' },
  [MACRO]: { lead: '더 많은 사람에게 보여주고 싶다면' },
  microFromNano: { lead: '더 많은 사람에게 보여주고 싶다면' },
  microFromMacro: { lead: '비용을 줄이면서 반응을 원한다면' },
};

export const SORT_OPTIONS = [
  { key: 'recommended', label: '추천순' },
  { key: 'er', label: '참여율' },
  { key: 'views', label: '평균 조회수' },
  { key: 'rating', label: '광고주 평점' },
  { key: 'count', label: '집행건수' },
  { key: 'price', label: '단가 낮은 순' },
];
