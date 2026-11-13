/**
 * Static geography for the Haken map. Prefectures never change, so this ships with the bundle
 * (no API call); the API only supplies live job counts.
 *
 * Tile-grid cartogram: each prefecture is one cell (some 2 cells) on a 13x13 grid, laid out to
 * follow Japan's NE->SW shape. Unlike a geographic SVG, Tokyo/Kanagawa/Osaka get the same tap
 * area as Hokkaido, which matters on a 360px phone screen.
 */

export const REGION_CODES = [
  'hokkaido', 'tohoku', 'kanto', 'chubu', 'kansai', 'chugoku', 'shikoku', 'kyushu',
] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export function isRegionCode(v: unknown): v is RegionCode {
  return typeof v === 'string' && (REGION_CODES as readonly string[]).includes(v);
}

export interface Prefecture {
  id: number; // JIS X 0401 (matches DB prefectures.id)
  ja: string;
  en: string; // romaji: what foreign residents see on station signs
  region: RegionCode;
  x: number; // grid column
  y: number; // grid row
  w?: number;
  h?: number;
}

export const GRID_COLS = 13;
export const GRID_ROWS = 13;

// prettier-ignore
export const PREFECTURES: readonly Prefecture[] = [
  { id: 1, ja: '北海道', en: 'Hokkaido', region: 'hokkaido', x: 11, y: 0, w: 2, h: 2 },
  { id: 2, ja: '青森県', en: 'Aomori', region: 'tohoku', x: 11, y: 2 },
  { id: 3, ja: '岩手県', en: 'Iwate', region: 'tohoku', x: 11, y: 3 },
  { id: 4, ja: '宮城県', en: 'Miyagi', region: 'tohoku', x: 11, y: 4 },
  { id: 5, ja: '秋田県', en: 'Akita', region: 'tohoku', x: 10, y: 3 },
  { id: 6, ja: '山形県', en: 'Yamagata', region: 'tohoku', x: 10, y: 4 },
  { id: 7, ja: '福島県', en: 'Fukushima', region: 'tohoku', x: 10, y: 5, w: 2 },
  { id: 8, ja: '茨城県', en: 'Ibaraki', region: 'kanto', x: 11, y: 6 },
  { id: 9, ja: '栃木県', en: 'Tochigi', region: 'kanto', x: 10, y: 6 },
  { id: 10, ja: '群馬県', en: 'Gunma', region: 'kanto', x: 9, y: 6 },
  { id: 11, ja: '埼玉県', en: 'Saitama', region: 'kanto', x: 9, y: 7 },
  { id: 12, ja: '千葉県', en: 'Chiba', region: 'kanto', x: 11, y: 7, h: 2 },
  { id: 13, ja: '東京都', en: 'Tokyo', region: 'kanto', x: 10, y: 7 },
  { id: 14, ja: '神奈川県', en: 'Kanagawa', region: 'kanto', x: 10, y: 8 },
  { id: 15, ja: '新潟県', en: 'Niigata', region: 'chubu', x: 8, y: 5, w: 2 },
  { id: 16, ja: '富山県', en: 'Toyama', region: 'chubu', x: 7, y: 5 },
  { id: 17, ja: '石川県', en: 'Ishikawa', region: 'chubu', x: 6, y: 5 },
  { id: 18, ja: '福井県', en: 'Fukui', region: 'chubu', x: 6, y: 6 },
  { id: 19, ja: '山梨県', en: 'Yamanashi', region: 'chubu', x: 8, y: 7 },
  { id: 20, ja: '長野県', en: 'Nagano', region: 'chubu', x: 8, y: 6 },
  { id: 21, ja: '岐阜県', en: 'Gifu', region: 'chubu', x: 7, y: 6 },
  { id: 22, ja: '静岡県', en: 'Shizuoka', region: 'chubu', x: 8, y: 8, w: 2 },
  { id: 23, ja: '愛知県', en: 'Aichi', region: 'chubu', x: 7, y: 7 },
  { id: 24, ja: '三重県', en: 'Mie', region: 'kansai', x: 7, y: 8 },
  { id: 25, ja: '滋賀県', en: 'Shiga', region: 'kansai', x: 6, y: 7 },
  { id: 26, ja: '京都府', en: 'Kyoto', region: 'kansai', x: 5, y: 7 },
  { id: 27, ja: '大阪府', en: 'Osaka', region: 'kansai', x: 5, y: 8 },
  { id: 28, ja: '兵庫県', en: 'Hyogo', region: 'kansai', x: 4, y: 7, h: 2 },
  { id: 29, ja: '奈良県', en: 'Nara', region: 'kansai', x: 6, y: 8 },
  { id: 30, ja: '和歌山県', en: 'Wakayama', region: 'kansai', x: 5, y: 9 },
  { id: 31, ja: '鳥取県', en: 'Tottori', region: 'chugoku', x: 3, y: 7 },
  { id: 32, ja: '島根県', en: 'Shimane', region: 'chugoku', x: 2, y: 7 },
  { id: 33, ja: '岡山県', en: 'Okayama', region: 'chugoku', x: 3, y: 8 },
  { id: 34, ja: '広島県', en: 'Hiroshima', region: 'chugoku', x: 2, y: 8 },
  { id: 35, ja: '山口県', en: 'Yamaguchi', region: 'chugoku', x: 1, y: 8 },
  { id: 36, ja: '徳島県', en: 'Tokushima', region: 'shikoku', x: 4, y: 11 },
  { id: 37, ja: '香川県', en: 'Kagawa', region: 'shikoku', x: 4, y: 10 },
  { id: 38, ja: '愛媛県', en: 'Ehime', region: 'shikoku', x: 3, y: 10 },
  { id: 39, ja: '高知県', en: 'Kochi', region: 'shikoku', x: 3, y: 11 },
  { id: 40, ja: '福岡県', en: 'Fukuoka', region: 'kyushu', x: 1, y: 9 },
  { id: 41, ja: '佐賀県', en: 'Saga', region: 'kyushu', x: 0, y: 9 },
  { id: 42, ja: '長崎県', en: 'Nagasaki', region: 'kyushu', x: 0, y: 10 },
  { id: 43, ja: '熊本県', en: 'Kumamoto', region: 'kyushu', x: 1, y: 10 },
  { id: 44, ja: '大分県', en: 'Oita', region: 'kyushu', x: 2, y: 10 },
  { id: 45, ja: '宮崎県', en: 'Miyazaki', region: 'kyushu', x: 2, y: 11 },
  { id: 46, ja: '鹿児島県', en: 'Kagoshima', region: 'kyushu', x: 1, y: 11 },
  { id: 47, ja: '沖縄県', en: 'Okinawa', region: 'kyushu', x: 0, y: 12 },
];

export const PREFECTURE_BY_ID = new Map(PREFECTURES.map((p) => [p.id, p]));

/** Where each region's count badge sits on the national view (grid units, chosen to sit in the sea). */
export const REGION_LABEL_ANCHOR: Record<RegionCode, { x: number; y: number }> = {
  hokkaido: { x: 9.2, y: 1 },
  tohoku: { x: 8.6, y: 3.2 },
  kanto: { x: 11, y: 9.3 },
  chubu: { x: 7.5, y: 4.3 },
  kansai: { x: 6, y: 10.3 },
  chugoku: { x: 2.5, y: 6.4 },
  shikoku: { x: 6.3, y: 11.5 },
  kyushu: { x: 2.9, y: 12.6 },
};

/** Pastel per-region fills (Japanese-site style); text on top is navy for contrast. */
export const REGION_COLORS: Record<RegionCode, { fill: string; strong: string }> = {
  hokkaido: { fill: '#CFE3F5', strong: '#7FB0DD' },
  tohoku: { fill: '#D5ECD1', strong: '#8CC783' },
  kanto: { fill: '#FCE0C8', strong: '#F2A564' },
  chubu: { fill: '#E3D9F2', strong: '#A98BD6' },
  kansai: { fill: '#FAD4DE', strong: '#EE8AA5' },
  chugoku: { fill: '#FBF0C2', strong: '#E6C846' },
  shikoku: { fill: '#CDEEE9', strong: '#6CC7B9' },
  kyushu: { fill: '#EDE2D0', strong: '#C7A97A' },
};

/** Display name: Japanese UI shows kanji; every other locale shows romaji (matches signs & maps in Japan). */
export function prefectureName(p: Prefecture, locale: string): string {
  return locale === 'ja' ? p.ja : p.en;
}

/** Short tile label in Japanese: drop the 都/府/県 suffix (北海道 stays). */
export function prefectureShortName(p: Prefecture, locale: string): string {
  return locale === 'ja' && p.id !== 1 ? p.ja.replace(/[都府県]$/, '') : prefectureName(p, locale);
}

export function prefecturesOf(region: RegionCode): Prefecture[] {
  return PREFECTURES.filter((p) => p.region === region);
}

/* ---------- admin-managed overlay (names + map visibility), from GET /api/v1/places ---------- */
export interface PlacesInfo {
  prefectures: Record<number, { name: Record<string, string>; active: boolean }>;
  regions: Record<string, { name: Record<string, string>; active: boolean }>;
}

/** Admin-edited name for this locale if one exists, else the built-in kanji/romaji rule. */
export function placeName(p: Prefecture, locale: string, places?: PlacesInfo | null): string {
  return places?.prefectures[p.id]?.name?.[locale] || prefectureName(p, locale);
}

export function isPrefectureActive(p: Prefecture, places?: PlacesInfo | null): boolean {
  return (places?.prefectures[p.id]?.active ?? true) && (places?.regions[p.region]?.active ?? true);
}

export function isRegionActive(r: RegionCode, places?: PlacesInfo | null): boolean {
  return places?.regions[r]?.active ?? true;
}
