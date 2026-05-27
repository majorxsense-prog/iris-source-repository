const SOURCE_ID = "thunder-scans";
const SOURCE_NAME = "Thunder Scans EN";
const SOURCE_AUTHOR = "majorxsense-prog";
const SITE_BASE_URL = "https://en-thunderscans.com";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    version: "0.1.0",
    language: "en",
    contentRating: "Teen",
    website: `${SITE_BASE_URL}/`,
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
    { id: "catalog", title: "All Comics", kind: "simpleCarousel" },
    { id: "popular", title: "Popular", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const pageNumber = (Number(page) || 0) + 1;
  switch (sectionID) {
  case "popular":
    return parseTitleList(await htmlGet(`/comics/page/${pageNumber}/?order=popular`), size);
  case "catalog":
  case "series":
    return parseTitleList(await htmlGet(pageNumber > 1 ? `/comics/page/${pageNumber}/` : "/comics/"), size);
  case "latest_updates":
  case "latest":
  default:
    return parseTitleList(await htmlGet(pageNumber > 1 ? `/page/${pageNumber}/` : "/"), size);
  }
}

async function search(request) {
  const query = normalizeQuery(request && (request.title || request.query || request.text || request));
  const page = Number(request && request.page) || 0;
  if (!query) {
    return latestTitles(20);
  }
  const path = page > 0 ? `/page/${page + 1}/?s=${encodeURIComponent(query)}` : `/?s=${encodeURIComponent(query)}`;
  return parseTitleList(await htmlGet(path), 30);
}

async function details(title) {
  const slug = titleSlug(title);
  const html = await htmlGet(`/comics/${encodeURIComponent(slug)}/`);
  const base = titleFromObject(title);
  return titleDTO({
    id: slug,
    title: firstClean([
      meta(html, "og:title").replace(/\s+[–-]\s+Thunderscans EN.*$/i, ""),
      firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
      base.title,
      slug.replace(/-/g, " ")
    ]),
    coverURL: firstClean([meta(html, "og:image"), firstImage(html), base.coverURL || base.coverUrl]),
    synopsis: firstClean([
      meta(html, "og:description"),
      firstMatch(html, /<div[^>]+class=["'][^"']*(?:entry-content|summary|desc|synopsis)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    ]),
    status: firstClean([fieldAfterLabel(html, "Status"), base.status]),
    type: "Manga",
    latestChapter: latestChapterFromDetail(html) || base.latestChapter || "",
    tags: parseTags(html)
  });
}

async function chapters(title) {
  const slug = titleSlug(title);
  const html = await htmlGet(`/comics/${encodeURIComponent(slug)}/`);
  const items = [];
  const seen = {};
  const patterns = [
    /<li\b[^>]*data-num=["']([^"']*)["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi,
    /<a\b[^>]*href=["']([^"']*chapter[^"']*)["'][^>]*>([\s\S]*?Chapter[\s\S]*?)<\/a>/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const dataNumMode = match.length >= 4;
      const numberText = dataNumMode ? match[1] : match[2];
      const href = dataNumMode ? match[2] : match[1];
      const body = dataNumMode ? match[0] : match[0];
      const url = absoluteURL(href);
      if (!url || seen[url] || !/chapter/i.test(url)) {
        continue;
      }
      seen[url] = true;
      const number = chapterNumber(numberText || url);
      items.push({
        id: url,
        url,
        title: chapterTitle(body, number),
        number,
        publishedAt: parseDateText(firstMatch(body, /<span[^>]+class=["'][^"']*(?:chapterdate|date|time)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)),
        isLocked: false,
        pageCount: 0
      });
    }
    if (items.length) {
      break;
    }
  }

  return items.sort((a, b) => numberValue(b.number) - numberValue(a.number));
}

async function chapterDetails(title, chapter) {
  const url = chapterURL(chapter);
  const html = await htmlGet(url);
  const imageURLs = parseReaderImages(html);
  const pages = imageURLs.map((remoteURL, index) => ({
    id: `${chapterID(chapter)}-${index}`,
    remoteURL,
    remoteUrl: remoteURL
  }));

  if (!pages.length) {
    throw new Error("Thunder Scans did not return any readable pages for this chapter.");
  }

  let allChapters = [];
  try {
    allChapters = await chapters(title);
  } catch (error) {
    hostLog(`Unable to fetch Thunder chapter list for next/previous metadata: ${error.message || error}`);
  }

  const currentURL = url.replace(/\/+$/, "");
  const currentIndex = allChapters.findIndex((item) => chapterURL(item).replace(/\/+$/, "") === currentURL);
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

function parseTitleList(html, limit) {
  const items = [];
  const seen = {};
  const anchorPattern = /<a\b[^>]+href=["']([^"']*\/comics\/([^"'\/?#]+)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null && items.length < (limit || 20)) {
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
        htmlText(match[3]),
        titleCaseSlug(slug),
        attr(firstMatch(block, /<img\b[^>]*>/i), "alt"),
        firstMatch(block, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i),
        firstMatch(block, /<div[^>]+class=["'][^"']*(?:tt|ttls|title|post-title)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
      ]),
      coverURL: firstImage(block),
      latestChapter: latestChapterFromBlock(block),
      status: firstClean([firstMatch(block, /<span[^>]+class=["'][^"']*status[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)]),
      type: "Manga",
      tags: []
    }));
  }

  return items;
}

function parseReaderImages(html) {
  const payload = firstMatch(html, /ts_reader\.run\((\{[\s\S]*?\})\);/i);
  if (payload) {
    try {
      const data = JSON.parse(payload);
      const sources = Array.isArray(data.sources) ? data.sources : [];
      for (const source of sources) {
        if (source && Array.isArray(source.images) && source.images.length) {
          return source.images.map(absoluteURL).filter(Boolean);
        }
      }
    } catch (error) {
      hostLog(`Unable to parse Thunder reader payload: ${error.message || error}`);
    }
  }

  const images = [];
  const seen = {};
  const tagPattern = /<img\b[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const url = normalizeImageURL(attr(match[0], "data-src") || attr(match[0], "src"));
    if (isReaderImage(url) && !seen[url]) {
      seen[url] = true;
      images.push(url);
    }
  }
  return images;
}

async function htmlGet(pathOrURL) {
  return httpGetText(absoluteURL(pathOrURL), {
    Accept: "text/html,application/xhtml+xml,application/xml",
    Referer: `${SITE_BASE_URL}/`
  });
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
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: cleanTitle(input.title || "Untitled"),
    subtitle: [input.type, input.status].filter(Boolean).join(" - "),
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
  return String(chapter.id || chapter.url || chapter.remoteURL || chapter.remoteUrl || "");
}

function chapterURL(chapter) {
  if (typeof chapter === "object" && chapter && (chapter.url || chapter.remoteURL || chapter.remoteUrl || chapter.id)) {
    return absoluteURL(chapter.url || chapter.remoteURL || chapter.remoteUrl || chapter.id);
  }
  return absoluteURL(String(chapter || ""));
}

function latestChapterFromDetail(html) {
  const block = firstMatch(html, /<div[^>]+class=["'][^"']*(?:lastend|eplister|bixbox)[^"']*["'][^>]*>[\s\S]*?<\/div>/i);
  return latestChapterFromBlock(block || html);
}

function latestChapterFromBlock(block) {
  const match = String(block || "").match(/Chapter\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? `Chapter ${formatNumber(match[1])}` : "";
}

function chapterTitle(block, number) {
  const text = firstClean([
    firstMatch(block, /<span[^>]+class=["'][^"']*(?:chapternum|chapter-title)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i),
    firstMatch(block, /<a\b[^>]*>([\s\S]*?)<\/a>/i)
  ]);
  return text || `Chapter ${formatNumber(number)}`;
}

function chapterNumber(value) {
  const match = String(value || "").match(/(?:chapter|ch)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? numberValue(match[1]) : numberValue(value);
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

function cardBlock(html, index) {
  const source = String(html || "");
  const startWindow = Math.max(0, index - 1800);
  const window = source.slice(startWindow, Math.min(source.length, index + 2600));
  const relative = index - startWindow;
  const markers = [
    /<div[^>]+class=["'][^"']*\bbsx\b[^"']*["'][^>]*>/gi,
    /<article\b[^>]*>/gi,
    /<div[^>]+class=["'][^"']*\bbs\b[^"']*["'][^>]*>/gi
  ];
  let itemStart = -1;
  for (const marker of markers) {
    let match;
    while ((match = marker.exec(window)) !== null) {
      if (match.index <= relative) {
        itemStart = Math.max(itemStart, match.index);
      }
    }
    if (itemStart >= 0) {
      break;
    }
  }
  if (itemStart < 0) {
    return window;
  }
  const rest = window.slice(itemStart + 1);
  const next = rest.search(/<div[^>]+class=["'][^"']*\bbsx\b[^"']*["'][^>]*>|<article\b[^>]*>/i);
  return next > 0 ? window.slice(itemStart, itemStart + 1 + next) : window.slice(itemStart);
}

function firstImage(html) {
  const tag = firstMatch(html, /<img\b[^>]*>/i);
  return normalizeImageURL(attr(tag, "data-src") || attr(tag, "data-lazy-src") || attr(tag, "src"));
}

function normalizeImageURL(value) {
  return absoluteURL(decodeHTML(String(value || "").trim().replace(/\\\//g, "/")));
}

function isReaderImage(url) {
  const lower = String(url || "").toLowerCase();
  return /\.(?:webp|jpe?g|png)(?:[?#].*)?$/i.test(lower)
    && lower.includes("/wp-content/uploads/manga/")
    && !lower.includes("readerarea.svg");
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

function cleanTitle(value) {
  return htmlText(value)
    .replace(/\s+[–-]\s+Thunderscans EN.*$/i, "")
    .replace(/\s+Chapter\s+[0-9]+(?:\.[0-9]+)?.*$/i, "")
    .trim();
}

function titleCaseSlug(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
    .replace(/&#8217;/g, "'");
}

function parseDateText(value) {
  const text = htmlText(value);
  if (!text) {
    return null;
  }
  const normalized = text.replace(/GMT\+0000/i, " ");
  const time = Date.parse(normalized);
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

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostLog(message) {
  if (typeof host !== "undefined" && host && typeof host.log === "function") {
    host.log(String(message));
  }
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
