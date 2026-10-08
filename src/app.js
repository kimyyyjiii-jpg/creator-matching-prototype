import { TIERS, PLATFORMS, PURPOSES, ALL_PLATFORMS, DEFAULT_PURPOSE, FULL_RANGE, SORT_OPTIONS } from './logic/constants.js';
import { validateBudget, normalizeConditions, recommend } from './logic/recommend.js';
import { loadDataset } from './data/load.js';
import { renderSummary, renderResultList, renderEmpty, rangeLabel } from './ui/render.js';
import { formatWon, escapeHtml } from './ui/format.js';
import { conditionsToQuery, queryToForm } from './ui/urlState.js';

const state = {
  dataset: null,
  form: { budgetText: '', categories: [], range: [...FULL_RANGE], platform: ALL_PLATFORMS, purpose: DEFAULT_PURPOSE },
  result: null,
  sortKey: 'recommended',
  tagFilter: new Set(),
};

const defaultForm = () => ({ budgetText: '', categories: [], range: [...FULL_RANGE], platform: ALL_PLATFORMS, purpose: DEFAULT_PURPOSE });

const $ = (id) => document.getElementById(id);
const els = {
  form: $('condition-form'),
  budget: $('budget'),
  budgetReadable: $('budget-readable'),
  budgetError: $('budget-error'),
  chips: $('category-chips'),
  rangeMin: $('range-min'),
  rangeMax: $('range-max'),
  rangeFill: $('range-fill'),
  rangeLabels: $('range-labels'),
  rangeReadable: $('range-readable'),
  platforms: $('platform-options'),
  purposes: $('purpose-options'),
  submit: $('submit-btn'),
  results: $('results'),
  toast: $('toast'),
};

// ---------- 데이터 로딩 ----------

async function init() {
  els.results.innerHTML = '<div class="placeholder">데이터를 불러오는 중…</div>';
  els.submit.disabled = true;
  try {
    state.dataset = await loadDataset();
  } catch (err) {
    els.results.innerHTML = `
      <div class="load-error" role="alert">
        <p>크리에이터 데이터를 불러오지 못했습니다.</p>
        <p class="muted">${escapeHtml(err.message)}</p>
        <button type="button" id="retry-btn" class="secondary">다시 시도</button>
      </div>`;
    $('retry-btn').addEventListener('click', init);
    return;
  }
  buildStaticControls();
  syncForm();
  els.submit.disabled = false;
  // 주소에 조건이 있으면(뒤로가기·공유 링크) 그 조건으로 바로 추천한다
  if (!restoreFromUrl()) showPlaceholder();
}

function showPlaceholder() {
  state.result = null;
  els.results.innerHTML = `<div class="placeholder">조건을 입력하고 <strong>추천받기</strong>를 눌러 주세요.<br /><span class="muted">크리에이터 ${state.dataset.creators.length}명 데이터 로드 완료</span></div>`;
}

// ---------- 브라우저 이동 (뒤로가기·앞으로가기) ----------

function restoreFromUrl() {
  const form = queryToForm(location.search, state.dataset.stats.categories);
  if (!form) return false;
  state.form = form;
  syncForm();
  runRecommendation({ push: false, toast: false });
  return true;
}

window.addEventListener('popstate', () => {
  if (!state.dataset) return;
  if (!restoreFromUrl()) {
    state.form = defaultForm();
    syncForm();
    showPlaceholder();
  }
});

// ---------- 폼 ----------

let controlsBuilt = false;
function buildStaticControls() {
  if (controlsBuilt) return;
  controlsBuilt = true;

  // "전체" 칩: 카테고리를 하나도 고르지 않은 상태(= 전체)를 표시한다.
  // 다른 칩을 고르면 꺼지고, 누르면 선택한 카테고리를 모두 해제한다.
  const categories = [...state.dataset.stats.categories].sort((a, b) => a.localeCompare(b, 'ko'));
  els.chips.innerHTML = [
    `<button type="button" class="chip" data-category-all aria-pressed="true">전체</button>`,
    ...categories.map((c) => `<button type="button" class="chip" data-category="${escapeHtml(c)}" aria-pressed="false">${escapeHtml(c)}</button>`),
  ].join('');
  els.chips.addEventListener('click', (e) => {
    if (e.target.closest('[data-category-all]')) {
      state.form.categories = [];
      syncForm();
      return;
    }
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    const cat = btn.dataset.category;
    const set = new Set(state.form.categories);
    set.has(cat) ? set.delete(cat) : set.add(cat);
    state.form.categories = categories.filter((c) => set.has(c));
    syncForm();
  });

  // 구간 이름·기준을 누르면 그 구간만 선택 (범위는 핸들을 끌어서 고른다)
  els.rangeLabels.innerHTML = TIERS.map(
    (t, i) => `<li><button type="button" class="range__stop" data-tier="${i}" aria-label="${t.label}만 선택"><strong>${t.label}</strong><span>${t.criteria}</span></button></li>`,
  ).join('');
  els.rangeLabels.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tier]');
    if (!btn) return;
    const t = Number(btn.dataset.tier);
    state.form.range = [t, t];
    syncForm();
  });
  const onRange = (which) => () => {
    let lo = Number(els.rangeMin.value);
    let hi = Number(els.rangeMax.value);
    // 시작이 끝을 넘으면 다른 쪽 핸들을 함께 민다 (이어진 구간만 선택)
    if (lo > hi) {
      if (which === 'min') hi = lo;
      else lo = hi;
    }
    state.form.range = [lo, hi];
    syncForm();
  };
  els.rangeMin.addEventListener('input', onRange('min'));
  els.rangeMax.addEventListener('input', onRange('max'));

  els.platforms.innerHTML = PLATFORMS.map(
    (p) => `<label><input type="radio" name="platform" value="${p}" /><span>${p}</span></label>`,
  ).join('');
  els.platforms.addEventListener('change', (e) => {
    state.form.platform = e.target.value;
  });

  els.purposes.innerHTML = Object.entries(PURPOSES)
    .map(
      ([key, p]) => `<label><input type="radio" name="purpose" value="${key}" />
        <span><strong>${p.label}</strong><small>${p.description}</small></span></label>`,
    )
    .join('');
  els.purposes.addEventListener('change', (e) => {
    state.form.purpose = e.target.value;
  });

  els.budget.addEventListener('input', () => {
    state.form.budgetText = els.budget.value;
    showBudgetReadable();
    els.budgetError.hidden = true;
    els.budget.removeAttribute('aria-invalid');
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    runRecommendation();
  });

  els.results.addEventListener('click', onResultsClick);
  els.results.addEventListener('change', (e) => {
    if (e.target.id === 'sort-select') {
      state.sortKey = e.target.value;
      renderResults();
      const label = SORT_OPTIONS.find((o) => o.key === state.sortKey).label;
      showToast(`${label.endsWith('순') ? label : `${label}순`}으로 정렬했어요`);
    }
  });
}

function showBudgetReadable() {
  const v = validateBudget(state.form.budgetText);
  els.budgetReadable.textContent = v.ok ? `= ${formatWon(v.value)}` : '';
}

// state.form → 화면 컨트롤
function syncForm() {
  const f = state.form;
  els.budget.value = f.budgetText;
  showBudgetReadable();

  els.chips.querySelectorAll('[data-category]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(f.categories.includes(btn.dataset.category)));
  });
  els.chips.querySelector('[data-category-all]')?.setAttribute('aria-pressed', String(f.categories.length === 0));

  const [lo, hi] = f.range;
  els.rangeMin.value = lo;
  els.rangeMax.value = hi;
  els.rangeFill.style.left = `${(lo / 2) * 100}%`;
  els.rangeFill.style.width = `${((hi - lo) / 2) * 100}%`;
  els.rangeLabels.querySelectorAll('li').forEach((li, i) => li.classList.toggle('is-on', i >= lo && i <= hi));
  els.rangeReadable.textContent = `${rangeLabel(f.range)} 선택됨`;

  els.platforms.querySelectorAll('input').forEach((i) => (i.checked = i.value === f.platform));
  els.purposes.querySelectorAll('input').forEach((i) => (i.checked = i.value === f.purpose));
}

// ---------- 추천 ----------

function runRecommendation({ push = true, toast = true } = {}) {
  const v = validateBudget(state.form.budgetText);
  if (!v.ok) {
    els.budgetError.textContent = v.error;
    els.budgetError.hidden = false;
    els.budget.setAttribute('aria-invalid', 'true');
    els.budget.focus();
    return;
  }
  const cond = normalizeConditions({ ...state.form, budget: v.value });
  state.result = recommend(state.dataset, cond);
  state.sortKey = 'recommended';
  state.tagFilter = new Set();
  renderResults();
  if (push) {
    const query = conditionsToQuery(cond);
    if (query !== location.search) history.pushState(null, '', query);
  }
  if (toast) showToast('결과를 업데이트했습니다');
}

// 같은 조건으로 다시 실행해도 실행됐음을 알 수 있도록 짧게 띄운다 (TC-4-13)
let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2000);
}

function renderResults() {
  const { result, sortKey, dataset } = state;
  if (!result) return;
  const { tagFilter } = state;
  const body = result.status === 'ok' ? renderResultList(result, sortKey, dataset.stats, tagFilter) : renderEmpty(result, dataset.stats);
  els.results.innerHTML = renderSummary(result, sortKey, tagFilter, dataset.stats) + body;
}

function onResultsClick(e) {
  if (!state.result) return;

  // F7 태그 필터 (OR). 결과는 다시 계산하지 않고 보이는 카드만 거른다
  const tagBtn = e.target.closest('[data-tag-filter]');
  if (tagBtn) {
    const label = tagBtn.dataset.tagFilter;
    state.tagFilter.has(label) ? state.tagFilter.delete(label) : state.tagFilter.add(label);
    renderResults();
    return;
  }
  if (e.target.closest('[data-tag-reset]')) {
    state.tagFilter = new Set();
    renderResults();
    return;
  }

  // 완화안(0명) 또는 "N명 더" 제안(1~3명)
  const relaxBtn = e.target.closest('[data-relax]');
  const moreBtn = e.target.closest('[data-more]');
  const relax =
    relaxBtn && state.result.status === 'empty'
      ? state.result.relaxations[Number(relaxBtn.dataset.relax)]
      : moreBtn && state.result.status === 'ok'
        ? state.result.more[Number(moreBtn.dataset.more)]
        : null;
  if (!relax) return;
  // 완화안은 해당 조건을 폼에 반영한 뒤 다시 추천한다 (나머지 조건은 그대로)
  const a = relax.apply;
  if ('budget' in a) state.form.budgetText = String(a.budget);
  if ('platform' in a) state.form.platform = a.platform;
  if ('range' in a) state.form.range = [...a.range];
  if ('categories' in a) state.form.categories = [...a.categories];
  // 폼에 남아 있는 다른 미적용 변경이 섞이지 않도록, 완화 대상 외 조건은 마지막 실행값으로 맞춘다
  const applied = state.result.cond;
  if (!('budget' in a)) state.form.budgetText = String(applied.budget);
  if (!('platform' in a)) state.form.platform = applied.platform;
  if (!('range' in a)) state.form.range = [...applied.range];
  if (!('categories' in a)) state.form.categories = [...applied.categories];
  state.form.purpose = applied.purpose;
  syncForm();
  runRecommendation();
  els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

init();
