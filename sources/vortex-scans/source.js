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
    version: "0.1.1",
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
  const base = titleFromObject(title);
  return titleDTO({
    id: slug,
    title: firstClean([
      meta(html, "og:title"),
      firstMatch(decoded, /"postTitle":"([^"]+)"/i),
      base.title,
      slug.replace(/-/g, " ")
    ]),
    coverURL: firstClean([
      meta(html, "og:image"),
      firstMatch(decoded, /"featuredImage":"([^"]+)"/i),
      firstImage(html),
      base.coverURL || base.coverUrl
    ]),
    synopsis: stripHTML(firstClean([meta(html, "description"), meta(html, "og:description")])),
    status: firstClean([firstMatch(decoded, /"seriesStatus":"([^"]+)"/i), base.status]),
    type: firstClean([firstMatch(decoded, /"seriesType":"([^"]+)"/i), base.type]),
    latestChapter: base.latestChapter || "",
    tags: parseGenres(decoded),
    postId: postIDFromHTML(decoded)
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
  const items = [];
  const seen = {};
  const postPattern = /"id":(\d+),"slug":"([^"]+)","postTitle":"([^"]+)","featuredImage":"([^"]*)","seriesType":"([^"]*)","seriesStatus":"([^"]*)"/gi;
  let match;

  while ((match = postPattern.exec(decoded)) !== null && items.length < (limit || 20)) {
    const slug = match[2];
    if (!slug || seen[slug]) {
      continue;
    }
    seen[slug] = true;
    items.push(titleDTO({
      id: slug,
      postId: match[1],
      title: match[3],
      coverURL: match[4],
      type: match[5],
      status: match[6],
      latestChapter: latestChapterNear(decoded, postPattern.lastIndex),
      tags: []
    }));
  }

  if (items.length) {
    return items.slice(0, limit || 20);
  }

  return parseAnchoredTitles(html, limit || 20);
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
    items.push(titleDTO({
      id: slug,
      title: firstClean([
        attr(match[0], "title"),
        attr(firstMatch(block, /<img\b[^>]*>/i), "alt"),
        htmlText(match[3]),
        slug.replace(/-/g, " ")
      ]),
      coverURL: firstImage(block),
      latestChapter: latestChapterNear(decodeHTML(block), 0),
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
    coverURL: input.coverURL || null,
    coverUrl: input.coverURL || null,
    synopsis: input.synopsis || "",
    status: input.status || "",
    type: input.type || "",
    author: null,
    artist: null,
    rating: null,
    chapterCount: 0,
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
  const image = firstMatch(html, /<img\b[^>]*>/i);
  return normalizeImageURL(attr(image, "data-src") || attr(image, "src"));
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
