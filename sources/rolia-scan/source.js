const SOURCE_ID = "rolia-scan";
const SOURCE_NAME = "Rolia Scan";
const SOURCE_AUTHOR = "majorxsense-prog";
const SITE_BASE_URL = "https://roliascan.com";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    version: "0.1.2",
    language: "en",
    contentRating: "Mature",
    website: `${SITE_BASE_URL}/home/`,
    capabilities: [
      "CHAPTER_PROVIDING",
      "DISCOVER_SECTION_PROVIDING",
      "SEARCH_RESULT_PROVIDING"
    ]
  };
}

async function latestTitles(limit) {
  return discoverItems("latest_updates", limit || 20, 0);
}

async function discoverSections() {
  return [
    { id: "latest_updates", title: "Latest Updates", kind: "chapterUpdates" },
    { id: "recently_added", title: "Recently Added", kind: "simpleCarousel" },
    { id: "popular", title: "Popular", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const pageNumber = (Number(page) || 0) + 1;
  switch (sectionID) {
  case "popular":
    return fetchMangaList({ per_page: size, page: pageNumber, orderby: "comment_count", order: "desc" });
  case "recently_added":
    return fetchMangaList({ per_page: size, page: pageNumber, orderby: "date", order: "desc" });
  case "latest_updates":
  case "latest":
  default:
    return fetchMangaList({ per_page: size, page: pageNumber, orderby: "modified", order: "desc" });
  }
}

async function search(request) {
  const query = normalizeQuery(request && (request.title || request.query || request.text || request));
  const page = Number(request && request.page) || 0;
  if (!query) {
    return latestTitles(20);
  }
  return fetchMangaList({
    search: query,
    per_page: 20,
    page: page + 1,
    orderby: "relevance",
    order: "desc"
  });
}

async function details(title) {
  const slug = titleSlug(title);
  const html = await htmlGet(`/manga/${encodeURIComponent(slug)}/`);
  const base = titleFromObject(title);
  const mangaId = attr(firstMatch(html, /<body\b[^>]*>/i), "data-manga-id") || base.mangaId || base.mangaID || base.id;

  return titleDTO({
    id: slug,
    mangaId,
    title: firstClean([
      meta(html, "og:title").replace(/\s+(?:Manga|Manhwa|Manhua)\s*\|.*$/i, ""),
      firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
      base.title,
      slug.replace(/-/g, " ")
    ]),
    coverURL: firstClean([meta(html, "og:image"), firstImage(html), base.coverURL || base.coverUrl]),
    synopsis: firstClean([
      meta(html, "og:description"),
      firstMatch(html, /<div[^>]+class=["'][^"']*(?:summary|description|synopsis|manga-excerpt)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    ]),
    status: firstClean([fieldAfterLabel(html, "Status"), base.status]),
    type: "Manga",
    author: firstClean([fieldAfterLabel(html, "Author"), base.author]),
    artist: firstClean([fieldAfterLabel(html, "Artist"), base.artist]),
    latestChapter: base.latestChapter || "",
    chapterCount: base.chapterCount || chapterCountFromLatest(base.latestChapter),
    tags: parseTags(html)
  });
}

async function chapters(title) {
  const info = await details(title);
  const mangaId = info.mangaId || info.mangaID;
  if (!mangaId) {
    throw new Error("Rolia Scan did not expose a manga id for this title.");
  }

  const token = chapterListToken();
  const response = await apiGet(`/auth/manga-chapters?${queryString({
    manga_id: mangaId,
    offset: 0,
    limit: 500,
    order: "DESC",
    _t: token.token,
    _ts: token.timestamp
  })}`);
  const list = Array.isArray(response.chapters) ? response.chapters : [];
  return list.map(mapChapter).filter(Boolean);
}

async function chapterDetails(title, chapter) {
  const id = chapterNumericID(chapter);
  if (!id) {
    throw new Error("Rolia Scan chapter id is missing.");
  }

  const response = await apiGet(`/auth/chapter-content?chapter_id=${encodeURIComponent(id)}`);
  const images = Array.isArray(response.images) ? response.images : [];
  const pages = images
    .map((url, index) => url ? ({
      id: `${id}-${index}`,
      remoteURL: absoluteURL(url),
      remoteUrl: absoluteURL(url)
    }) : null)
    .filter(Boolean);

  if (!pages.length) {
    throw new Error("Rolia Scan did not return any readable pages for this chapter.");
  }

  let allChapters = [];
  try {
    allChapters = await chapters(title);
  } catch (error) {
    hostLog(`Unable to fetch Rolia chapter list for next/previous metadata: ${error.message || error}`);
  }

  const currentIndex = allChapters.findIndex((item) => chapterNumericID(item) === id);
  const nextChapter = currentIndex > 0 ? allChapters[currentIndex - 1] : null;
  const previousChapter = currentIndex >= 0 && currentIndex < allChapters.length - 1 ? allChapters[currentIndex + 1] : null;

  return {
    title,
    chapter: Object.assign({}, chapter, { pageCount: pages.length }),
    pages,
    nextChapter,
    previousChapter,
    prevChapter: previousChapter
  };
}

async function fetchMangaList(options) {
  const params = Object.assign({
    _embed: "wp:featuredmedia",
    per_page: 20,
    page: 1,
    orderby: "modified",
    order: "desc"
  }, options || {});
  const response = await apiGet(`/wp-json/wp/v2/manga?${queryString(params)}`);
  return (Array.isArray(response) ? response : []).map(mapManga).filter(Boolean);
}

function mapManga(item) {
  if (!item || !item.slug) {
    return null;
  }
  const embedded = item._embedded || {};
  const media = embedded["wp:featuredmedia"] && embedded["wp:featuredmedia"][0];
  const coverURL = media && (media.source_url || media.media_details && media.media_details.sizes && media.media_details.sizes.full && media.media_details.sizes.full.source_url);
  return titleDTO({
    id: item.slug,
    mangaId: item.id,
    title: htmlText(item.title && item.title.rendered),
    coverURL,
    synopsis: htmlText(item.excerpt && item.excerpt.rendered),
    status: "",
    type: "Manga",
    latestChapter: dateLabel(item.modified_gmt || item.modified),
    chapterCount: chapterCountFromLatest(dateLabel(item.modified_gmt || item.modified)),
    tags: []
  });
}

function mapChapter(chapter) {
  if (!chapter || !chapter.id) {
    return null;
  }
  const number = numberValue(chapter.chapter);
  return {
    id: String(chapter.id),
    url: chapter.url || null,
    title: chapter.title && chapter.title !== "N/A"
      ? `Chapter ${formatNumber(number)} - ${chapter.title}`
      : `Chapter ${formatNumber(number)}`,
    number,
    publishedAt: parseDateText(chapter.date),
    isLocked: false,
    pageCount: 0
  };
}

async function htmlGet(pathOrURL) {
  return httpGetText(absoluteURL(pathOrURL), {
    Accept: "text/html,application/xhtml+xml,application/xml",
    Referer: `${SITE_BASE_URL}/home/`
  });
}

async function apiGet(pathOrURL) {
  const text = await httpGetText(absoluteURL(pathOrURL), {
    Accept: "application/json,text/plain,*/*",
    Referer: `${SITE_BASE_URL}/home/`,
    "User-Agent": "Iris/0.1 (Rolia source)"
  });
  return JSON.parse(text);
}

async function httpGetText(url, headers) {
  if (typeof host === "undefined" || !host || typeof host.httpGet !== "function") {
    throw new Error("Iris host.httpGet is unavailable.");
  }
  const response = await host.httpGet(url, headers || {});
  if (typeof response === "string") {
    return response;
  }
  if (response && typeof response.body === "string") {
    return response.body;
  }
  if (response && typeof response.text === "string") {
    return response.text;
  }
  return String(response || "");
}

function titleDTO(input) {
  const coverURL = cleanCoverURL(input.coverURL
    || input.coverUrl
    || input.cover_url
    || input.cover
    || input.thumbnail
    || input.thumbnailURL
    || input.thumbnailUrl
    || input.image
    || input.imageURL
    || input.imageUrl
    || input.poster);
  const chapterCount = numericChapterCount(input.chapterCount || input.chapters);

  return {
    id: String(input.id || input.slug || ""),
    mangaId: input.mangaId || input.mangaID || null,
    mangaID: input.mangaId || input.mangaID || null,
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: htmlText(input.title || "Untitled") || "Untitled",
    subtitle: [input.type, input.status].filter(Boolean).join(" - "),
    sourceName: SOURCE_NAME,
    latestChapter: input.latestChapter || "",
    progress: 0,
    coverSymbol: "book.closed",
    coverURL,
    coverUrl: coverURL,
    cover: coverURL,
    thumbnail: coverURL,
    thumbnailURL: coverURL,
    thumbnailUrl: coverURL,
    image: coverURL,
    imageURL: coverURL,
    imageUrl: coverURL,
    poster: coverURL,
    synopsis: input.synopsis || input.description || "",
    status: input.status || "",
    type: input.type || "",
    author: input.author || null,
    artist: input.artist || null,
    rating: numberOrNull(input.rating),
    chapterCount,
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : []
  };
}

function chapterListToken() {
  const timestamp = Math.floor(Date.now() / 1000);
  const hour = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, "");
  const token = md5(String(timestamp) + "mng_ch_" + hour).slice(0, 16);
  return { timestamp, token };
}

function titleFromObject(title) {
  return typeof title === "object" && title ? title : {};
}

function titleSlug(title) {
  if (typeof title === "string" || typeof title === "number") {
    return String(title);
  }
  return String(title.id || title.slug || "");
}

function chapterNumericID(chapter) {
  if (typeof chapter === "string" || typeof chapter === "number") {
    return String(chapter).match(/\d+$/) ? String(chapter).match(/\d+$/)[0] : String(chapter);
  }
  const raw = String(chapter && (chapter.id || chapter.url || chapter.remoteURL || chapter.remoteUrl) || "");
  const match = raw.match(/(\d+)(?:\/)?$/);
  return match ? match[1] : raw;
}

function fieldAfterLabel(html, label) {
  return htmlText(firstMatch(html, new RegExp(`${label}[\\s\\S]{0,220}?(?:<a[^>]*>|<span[^>]*>|<div[^>]*>)([\\s\\S]*?)(?:<\\/a>|<\\/span>|<\\/div>)`, "i")));
}

function parseTags(html) {
  const tags = [];
  const seen = {};
  const pattern = /<a[^>]+href=["'][^"']*(?:genre|tag|manga-genre)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = htmlText(match[1]);
    if (tag && !seen[tag]) {
      seen[tag] = true;
      tags.push(tag);
    }
  }
  return tags;
}

function firstImage(html) {
  const tag = firstMatch(html, /<img\b[^>]*>/i);
  return normalizeImageURL(attr(tag, "data-src") || attr(tag, "src"));
}

function normalizeImageURL(value) {
  return absoluteURL(decodeHTML(String(value || "").trim().replace(/\\\//g, "/")));
}

function absoluteURL(value) {
  const url = decodeHTML(String(value || "").trim());
  if (!url) {
    return "";
  }
  if (url.startsWith("http")) {
    return url;
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  if (url.startsWith("/")) {
    return `${SITE_BASE_URL}${url}`;
  }
  return `${SITE_BASE_URL}/${url}`;
}

function cleanCoverURL(value) {
  const url = absoluteURL(String(value || "").trim().replace(/&amp;/g, "&").replace(/\\\//g, "/"));
  if (!isUsefulCoverURL(url)) {
    return null;
  }
  return url;
}

function isUsefulCoverURL(url) {
  const lower = String(url || "").toLowerCase();
  return /^https?:\/\//i.test(url)
    && /\.(?:avif|webp|jpe?g|png|gif)(?:[?#&].*)?$/i.test(lower)
    && !lower.includes("favicon")
    && !lower.includes("logo")
    && !lower.includes("placeholder")
    && !lower.includes("no-image")
    && !lower.includes("no_image")
    && !lower.includes("avatar")
    && !lower.includes("banner")
    && !lower.includes("header");
}

function queryString(values) {
  return Object.keys(values)
    .filter((key) => values[key] !== undefined && values[key] !== null && values[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(values[key]))}`)
    .join("&");
}

function meta(html, property) {
  return firstMatch(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"));
}

function attr(html, name) {
  return firstMatch(html || "", new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
}

function firstMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  if (!match) {
    return "";
  }
  return typeof match[1] === "undefined" ? match[0] : match[1];
}

function firstClean(candidates) {
  for (const candidate of candidates) {
    const text = htmlText(candidate);
    if (text) {
      return text;
    }
  }
  return "";
}

function htmlText(html) {
  return decodeHTML(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function decodeHTML(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#8217;/g, "'");
}

function parseDateText(value) {
  const text = htmlText(value);
  if (!text || /^N\/A$/i.test(text)) {
    return null;
  }
  const relative = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const multipliers = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000
    };
    return new Date(Date.now() - amount * multipliers[unit]).toISOString();
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function dateLabel(value) {
  const date = parseDateText(value);
  return date ? "Updated recently" : "";
}

function normalizeQuery(value) {
  return String(value || "").trim();
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericChapterCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function chapterCountFromLatest(latestChapter) {
  const match = String(latestChapter || "").match(/([0-9]+(?:\.[0-9]+)?)/);
  return numericChapterCount(match ? match[1] : 0);
}

function numberOrNull(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value) {
  const number = numberValue(value);
  return Number.isInteger(number) ? String(number) : String(number);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostLog(message) {
  if (typeof host !== "undefined" && host && typeof host.log === "function") {
    host.log(String(message));
  }
}

function md5(input) {
  function cmn(q, a, b, x, s, t) {
    a = (a + q + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  }
  function ff(a, b, c, d, x, s, t) {
    return cmn((b & c) | ((~b) & d), a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cmn((b & d) | (c & (~d)), a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cmn(c ^ (b | (~d)), a, b, x, s, t);
  }
  function cycle(state, k) {
    let a = state[0], b = state[1], c = state[2], d = state[3];
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586); c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426); c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417); c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101); c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632); c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083); c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690); c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784); c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463); c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353); c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222); c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835); c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415); c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606); c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744); c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379); c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0; state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
  }
  function block(text) {
    const output = [];
    for (let i = 0; i < 64; i += 4) {
      output[i >> 2] = text.charCodeAt(i)
        + (text.charCodeAt(i + 1) << 8)
        + (text.charCodeAt(i + 2) << 16)
        + (text.charCodeAt(i + 3) << 24);
    }
    return output;
  }
  function md51(text) {
    let inputText = String(text);
    const length = inputText.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= length; i += 64) {
      cycle(state, block(inputText.substring(i - 64, i)));
    }
    inputText = inputText.substring(i - 64);
    let tail = new Array(16).fill(0);
    for (i = 0; i < inputText.length; i += 1) {
      tail[i >> 2] |= inputText.charCodeAt(i) << ((i % 4) << 3);
    }
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      cycle(state, tail);
      tail = new Array(16).fill(0);
    }
    tail[14] = length * 8;
    cycle(state, tail);
    return state;
  }
  function rhex(n) {
    let s = "";
    for (let j = 0; j < 4; j += 1) {
      s += ((n >> (j * 8 + 4)) & 15).toString(16) + ((n >> (j * 8)) & 15).toString(16);
    }
    return s;
  }
  return md51(String(input)).map(rhex).join("");
}

const root = typeof globalThis !== "undefined" ? globalThis : this;

root.getManifest = getManifest;
root.latestTitles = latestTitles;
root.discoverSections = discoverSections;
root.discoverItems = discoverItems;
root.search = search;
root.details = details;
root.chapters = chapters;
root.chapterDetails = chapterDetails;

if (typeof module !== "undefined") {
  module.exports = {
    getManifest,
    latestTitles,
    discoverSections,
    discoverItems,
    search,
    details,
    chapters,
    chapterDetails
  };
}
