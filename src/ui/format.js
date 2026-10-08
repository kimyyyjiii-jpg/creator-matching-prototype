const nf = new Intl.NumberFormat('ko-KR');

function trimDecimal(x) {
  return nf.format(Math.round(x * 10) / 10);
}

// 반올림 없이 정확한 금액으로 표기한다.
// 1500000 → "150만 원", 365000 → "36.5만 원", 1234567 → "123만 4,567원", 9000 → "9,000원"
export function formatWon(won) {
  if (won == null || !Number.isFinite(won)) return '-';
  if (won < 1e4) return `${nf.format(won)}원`;
  // 1억 미만이고 천 원 단위로 떨어지면 소수 한 자리 만 원 표기가 정확하다
  if (won < 1e8 && won % 1000 === 0) return `${nf.format(won / 1e4)}만 원`;
  const eok = Math.floor(won / 1e8);
  const man = Math.floor((won % 1e8) / 1e4);
  const rest = won % 1e4;
  const parts = [];
  if (eok) parts.push(`${nf.format(eok)}억`);
  if (man) parts.push(`${nf.format(man)}만`);
  if (rest) parts.push(`${nf.format(rest)}원`);
  else parts[parts.length - 1] += ' 원';
  return parts.join(' ');
}

// "21만" (단가 범위 문구용, "원" 없이)
export function formatMan(won) {
  return `${trimDecimal(won / 1e4)}만`;
}

export function formatCount(n) {
  if (n == null) return '-';
  if (n >= 1e4) return `${trimDecimal(n / 1e4)}만`;
  return nf.format(n);
}

export function formatNumber(n) {
  return n == null ? '-' : nf.format(Math.round(n));
}

export function formatPercent(n) {
  return n == null ? '-' : `${n.toFixed(1)}%`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
