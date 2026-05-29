const SOURCE_ID = "vortex-scans";
const SOURCE_NAME = "Vortex Scans";
const SOURCE_AUTHOR = "majorxsense-prog";
const SITE_BASE_URL = "https://vortexscans.org";
const API_BASE_URL = "https://api.vortexscans.org";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    version: "0.1.3",
    language: "en",
    contentRating: "Teen",
    website: SITE_BASE_URL,
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
    { id: "popular", title: "Popular", kind: "simpleCarousel" },
    { id: "catalog", title: "All Series", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const pageNumber = (Number(page) || 0) + 1;
  switch (sectionID) {
  case "latest_updates":
  case "latest":
    return parseTitleList(await htmlGet(`/latest-updates${pageNumber > 1 ? `?page=${pageNumber}` : ""}`), size);
  case "popular":
    return parseTitleList(await htmlGet(`/series?sort=views&page=${pageNumber}`), size);
  case "catalog":
  case "series":
    return parseTitleList(await htmlGet(`/series?page=${pageNumber}`), size);
  case "genres":
    return [];
  default:
    return latestTitles(size);
  }
}

async function search(request) {
  const query = normalizeQuery(request && (request.title || request.query || request.text || request));
  const page = Number(request && request.page) || 0;
  if (!query) {
    return discoverItems("catalog", 20, page);
  }
  return parseTitleList(await htmlGet(`/series/?searchTerm=${encodeURIComponent(query)}&page=${page + 1}`), 30);
}

async function details(title) {
  const slug = titleSlug(title);
  const html = await htmlGet(`/series/${encodeURIComponent(slug)}`);
  const decoded = decodeHTML(html);
  const detailChunk = serializedTitleChunk(decoded, slug);
  const postId = postIDFromHTML(decoded);
  const detailLatestChapter = latestChapterFromChunk(detailChunk);
  const apiMeta = !detailLatestChapter && postId ? await chapterMetadata(postId) : null;
  const base = titleFromObject(title);
  return titleDTO({
    id: slug,
    title: firstClean([
      meta(html, "og:title"),
      serializedStringField(decoded, "postTitle"),
      firstMatch(decoded, /"postTitle":"([^"]+)"/i),
      base.title,
      slug.replace(/-/g, " ")
    ]),
    coverURL: firstClean([
      serializedStringField(detailChunk, "featuredImage"),
      serializedStringField(decoded, "featuredImage"),
      bestCoverURL(html, base.title || slug),
      base.coverURL || base.coverUrl || base.cover || base.thumbnail || base.poster,
      meta(html, "og:image")
    ]),
    synopsis: stripHTML(firstClean([meta(html, "description"), meta(html, "og:description")])),
    status: firstClean([serializedStringField(detailChunk, "seriesStatus"), serializedStringField(decoded, "seriesStatus"), base.status]),
    type: firstClean([serializedStringField(detailChunk, "seriesType"), serializedStringField(decoded, "seriesType"), base.type]),
    latestChapter: base.latestChapter || detailLatestChapter || apiMeta && apiMeta.latestChapter || "",
    chapterCount: chapterCountFromChunk(detailChunk, detailLatestChapter) || apiMeta && apiMeta.chapterCount || chapterCountFromHTML(decoded) || base.chapterCount || chapterCountFromLatest(base.latestChapter),
    tags: parseGenres(detailChunk || decoded),
    postId
  });
}

async function chapters(title) {
  const info = await details(title);
  const postId = info.postId || info.postID;
  if (!postId) {
    throw new Error("Vortex did not expose a series id for this title.");
  }

  const response = await apiGet(`/api/chapters?postId=${encodeURIComponent(postId)}`);
  const list = response.post && Array.isArray(response.post.chapters)
    ? response.post.chapters
    : Array.isArray(response.chapters)
      ? response.chapters
      : [];
  return list.map((chapter) => mapChapter(chapter, titleSlug(title))).filter(Boolean);
}

async function chapterDetails(title, chapter) {
  if (chapter && chapter.isLocked) {
    throw new Error("This Vortex chapter is locked or still in early access.");
  }

  const slug = titleSlug(title);
  const chapterSlug = chapterSlugValue(chapter);
  const payload = await apiGet(`/api/chapter?mangaslug=${encodeURIComponent(slug)}&chapterslug=${encodeURIComponent(chapterSlug)}`);
  const payloadChapter = payload.chapter || payload.data || {};
  if (payloadChapter.isLocked || payloadChapter.isAccessible === false) {
    throw new Error("This Vortex chapter is locked or still in early access.");
  }

  const imageValues = Array.isArray(payloadChapter.images)
    ? payloadChapter.images
    : Array.isArray(payload.images)
      ? payload.images
      : [];
  const pages = imageValues
    .map((image, index) => {
      const url = typeof image === "string" ? image : image && (image.url || image.src || image.remoteURL || image.remoteUrl);
      if (!url) {
        return null;
      }
      return {
        id: `${chapterID(chapter)}-${index}`,
        remoteURL: absoluteURL(url),
        remoteUrl: absoluteURL(url)
      };
    })
    .filter(Boolean);

  if (!pages.length) {
    throw new Error("Vortex did not return any readable pages for this chapter.");
  }

  return {
    title,
    chapter: mapChapter(payloadChapter, slug) || chapter,
    pages,
    nextChapter: mapChapter(payload.nextChapter, slug),
    previousChapter: mapChapter(payload.previousChapter, slug),
    prevChapter: mapChapter(payload.previousChapter, slug)
  };
}

function parseTitleList(html, limit) {
  const decoded = decodeHTML(html);
  const items = parseSerializedTitles(decoded, limit || 20);
  if (items.length) {
    return items.slice(0, limit || 20);
  }

  return parseAnchoredTitles(html, limit || 20);
}

function parseSerializedTitles(decoded, limit) {
  const items = [];
  const seen = {};
  const starts = serializedTitleStarts(decoded);

  for (let index = 0; index < starts.length && items.length < (limit || 20); index += 1) {
    const current = starts[index];
    const next = starts[index + 1];
    const chunk = decoded.slice(current.index, next ? next.index : current.index + 7000);
    const slug = current.slug;
    if (!slug || seen[slug]) {
      continue;
    }
    seen[slug] = true;
    const latestChapter = latestChapterFromChunk(chunk) || latestChapterNear(chunk, 0);
    items.push(titleDTO({
      id: slug,
      postId: current.postId,
      title: current.title,
      coverURL: serializedStringField(chunk, "featuredImage"),
      type: serializedStringField(chunk, "seriesType"),
      status: serializedStringField(chunk, "seriesStatus"),
      latestChapter,
      chapterCount: chapterCountFromChunk(chunk, latestChapter),
      tags: []
    }));
  }

  return items;
}

function serializedTitleChunk(decoded, expectedSlug) {
  const starts = serializedTitleStarts(decoded);
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index];
    if (current.slug !== expectedSlug) {
      continue;
    }
    const next = starts[index + 1];
    return String(decoded || "").slice(current.index, next ? next.index : current.index + 7000);
  }
  return "";
}

function serializedTitleStarts(decoded) {
  const starts = [];
  const seriesPattern = /\{"id":(\d+),"slug":"([^"]+)","postTitle":"([^"]+)"/gi;
  let match;

  while ((match = seriesPattern.exec(String(decoded || ""))) !== null) {
    starts.push({
      index: match.index,
      postId: match[1],
      slug: decodeSerialized(match[2]),
      title: decodeSerialized(match[3])
    });
  }

  return starts;
}

function parseAnchoredTitles(html, limit) {
  const items = [];
  const seen = {};
  const anchorPattern = /<a\b[^>]+href=["']([^"']*\/series\/([^"'\/?#]+)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null && items.length < limit) {
    const slug = match[2];
    if (!slug || seen[slug]) {
      continue;
    }
    seen[slug] = true;
    const block = cardBlock(html, match.index);
    const latestChapter = latestChapterNear(decodeHTML(block), 0);
    items.push(titleDTO({
      id: slug,
      title: firstClean([
        attr(match[0], "title"),
        attr(firstMatch(block, /<img\b[^>]*>/i), "alt"),
        htmlText(match[3]),
        slug.replace(/-/g, " ")
      ]),
      coverURL: bestCoverURL(match[0], slug) || bestCoverURL(block, slug),
      latestChapter,
      chapterCount: chapterCountNear(decodeHTML(block), 0, latestChapter),
      tags: []
    }));
  }

  return items;
}

function mapChapter(chapter, slug) {
  if (!chapter) {
    return null;
  }
  const number = numberValue(chapter.number || chapter.chapter);
  const chapterSlug = chapter.slug || `chapter-${formatNumber(number)}`;
  const isLocked = Boolean(chapter.isLocked || chapter.is_locked || chapter.isAccessible === false || chapter.price > 0 && chapter.unlockAt);
  return {
    id: chapterSlug,
    slug: chapterSlug,
    url: `${SITE_BASE_URL}/series/${slug}/${chapterSlug}`,
    title: chapter.title ? `Chapter ${formatNumber(number)} - ${chapter.title}` : `Chapter ${formatNumber(number)}`,
    number,
    publishedAt: dateString(chapter.createdAt || chapter.created_at || chapter.updatedAt || chapter.updated_at),
    isLocked,
    pageCount: Array.isArray(chapter.images) ? chapter.images.length : 0
  };
}

async function htmlGet(pathOrURL) {
  return httpGetText(absoluteURL(pathOrURL), {
    Accept: "text/html,application/xhtml+xml,application/xml",
    Referer: `${SITE_BASE_URL}/`
  });
}

async function apiGet(path) {
  const text = await httpGetText(`${API_BASE_URL}${path}`, {
    Accept: "application/json",
    Referer: `${SITE_BASE_URL}/`,
    "User-Agent": "Iris/0.1 (Vortex source)"
  });
  return JSON.parse(text);
}

async function chapterMetadata(postId) {
  try {
    const response = await apiGet(`/api/chapters?postId=${encodeURIComponent(postId)}`);
    const list = response.post && Array.isArray(response.post.chapters)
      ? response.post.chapters
      : Array.isArray(response.chapters)
        ? response.chapters
        : [];
    const highest = list.reduce((value, chapter) => Math.max(value, numberValue(chapter && (chapter.number || chapter.chapter))), 0);
    return {
      latestChapter: highest ? `Chapter ${formatNumber(highest)}` : "",
      chapterCount: list.length || numericChapterCount(highest)
    };
  } catch (error) {
    hostLog(`Unable to fetch Vortex chapter metadata: ${error.message || error}`);
    return null;
  }
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
    || input.cover
    || input.thumbnail
    || input.thumbnailURL
    || input.thumbnailUrl
    || input.image
    || input.imageURL
    || input.imageUrl
    || input.poster);
  const chapterCount = numericChapterCount(input.chapterCount);
  return {
    id: input.id,
    postId: input.postId || input.postID || null,
    postID: input.postId || input.postID || null,
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: cleanTitle(input.title || "Untitled"),
    subtitle: [capitalize(input.type), capitalize(input.status)].filter(Boolean).join(" - "),
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
    synopsis: input.synopsis || "",
    status: input.status || "",
    type: input.type || "",
    author: null,
    artist: null,
    rating: null,
    chapterCount,
    tags: input.tags || []
  };
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

function chapterID(chapter) {
  if (typeof chapter === "string" || typeof chapter === "number") {
    return String(chapter);
  }
  return String(chapter.id || chapter.slug || "");
}

function chapterSlugValue(chapter) {
  const id = chapterID(chapter);
  if (/^chapter-/i.test(id)) {
    return id;
  }
  if (typeof chapter === "object" && chapter && chapter.number) {
    return `chapter-${formatNumber(chapter.number)}`;
  }
  return id;
}

function postIDFromHTML(decodedHTML) {
  return firstMatch(decodedHTML, /"postId":\[0,(\d+)\]/i)
    || firstMatch(decodedHTML, /"mangaPostId":\[0,(\d+)\]/i)
    || firstMatch(decodedHTML, /"id":(\d+),"slug":/i);
}

function latestChapterNear(text, index) {
  const window = String(text || "").slice(index, index + 1800);
  const number = firstMatch(window, /"number":([0-9]+(?:\.[0-9]+)?)/i)
    || firstMatch(window, /Chapter\s*([0-9]+(?:\.[0-9]+)?)/i);
  return number ? `Chapter ${formatNumber(number)}` : "";
}

function latestChapterFromChunk(chunk) {
  const number = highestNumber(chunk, /"number":([0-9]+(?:\.[0-9]+)?)/gi)
    || highestNumber(chunk, /Chapter\s*([0-9]+(?:\.[0-9]+)?)/gi);
  return number ? `Chapter ${formatNumber(number)}` : "";
}

function chapterCountFromChunk(chunk, latestChapter) {
  return numericChapterCount(firstMatch(chunk, /"_count":\{"chapters":([0-9]+(?:\.[0-9]+)?)/i)
    || serializedNumberField(chunk, "totalChapterCount")
    || serializedNumberField(chunk, "chapterCount")
    || chapterCountFromLatest(latestChapter));
}

function chapterCountNear(text, index, latestChapter) {
  const window = String(text || "").slice(index, index + 2200);
  return numericChapterCount(serializedNumberField(window, "totalChapterCount")
    || serializedNumberField(window, "chapterCount")
    || chapterCountFromLatest(latestChapter));
}

function chapterCountFromHTML(decodedHTML) {
  return numericChapterCount(serializedNumberField(decodedHTML, "totalChapterCount")
    || serializedNumberField(decodedHTML, "chapterCount"));
}

function chapterCountFromLatest(latestChapter) {
  return numericChapterCount(firstMatch(latestChapter, /([0-9]+(?:\.[0-9]+)?)/i));
}

function highestNumber(text, pattern) {
  let highest = 0;
  let match;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(String(text || ""))) !== null) {
    const value = numberValue(match[1]);
    if (value > highest) {
      highest = value;
    }
  }
  return highest;
}

function serializedStringField(decodedHTML, field) {
  const text = String(decodedHTML || "");
  const name = escapeRegExp(field);
  const patterns = [
    new RegExp(`\\\\?"${name}\\\\?"\\s*:\\s*\\[0,\\\\?"([^"\\\\]*)\\\\?"\\]`, "i"),
    new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`, "i")
  ];

  for (const pattern of patterns) {
    const value = firstMatch(text, pattern);
    if (value) {
      return decodeSerialized(value);
    }
  }
  return "";
}

function serializedNumberField(decodedHTML, field) {
  const text = String(decodedHTML || "");
  const name = escapeRegExp(field);
  const patterns = [
    new RegExp(`\\\\?"${name}\\\\?"\\s*:\\s*\\[0,([0-9]+(?:\\.[0-9]+)?)\\]`, "i"),
    new RegExp(`"${name}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i")
  ];

  for (const pattern of patterns) {
    const value = firstMatch(text, pattern);
    if (value) {
      return value;
    }
  }
  return "";
}

function parseGenres(decodedHTML) {
  const tags = [];
  const seen = {};
  const pattern = /"name":"([^"]+)","color"/gi;
  let match;
  while ((match = pattern.exec(decodedHTML)) !== null && tags.length < 20) {
    const tag = htmlText(match[1]);
    if (tag && !seen[tag]) {
      seen[tag] = true;
      tags.push(tag);
    }
  }
  return tags;
}

function cardBlock(html, index) {
  return String(html || "").slice(Math.max(0, index - 1000), Math.min(String(html || "").length, index + 2200));
}

function firstImage(html) {
  return bestCoverURL(html, "");
}

function bestCoverURL(html, expectedTitle) {
  const tags = [];
  const pattern = /<img\b[^>]*>/gi;
  let match;

  while ((match = pattern.exec(String(html || ""))) !== null) {
    tags.push(match[0]);
  }

  const expected = normalizeToken(expectedTitle);
  const scored = tags
    .map((tag, index) => {
      const url = imageURLFromTag(tag);
      if (!isUsefulCoverURL(url)) {
        return null;
      }
      const text = normalizeToken([attr(tag, "alt"), attr(tag, "title"), attr(tag, "class")].join(" "));
      let score = 10 - index;
      if (/itemprop=["']image["']/i.test(tag) || text.includes("cover")) {
        score += 80;
      }
      if (expected && text && (text.includes(expected) || expected.includes(text))) {
        score += 60;
      }
      if (/storage\.vortexscans\.org|wsrv\.nl/i.test(url)) {
        score += 20;
      }
      return { url, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0].url : "";
}

function imageURLFromTag(tag) {
  return normalizeImageURL(attr(tag, "data-src")
    || attr(tag, "data-lazy-src")
    || firstSrcsetURL(attr(tag, "data-srcset"))
    || firstSrcsetURL(attr(tag, "srcset"))
    || attr(tag, "src"));
}

function firstSrcsetURL(value) {
  const first = String(value || "").split(",")[0] || "";
  return first.trim().split(/\s+/)[0] || "";
}

function isUsefulCoverURL(url) {
  const lower = String(url || "").toLowerCase();
  return /\.(?:avif|webp|jpe?g|png|gif)(?:[?#&].*)?$/i.test(lower)
    && !lower.startsWith("data:")
    && !lower.includes("/api/og-image/")
    && !lower.includes("logo")
    && !lower.includes("avatar")
    && !lower.includes("placeholder")
    && !lower.includes("blank")
    && !lower.includes("favicon")
    && !lower.includes("spinner")
    && !lower.includes("1x1");
}

function cleanCoverURL(value) {
  const url = normalizeImageURL(value);
  return isUsefulCoverURL(url) ? url : null;
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

function stripHTML(html) {
  return htmlText(html);
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
    .replace(/&nbsp;/g, " ");
}

function dateString(value) {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
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

function formatNumber(value) {
  const number = numberValue(value);
  return Number.isInteger(number) ? String(number) : String(number);
}

function capitalize(value) {
  const text = String(value || "").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function cleanTitle(value) {
  return htmlText(String(value || "")
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " "));
}

function decodeSerialized(value) {
  return decodeHTML(String(value || "")
    .replace(/\\"/g, "\"")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&"));
}

function normalizeToken(value) {
  return htmlText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
