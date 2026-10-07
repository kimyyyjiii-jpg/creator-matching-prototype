import { DATA_URL } from '../logic/constants.js';
import { parseCSV } from './csv.js';
import { buildDataset } from './dataset.js';

export async function loadDataset(url = DATA_URL) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`CSV 요청 실패 (HTTP ${res.status})`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('CSV에 데이터가 없습니다');
  return buildDataset(rows);
}
