// 결과 영역 렌더링: 결과 요약, 조건 넓히기, 크리에이터 카드, 카드 상세, 0명 화면
// 문구는 모두 해요체로 쓴다 (PRD 4장, v1.0)
import { TIERS, PURPOSES, METRIC_LABELS, ALL_PLATFORMS, SORT_OPTIONS, RANGE_COPY, NANO, MICRO, costMetricFor } from '../logic/constants.js';
import { contributions, sortItems, filterByTags, tagCounts, buildTags } from '../logic/recommend.js';
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

// 안내 박스: 정보(info)와 주의(warn) 두 가지만 쓴다
function notice(text, tone = 'info') {
  return `<p class="notice notice--${tone}" role="note">${text}</p>`;
}

function conditionChips(cond) {
  const chips = [
    `1인당 예산 ${formatWon(cond.budget)}`,
    cond.categories.length ? cond.categories.join(', ') : '카테고리 전체',
    `규모 ${rangeLabel(cond.range)}`,
    cond.platform === ALL_PLATFORMS ? '플랫폼 전체' : cond.platform,
  ];
  return chips.map((c) => `<span class="chip chip--static">${escapeHtml(c)}</span>`).join('');
}

export function renderSummary(result, sortKey, tagFilter = new Set(), stats) {
  const { cond } = result;
  const ok = result.status === 'ok';
  const count = ok ? result.items.length : 0;
  const shown = ok ? filterByTags(result.items, tagFilter).length : 0;
  const shownText = tagFilter.size ? ` <span class="summary__purpose">· 태그로 ${shown}명 표시</span>` : '';
  const sortSelect = ok
    ? `<label class="sort">
        <span>정렬</span>
        <select id="sort-select">
          ${SORT_OPTIONS.map((o) => `<option value="${o.key}" ${o.key === sortKey ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </label>`
    : '';
  const categoryNotice = cond.categories.length
    ? ''
    : notice('카테고리를 선택하면 더 정확해요. 지금은 모든 카테고리에서 추천하고 있어요.');
  // 결과가 1~3명이면 0명일 때와 같은 "조건 넓히기" 영역을 결과 위에 보여준다
  const wider = ok && result.wider ? renderWider(result.wider, stats, `조건에 맞는 크리에이터가 ${count}명이에요.`) : '';
  return `
    <div class="summary">
      <div class="summary__main">
        <p class="summary__count"><strong>${count}명</strong> 추천 <span class="summary__purpose">· ${escapeHtml(PURPOSES[cond.purpose].label)} 기준</span>${shownText}</p>
        <div class="summary__chips">${conditionChips(cond)}</div>
      </div>
      ${sortSelect}
    </div>
    ${categoryNotice}
    ${wider}
    ${ok ? renderTagFilter(result.items, tagFilter) : ''}`;
}

// F7 태그 필터 칩 (여러 개 고르면 OR)
function renderTagFilter(items, tagFilter) {
  const counts = tagCounts(items);
  if (!counts.size) return '';
  const chips = [...counts]
    .map(
      ([label, n]) =>
        `<button type="button" class="chip chip--tag" data-tag-filter="${escapeHtml(label)}" aria-pressed="${tagFilter.has(label)}">${escapeHtml(label)} <span class="chip__count">${n}</span></button>`,
    )
    .join('');
  const reset = tagFilter.size ? '<button type="button" class="link-btn" data-tag-reset>필터 초기화</button>' : '';
  return `
    <div class="tag-filter" role="group" aria-label="태그로 거르기">
      <span class="tag-filter__label">태그로 보기 <span class="muted">(여러 개 고르면 하나라도 있는 크리에이터)</span></span>
      <div class="chips">${chips}</div>
      ${reset}
    </div>`;
}

// ---- 조건 넓히기 (PRD 3.7): 0명·1~3명 공통 ----

function renderWider(wider, stats, statusText) {
  const { suggestions, infos } = wider;
  const rows = [
    ...suggestions.map(
      (r, i) => `<li><button type="button" class="relax-btn" data-widen="${i}">
        <span>${suggestionText(r, stats)}</span><span class="relax-btn__go">적용하고 다시 추천 →</span>
      </button></li>`,
    ),
    // 예산 때문에 0명인 규모 방향: 누를 수 없는 안내 줄
    ...infos.map(
      (info) => `<li class="relax-info">ⓘ ${TIERS[info.tier].label}는 예산 <strong>${formatWon(info.minPrice)}</strong>부터 가능해요</li>`,
    ),
  ];
  return `
    <section class="widen">
      ${notice(statusText, 'warn')}
      ${rows.length ? `<h3>조건을 하나만 바꾸면 더 볼 수 있어요</h3><ul class="relax-list">${rows.join('')}</ul>` : ''}
    </section>`;
}

function suggestionText(r, stats) {
  const n = `${r.added}명 더`;
  switch (r.kind) {
    case 'budget':
      return `예산을 <strong>${formatWon(r.budget)}</strong>으로 올리면 <strong>${n}</strong>`;
    case 'platform':
      return `플랫폼을 <strong>전체</strong>로 넓히면 <strong>${n}</strong>`;
    case 'range':
      return rangeSuggestionText(r, n, stats);
    default:
      return '';
  }
}

// 모든 방향에 "앞 문구 → OO까지 넓히면 N명 더 (단가 X~Y원대)" 같은 형식을 쓴다
function rangeSuggestionText(r, n, stats) {
  let copy = RANGE_COPY[r.tier];
  // 마이크로: 넓힌 범위가 나노를 포함하면 나노에서 위로, 아니면 매크로에서 아래로 넓힌 것
  if (r.tier === MICRO) copy = r.apply.range[0] === NANO ? RANGE_COPY.microFromNano : RANGE_COPY.microFromMacro;
  const pr = stats.priceRange[r.tier];
  const priceText = pr ? ` <span class="muted">(단가 ${formatMan(pr.min)}~${formatMan(pr.max)} 원대)</span>` : '';
  return `${copy.lead} → <strong>${TIERS[r.tier].label}</strong>까지 넓히면 <strong>${n}</strong>${priceText}`;
}

// ---- 결과 목록 ----

export function renderResultList(result, sortKey, stats, tagFilter = new Set()) {
  const items = sortItems(filterByTags(result.items, tagFilter), sortKey);
  const ctx = { cond: result.cond, stats, fit: result.fit, mode: 'result' };
  return `<div class="cards">${items.map((item) => renderCard(item, ctx)).join('')}</div>`;
}

// mode: 'result' | 'nearby'
function renderCard(item, { cond, stats, fit, mode, diff = {} }) {
  const c = item.creator;
  const hl = (on) => (on ? ' is-diff' : '');
  const overBudget = c.price > cond.budget;

  // 신규는 단가 대신 비슷한 크리에이터 기준 추천 단가를 보여준다 (예산 판정은 같은 규모 최저 단가)
  const priceText = c.isNegotiable
    ? c.recPrice != null
      ? `추천 단가 약 ${formatWon(c.recPrice)}`
      : `예상 ${formatMan(c.priceRange.min)}~${formatWon(c.priceRange.max)}`
    : formatWon(c.price);
  const priceNote = [
    c.isNegotiable ? '<span class="badge badge--muted">협의 필요</span>' : '',
    mode === 'result' && c.isNegotiable && c.recPrice > cond.budget
      ? '<span class="over over--soft">추천 단가가 예산을 넘을 수 있어요</span>'
      : '',
    mode !== 'result' && overBudget
      ? `<span class="over">예산 초과 +${formatWon(c.price - cond.budget)}${c.isNegotiable ? ' (최저 기준)' : ''}</span>`
      : '',
  ].join('');

  const rank = mode === 'result' ? `<span class="rank" title="추천순 기준 순위">${item.rank}위</span>` : '';
  // 가까운 후보 카드는 근거 태그 없이 주의 태그(신규)만 붙인다
  const tagList = mode === 'result' ? item.tags : [];
  const cautions = mode === 'result' ? item.cautions : buildTags(c, cond.purpose).cautions;
  const tags =
    tagList.length || cautions.length
      ? `<ul class="tags">
          ${tagList.map((t) => `<li class="tag tag--${t.type}">${escapeHtml(t.label)}</li>`).join('')}
          ${cautions.map((t) => `<li class="tag tag--caution">${escapeHtml(t.label)}</li>`).join('')}
        </ul>`
      : '';
  const rating = c.hasHistory && c.rating != null ? `${c.rating.toFixed(1)} <span class="muted">(${c.count}건)</span>` : '신규(0건)';

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
        ${renderDetail(c, { purpose: cond.purpose, budget: cond.budget, stats, fit, score: item.score })}
      </details>
    </article>`;
}

function levelRow(label, value, level) {
  return `<li><span class="level__label">${label}</span><span class="level__value">${value}</span><span class="level__pct">${level}</span></li>`;
}

function renderDetail(c, { purpose, budget, stats, fit, score }) {
  const contrib = contributions(c, purpose, stats.normMeans, fit);
  const contribText = contrib.length
    ? `${contrib.map((x) => `<strong>${METRIC_LABELS[x.metric]}</strong>`).join(', ')}${subjectParticle(METRIC_LABELS[contrib.at(-1).metric])} 평균보다 좋아 순위를 끌어올렸어요`
    : '<span class="muted">두드러진 지표 없음</span>';

  const costMetric = costMetricFor(purpose);
  const costPct = c.pct[costMetric];
  const costRaw = c.raw[costMetric];
  const pctText = (p, scope = SAME_TIER) => (p == null ? '<span class="muted">-</span>' : `${scope} 상위 ${topPercent(p)}%`);
  const dash = '<span class="muted">-</span>';

  const levels = [
    levelRow('참여율', formatPercent(c.er), pctText(c.pct.er)),
    levelRow('조회율', c.raw.vr == null ? '-' : c.raw.vr.toFixed(2), pctText(c.pct.vr, '플랫폼 내')),
    levelRow('광고주 평점', c.hasHistory ? `보정 ${c.adjRating.toFixed(2)}` : '신규(0건)', c.hasHistory ? pctText(c.pct.ratingTier) : dash),
    levelRow(
      METRIC_LABELS[costMetric],
      costRaw == null ? '-' : `${formatNumber(costRaw)}원`,
      // 비용은 낮을수록 좋으므로 백분위가 낮을수록 상위
      costPct == null ? '<span class="muted">단가 협의 필요라 비교하지 않음</span>' : `${SAME_TIER} 상위 ${topPercent(1 - costPct)}%`,
    ),
    levelRow('캠페인 경험', c.hasHistory ? `${c.count}건` : '0건 (신규)', c.hasHistory ? pctText(c.pct.countTier) : dash),
    // 예산적합도: 종합 추천일 때만, 백분위가 아니라 1인당 예산 대비 사용 비율로 표기
    'budget' in PURPOSES[purpose].weights
      ? levelRow(
          '예산적합도',
          c.isNegotiable ? '-' : formatWon(c.price),
          c.isNegotiable ? '<span class="muted">단가 협의 필요</span>' : `1인당 예산의 ${Math.round((c.price / budget) * 100)}% 사용`,
        )
      : '',
  ].join('');

  const badge = (on, label) => `<span class="fit${on ? ' fit--on' : ''}">${on ? '✓ ' : ''}${label}</span>`;
  const fitList = `
    <ul class="fit-list">
      <li>${badge(c.flags.fitReach, '도달 캠페인 적합')}<span class="muted">평균 조회수 ${pctText(c.pct.views)}</span></li>
      <li>${badge(c.flags.fitEngagement, '참여 캠페인 적합')}<span class="muted">참여율 ${pctText(c.pct.er)}</span></li>
      <li>${
        c.hasHistory
          ? `${badge(c.flags.fitVerified, '검증됨')}<span class="muted">검증 점수 ${pctText(c.pct.verify)}</span>`
          : `${badge(false, '검증됨')}<span class="muted">검증 이력 없음</span>`
      }</li>
    </ul>`;

  // 신규 추천 단가의 근거 (PRD 3.2)
  const recPrice =
    c.isNegotiable && c.recRefs.length
      ? `<section>
          <h4>추천 단가 <span class="muted">(참고용, 협의 필요)</span></h4>
          <p>비슷한 크리에이터 ${c.recRefs.map((r) => `${escapeHtml(r.name)}(${formatWon(r.price)})`).join(', ')}의 평균이에요.
          같은 규모 단가 범위는 ${formatMan(c.priceRange.min)}~${formatWon(c.priceRange.max)}이에요.</p>
        </section>`
      : '';

  return `
    <div class="detail__body">
      <section class="score">
        <h4>매칭 점수 <span class="muted">(${escapeHtml(PURPOSES[purpose].label)} 기준)</span></h4>
        <p><strong class="score__value">${score.toFixed(1)}</strong><span class="muted"> / 100점</span></p>
      </section>
      ${recPrice}
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
        ${fitList}
      </section>
    </div>`;
}

// ---- 0명 화면 (PRD 3.7, 3.8) ----

export function renderEmpty(result, stats) {
  const { cond, cause, wider, nearby } = result;
  const statusText = cause === 'budget' ? '이 예산으로 집행할 수 있는 크리에이터가 없어요.' : '조건에 맞는 크리에이터가 없어요.';

  const nearbyHtml = nearby.length
    ? `<section class="empty__block">
        <h3>이런 크리에이터는 어떠세요?</h3>
        <p class="muted">조건과 <mark class="is-diff">다른 값</mark>을 표시했어요. 덜 바뀐 순서로 보여드려요. 조건은 바뀌지 않아요.</p>
        <div class="cards">${nearby
          .map((item) =>
            renderCard(item, { cond, stats, mode: 'nearby', diff: { platform: item.platformDiff, tier: item.tierDiff } }),
          )
          .join('')}</div>
      </section>`
    : notice('입력값을 다시 확인해 주세요.', 'warn');

  return `
    <div class="empty">
      ${renderWider(wider, stats, statusText)}
      ${nearbyHtml}
    </div>`;
}
