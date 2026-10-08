// 결과 영역 렌더링: 결과 요약, 크리에이터 카드, 카드 상세, 빈 상태
import { TIERS, PURPOSES, METRIC_LABELS, ALL_PLATFORMS, SORT_OPTIONS, RANGE_COPY, NANO, MACRO, costMetricFor } from '../logic/constants.js';
import { contributions, sortItems } from '../logic/recommend.js';
import { topPercent } from '../logic/percentile.js';
import { formatWon, formatMan, formatCount, formatNumber, formatPercent, escapeHtml } from './format.js';

const tierLabel = (t) => (t == null ? '-' : TIERS[t].label);
// 상세 화면의 백분위 범위 표기. 폼의 "팔로워 규모"와 용어를 맞춘다
const SAME_TIER = '같은 규모 내';

// 마지막 글자의 받침 유무로 주격 조사(이/가)를 고른다
function subjectParticle(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return '이(가)';
  return code % 28 ? '이' : '가';
}

export function rangeLabel([lo, hi]) {
  return lo === hi ? TIERS[lo].label : `${TIERS[lo].label}~${TIERS[hi].label}`;
}

function conditionChips(cond) {
  const chips = [
    `예산 ${formatWon(cond.budget)}`,
    cond.categories.length ? cond.categories.join(', ') : '카테고리 전체',
    `규모 ${rangeLabel(cond.range)}`,
    cond.platform === ALL_PLATFORMS ? '플랫폼 전체' : cond.platform,
  ];
  return chips.map((c) => `<span class="chip chip--static">${escapeHtml(c)}</span>`).join('');
}

export function renderSummary(result, sortKey) {
  const { cond } = result;
  const count = result.status === 'ok' ? result.items.length : 0;
  const sortSelect =
    result.status === 'ok'
      ? `<label class="sort">
          <span>정렬</span>
          <select id="sort-select">
            ${SORT_OPTIONS.map((o) => `<option value="${o.key}" ${o.key === sortKey ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </label>`
      : '';
  const categoryNotice = cond.categories.length
    ? ''
    : '<p class="notice" role="note">카테고리를 선택하면 더 정확해요. 지금은 모든 카테고리에서 추천하고 있습니다.</p>';
  return `
    <div class="summary">
      <div class="summary__main">
        <p class="summary__count"><strong>${count}명</strong> 추천 <span class="summary__purpose">· ${escapeHtml(PURPOSES[cond.purpose].label)} 기준</span></p>
        <div class="summary__chips">${conditionChips(cond)}</div>
      </div>
      ${sortSelect}
    </div>
    ${categoryNotice}`;
}

export function renderResultList(result, sortKey, stats) {
  const items = sortItems(result.items, sortKey);
  return `<div class="cards">${items.map((item) => renderCard(item, { cond: result.cond, stats, mode: 'result' })).join('')}</div>`;
}

// mode: 'result' | 'alternative' | 'similar'
function renderCard(item, { cond, stats, mode, diff = {} }) {
  const c = item.creator;
  const hl = (on) => (on ? ' is-diff' : '');
  const overBudget = c.price > cond.budget;
  // 신규는 단가 대신 같은 규모의 단가 범위를 "예상"으로 보여준다
  const priceText =
    c.isNegotiable && c.priceRange
      ? `예상 ${formatMan(c.priceRange.min)}~${formatWon(c.priceRange.max)}`
      : formatWon(c.price);
  const priceNote = [
    c.isNegotiable ? '<span class="badge badge--muted">협의 필요</span>' : '',
    mode !== 'result' && overBudget
      ? `<span class="over">예산 초과 +${formatWon(c.price - cond.budget)}${c.isNegotiable ? ' (최저 기준)' : ''}</span>`
      : '',
  ].join('');

  const rank = mode === 'result' ? `<span class="rank" title="추천순 기준 순위">${item.rank}</span>` : '';
  const tags =
    mode === 'result'
      ? `<ul class="tags">
          ${item.tags.map((t) => `<li class="tag tag--${t.type}">${escapeHtml(t.label)}</li>`).join('')}
          ${item.cautions.map((t) => `<li class="tag tag--caution">${escapeHtml(t.label)}</li>`).join('')}
        </ul>`
      : '';
  const rating = c.rating != null ? `${c.rating.toFixed(1)} <span class="muted">(${c.count}건)</span>` : `<span class="muted">평가 없음 (${c.count}건)</span>`;

  return `
    <article class="card${mode !== 'result' ? ' card--alt' : ''}">
      <header class="card__head">
        ${rank}
        <div class="card__title">
          <h3>${escapeHtml(c.name)}</h3>
          <p class="card__meta">
            <span class="${hl(diff.platform)}">${escapeHtml(c.platform)}</span> ·
            <span>${escapeHtml(c.category)}</span> ·
            <span class="${hl(diff.tier)}">${tierLabel(c.tier)}</span>
          </p>
        </div>
      </header>
      <dl class="stats">
        <div><dt>팔로워</dt><dd class="${hl(diff.tier)}">${formatCount(c.followers)}</dd></div>
        <div><dt>참여율</dt><dd>${formatPercent(c.er)}</dd></div>
        <div><dt>평균 조회수</dt><dd>${formatCount(c.views)}</dd></div>
        <div><dt>평균 단가</dt><dd class="${hl(mode !== 'result' && overBudget)}">${priceText} ${priceNote}</dd></div>
        <div><dt>광고주 평점</dt><dd>${rating}</dd></div>
      </dl>
      ${tags}
      <details class="detail">
        <summary>추천 근거 보기</summary>
        ${renderDetail(c, cond.purpose, stats)}
      </details>
    </article>`;
}

function levelRow(label, value, level) {
  return `<li><span class="level__label">${label}</span><span class="level__value">${value}</span><span class="level__pct">${level}</span></li>`;
}

function renderDetail(c, purpose, stats) {
  const contrib = contributions(c, purpose, stats.normMeans);
  const contribText = contrib.length
    ? `${contrib.map((x) => `<strong>${METRIC_LABELS[x.metric]}</strong>`).join(', ')}${subjectParticle(METRIC_LABELS[contrib.at(-1).metric])} 평균보다 좋아 순위를 끌어올렸어요`
    : '<span class="muted">두드러진 지표 없음</span>';

  const costMetric = costMetricFor(purpose);
  const costPct = c.pct[costMetric];
  const costRaw = c.raw[costMetric];
  const pctText = (p, scope = SAME_TIER) => (p == null ? '<span class="muted">-</span>' : `${scope} 상위 ${topPercent(p)}%`);

  const levels = [
    levelRow('참여율', formatPercent(c.er), pctText(c.pct.er)),
    levelRow('조회율', c.raw.vr == null ? '-' : c.raw.vr.toFixed(2), pctText(c.pct.vr, '플랫폼 내')),
    levelRow(
      '광고주 평점',
      c.hasHistory ? `보정 ${c.adjRating.toFixed(2)}` : '평가 없음',
      c.hasHistory ? pctText(c.pct.ratingTier) : '<span class="muted">평가 이력 없음</span>',
    ),
    levelRow(
      METRIC_LABELS[costMetric],
      costRaw == null ? '-' : `${formatNumber(costRaw)}원`,
      // 비용은 낮을수록 좋으므로 백분위가 낮을수록 상위
      costPct == null ? '<span class="muted">단가 협의 필요라 비교하지 않음</span>' : `${SAME_TIER} 상위 ${topPercent(1 - costPct)}%`,
    ),
    levelRow(
      '캠페인 경험',
      `${c.count}건`,
      c.count > 0 ? pctText(c.pct.countTier) : '<span class="muted">집행 이력 없음</span>',
    ),
  ].join('');

  const badge = (on, label) => `<span class="fit${on ? ' fit--on' : ''}">${on ? '✓ ' : ''}${label}</span>`;
  const fit = `
    <ul class="fit-list">
      <li>${badge(c.flags.fitReach, '도달 캠페인 적합')}<span class="muted">평균 조회수 ${pctText(c.pct.views)}</span></li>
      <li>${badge(c.flags.fitEngagement, '참여 캠페인 적합')}<span class="muted">참여율 ${pctText(c.pct.er)}</span></li>
      <li>${
        c.hasHistory
          ? `${badge(c.flags.fitVerified, '검증됨')}<span class="muted">검증 점수 ${pctText(c.pct.verify)}</span>`
          : `${badge(false, '검증됨')}<span class="muted">검증 이력 없음</span>`
      }</li>
    </ul>`;

  return `
    <div class="detail__body">
      <section>
        <h4>이 순위를 받은 이유 <span class="muted">(${escapeHtml(PURPOSES[purpose].label)} 기준)</span></h4>
        <p>${contribText}</p>
      </section>
      <section>
        <h4>지표별 수준</h4>
        <ul class="levels">${levels}</ul>
      </section>
      <section>
        <h4>목적 적합도 <span class="muted">(선택한 목적과 무관)</span></h4>
        ${fit}
      </section>
    </div>`;
}

// ---- 빈 상태 (PRD 3.7, 3.8) ----

function relaxationText(r, stats) {
  switch (r.kind) {
    case 'budget':
      return `예산을 <strong>${formatWon(r.budget)}</strong>으로 올리면 <strong>${r.count}명</strong>`;
    case 'platform':
      return `플랫폼을 <strong>전체</strong>로 넓히면 <strong>${r.count}명</strong>`;
    case 'category':
      return `카테고리 조건을 <strong>해제</strong>하면 <strong>${r.count}명</strong>`;
    case 'range':
      return rangeRelaxationText(r, stats);
    default:
      return '';
  }
}

function rangeRelaxationText(r, stats) {
  const label = TIERS[r.tier].label;
  const base = `<strong>${label}</strong>까지 넓히면 <strong>${r.count}명</strong>`;
  if (r.tier === NANO) {
    const pr = stats.priceRange[NANO];
    return `${RANGE_COPY[NANO].lead} → ${base} <span class="muted">(단가 ${formatMan(pr.min)}~${formatMan(pr.max)} 원대)</span>`;
  }
  if (r.tier === MACRO) {
    const pr = stats.priceRange[MACRO];
    return `${RANGE_COPY[MACRO].lead} → ${base} <span class="muted">(평균 조회수 약 10배, 조회당 비용 최저 · 단, 단가 ${formatWon(pr.min)} 이상, 참여율은 낮은 편)</span>`;
  }
  return base;
}

export function renderEmpty(result, stats) {
  const { cond, cause, relaxations, rangeInfos, alternatives, similar } = result;
  const causeText = cause === 'budget' ? '이 예산으로 집행 가능한 후보가 없습니다.' : '선택한 조건에 맞는 크리에이터가 없습니다.';

  const relaxHtml = relaxations.length
    ? `<section class="empty__block">
        <h3>조건을 하나만 바꿔 보세요</h3>
        <ul class="relax-list">
          ${relaxations
            .map(
              (r, i) => `<li><button type="button" class="relax-btn" data-relax="${i}">
                <span>${relaxationText(r, stats)}</span><span class="relax-btn__go">적용하고 다시 추천 →</span>
              </button></li>`,
            )
            .join('')}
        </ul>
      </section>`
    : '';

  const infoHtml = rangeInfos.length
    ? `<ul class="info-list">${rangeInfos
        .map((info) => `<li>ⓘ ${TIERS[info.tier].label}는 예산 <strong>${formatWon(info.minPrice)}</strong>부터 가능합니다</li>`)
        .join('')}</ul>`
    : '';

  const altHtml = alternatives.length
    ? `<section class="empty__block">
        <h3>예산만 초과하는 후보 <span class="muted">(예산에 가까운 순)</span></h3>
        <div class="cards">${alternatives.map((item) => renderCard(item, { cond, stats, mode: 'alternative' })).join('')}</div>
      </section>`
    : '';

  let similarHtml = '';
  if (similar) {
    similarHtml = similar.items.length
      ? `<section class="empty__block">
          <h3>이런 크리에이터는 어떠세요?</h3>
          <p class="muted">${
            similar.overBudget ? '예산 안에 드는 비슷한 크리에이터가 없어 예산을 넘는 후보를 보여드립니다. ' : ''
          }원래 조건과 <mark class="is-diff">다른 값</mark>을 표시했어요. 조건은 바뀌지 않습니다.</p>
          <div class="cards">${similar.items
            .map((item) =>
              renderCard(item, { cond, stats, mode: 'similar', diff: { platform: item.platformDiff, tier: item.tierDiff } }),
            )
            .join('')}</div>
        </section>`
      : `<p class="empty__guide">입력값을 다시 확인해 주세요.</p>`;
  }

  return `
    <div class="empty">
      <p class="empty__cause">${causeText}</p>
      ${relaxHtml}
      ${infoHtml}
      ${altHtml}
      ${similarHtml}
    </div>`;
}
