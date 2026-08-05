const MLB_BASE = 'https://statsapi.mlb.com/api/v1';

/**
 * @typedef {object} HighlightItem
 * @property {string} [title]
 * @property {string} [type]
 * @property {{ name?: string, url?: string }[]} [playbacks]
 * @property {{ type?: string, value?: string }[]} [keywordsAll]
 */

/**
 * @param {number} gamePk
 * @returns {Promise<HighlightItem[]>}
 */
export async function fetchHighlightItems(gamePk) {
  const url = `${MLB_BASE}/game/${gamePk}/content`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB content error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return [
    ...(data.highlights?.highlights?.items ?? []),
    ...(data.highlights?.live?.items ?? []),
    ...(data.highlights?.scoreboard?.items ?? []),
    ...(data.highlights?.highlightPreview?.items ?? []),
  ];
}

/**
 * @param {HighlightItem} item
 * @param {string} playId
 * @returns {boolean}
 */
export function highlightMatchesPlayId(item, playId) {
  if (!item || !playId) return false;

  for (const kw of item.keywordsAll ?? []) {
    const type = (kw.type ?? '').toLowerCase();
    if (
      (type === 'play_id' || type === 'playid' || type === 'guid') &&
      kw.value === playId
    ) {
      return true;
    }
    if (kw.value === playId) return true;
  }

  // MLB often embeds the pitch playId in playback/asset metadata.
  return JSON.stringify(item).includes(playId);
}

/**
 * @param {HighlightItem[]} items
 * @param {string} playId
 * @returns {HighlightItem|null}
 */
export function findHighlightForPlayId(items, playId) {
  if (!playId || !items?.length) return null;
  return items.find((item) => highlightMatchesPlayId(item, playId)) ?? null;
}

/**
 * Prefer progressive mp4 for Slack unfurls; fall back to HLS.
 * @param {{ name?: string, url?: string }[]} [playbacks]
 * @returns {string|null}
 */
export function pickPlaybackUrl(playbacks) {
  if (!playbacks?.length) return null;

  const byName = (name) =>
    playbacks.find((p) => p.name === name && p.url)?.url ?? null;

  return (
    byName('mp4Avc') ||
    byName('highBit') ||
    playbacks.find((p) => p.url && /\.mp4(\?|$)/i.test(p.url))?.url ||
    byName('HTTP_CLOUD_WIRED') ||
    byName('HTTP_CLOUD_WIRED_60') ||
    byName('hlsCloud') ||
    playbacks.find((p) => p.url)?.url ||
    null
  );
}

/**
 * @param {string} url
 * @returns {string}
 */
export function formatHighlightReply(url) {
  return url;
}

/**
 * @param {number} gamePk
 * @param {string} playId
 * @returns {Promise<{ item: HighlightItem, url: string }|null>}
 */
export async function resolveHighlightVideo(gamePk, playId) {
  const items = await fetchHighlightItems(gamePk);
  const item = findHighlightForPlayId(items, playId);
  if (!item) return null;
  const url = pickPlaybackUrl(item.playbacks);
  if (!url) return null;
  return { item, url };
}
