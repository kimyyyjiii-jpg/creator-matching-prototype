const nf = new Intl.NumberFormat('ko-KR');

function trimDecimal(x) {
  return nf.format(Math.round(x * 10) / 10);
}

// 1500000 → "150만 원", 365000 → "36.5만 원", 9000 → "9,000원"
export function formatWon(won) {
  if (won == null || !Number.isFinite(won)) return '-';
  if (won >= 1e8) {
    const eok = Math.floor(won / 1e8);
    const rest = Math.round((won % 1e8) / 1e4);
    return rest ? `${nf.format(eok)}억 ${nf.format(rest)}만 원` : `${nf.format(eok)}억 원`;
  }
  if (won < 1e4) return `${nf.format(won)}원`;
  return `${trimDecimal(won / 1e4)}만 원`;
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
