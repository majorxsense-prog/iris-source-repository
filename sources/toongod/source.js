const SOURCE_ID = "toongod";
const SOURCE_NAME = "ToonGod";
const SOURCE_AUTHOR = "majorxsense-prog";
const SITE_BASE_URL = "https://www.toongod.org";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    version: "0.1.1",
    language: "en",
    contentRating: "Mature",
    website: `${SITE_BASE_URL}/webtoons/`,
    requiresWebSession: true,
    cookieDomains: ["www.toongod.org", "toongod.org"],
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
    { id: "webtoons", title: "Webtoons", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const pageNumber = (Number(page) || 0) + 1;

  switch (sectionID) {
  case "latest_updates":
  case "webtoons":
    return parseTitleList(await htmlGet(pageNumber > 1 ? `/webtoons/page/${pageNumber}/` : "/webtoons/"), size);
  case "genres":
    return [];
  default:
    return latestTitles(size);
  }
}

async function search(request) {
  const query = normalizeQuery(request && (request.title || request.query || request.text || request));
  const page = Number(request && request.page) || 0;
  const path = query
    ? `/?s=${encodeURIComponent(query)}&post_type=wp-manga`
    : (page > 0 ? `/webtoons/page/${page + 1}/` : "/webtoons/");
  return parseTitleList(await htmlGet(path), 20);
}

async function details(title) {
  const slug = titleSlug(title);
  const html = await htmlGet(`/webtoon/${encodeURIComponent(slug)}/`);
  const base = titleDTO({
    id: slug,
    title: htmlText(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || firstMatch(html, /<h3[^>]*class="[^"]*post-title[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || (title && title.title) || slug),
    coverURL: firstImage(html),
    synopsis: htmlText(firstMatch(html, /<div[^>]*class="[^"]*(?:summary__content|description-summary|manga-excerpt)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || ""),
    status: htmlText(firstMatch(html, /(?:Status|State)[\s\S]{0,160}?<[^>]*>([^<]+)<\/[^>]+>/i) || ""),
    type: "Webtoon",
    latestChapter: (title && title.latestChapter) || "",
    tags: parseTags(html)
  });
  return base;
}

async function chapters(title) {
  const slug = titleSlug(title);
  const html = await htmlGet(`/webtoon/${encodeURIComponent(slug)}/`);
  const results = [];
  const seen = {};
  const blocks = chapterBlocks(html);

  for (const block of blocks) {
    const href = firstMatch(block, /<a[^>]+href=["']([^"']*\/(?:webtoon|manga)\/[^"']+\/(?:chapter|ch)-[^"']+\/?)["'][^>]*>/i);
    if (!href) {
      continue;
    }
    const id = absoluteURL(href);
    if (seen[id]) {
      continue;
    }
    seen[id] = true;
    const text = htmlText(firstMatch(block, /<a[^>]+href=["'][^"']*\/(?:webtoon|manga)\/[^"']+\/(?:chapter|ch)-[^"']+\/?["'][^>]*>([\s\S]*?)<\/a>/i));
    const number = chapterNumber(text || id);
    const publishedAt = parseChapterDate(block);
    const summary = {
      id,
      title: text || `Chapter ${formatNumber(number)}`,
      number,
      isLocked: false,
      pageCount: 0
    };
    if (publishedAt) {
      summary.publishedAt = publishedAt;
    }
    results.push(summary);
  }

  return results;
}

async function chapterDetails(title, chapter) {
  const finalChapterURL = chapterPath(title, chapter);
  hostLog(`ToonGod chapter URL: ${finalChapterURL}`);
  const html = await htmlGet(finalChapterURL);
  const currentChapter = Object.assign({}, chapter, {
    id: chapterID(chapter),
    pageCount: 0
  });
  const imageURLs = parseReaderImages(html);
  hostLog(`ToonGod reader images: ${imageURLs.slice(0, 3).join(" | ")}`);
  const pages = imageURLs.map((url, index) => ({
    id: `${currentChapter.id}-${index}`,
    remoteURL: url,
    remoteUrl: url
  }));

  if (!pages.length) {
    throw new Error("ToonGod did not return any readable pages for this chapter.");
  }

  currentChapter.pageCount = pages.length;

  let allChapters = [];
  try {
    allChapters = await chapters(title);
  } catch (error) {
    hostLog(`Unable to fetch ToonGod chapter list for next/previous metadata: ${error.message || error}`);
  }

  const currentIndex = allChapters.findIndex((item) => item.id === currentChapter.id);
  const nextChapter = currentIndex > 0 ? allChapters[currentIndex - 1] : null;
  const previousChapter = currentIndex >= 0 && currentIndex < allChapters.length - 1
    ? allChapters[currentIndex + 1]
    : null;

  return {
    title,
    chapter: currentChapter,
    pages,
    nextChapter,
    previousChapter,
    prevChapter: previousChapter
  };
}

async function htmlGet(pathOrURL) {
  const url = absoluteURL(pathOrURL);
  const html = await httpGetText(url, {
    Accept: "text/html,application/xhtml+xml,application/xml",
    Referer: `${SITE_BASE_URL}/webtoons/`
  });
  assertNotCloudflare(html);
  return html;
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

function assertNotCloudflare(html) {
  const text = String(html || "").toLowerCase();
  if (text.includes("cf-chl") || text.includes("just a moment") || text.includes("enable javascript and cookies to continue")) {
    throw new Error("ToonGod is blocked by Cloudflare. Complete browser verification in Iris if source web sessions are supported.");
  }
}

function parseTitleList(html, limit) {
  const items = [];
  const seen = {};
  const anchorPattern = /<a[^>]+href=["']([^"']*\/(?:webtoon|manga)\/([^"'\/?#]+)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null && items.length < (limit || 20)) {
    const url = absoluteURL(match[1]);
    const slug = match[2];
    if (!slug || slug.startsWith("chapter-") || slug.startsWith("ch-") || seen[slug]) {
      continue;
    }
    seen[slug] = true;
    const block = cardBlock(html, match.index);
    const title = titleFromBlock(block, match[3], slug);
    const latest = htmlText(firstMatch(block, /(Chapter\s+[0-9][^<]*)/i) || "");
    const coverURL = firstImage(block);
    items.push(titleDTO({
      id: slug,
      title,
      latestChapter: latest,
      coverURL,
      synopsis: "",
      status: "",
      type: "Webtoon",
      tags: []
    }));
  }

  return items;
}

function parseReaderImages(html) {
  const content = firstMatch(html, /<div[^>]*class=["'][^"']*(?:reading-content|entry-content|chapter-content|chapter-images)[^"']*["'][^>]*>([\s\S]*?)(?:<div[^>]*class=["'][^"']*(?:nav-links|chapter-nav|wp-manga-nav)[^"']*["']|<\/article>|<\/main>)/i) || html;
  const images = [];
  const seen = {};
  const imagePattern = /<img\b[^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(content)) !== null) {
    const url = imageURLFromTag(match[0]);
    if (!url || seen[url]) {
      continue;
    }
    seen[url] = true;
    images.push(absoluteURL(url));
  }

  return images;
}

function parseTags(html) {
  const tags = [];
  const seen = {};
  const tagPattern = /<a[^>]+href=["'][^"']*(?:webtoon-tag|genre|manga-genre)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = tagPattern.exec(html)) !== null) {
    const tag = htmlText(match[1]);
    if (tag && !seen[tag]) {
      seen[tag] = true;
      tags.push(tag);
    }
  }

  return tags;
}

function titleDTO(input) {
  return {
    id: input.id,
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: input.title || "Untitled",
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

function chapterBlocks(html) {
  const blocks = [];
  const listPattern = /<(?:li|div)[^>]+class=["'][^"']*(?:wp-manga-chapter|chapter-item|listing-chapters_wrap|chapter-link)[^"']*["'][^>]*>[\s\S]*?<\/(?:li|div)>/gi;
  let match;

  while ((match = listPattern.exec(html)) !== null) {
    if (/\/(?:webtoon|manga)\/[^"']+\/(?:chapter|ch)-/i.test(match[0])) {
      blocks.push(match[0]);
    }
  }

  if (blocks.length) {
    return blocks;
  }

  const anchorPattern = /<a[^>]+href=["'][^"']*\/(?:webtoon|manga)\/[^"']+\/(?:chapter|ch)-[^"']+\/?["'][^>]*>[\s\S]*?<\/a>/gi;
  while ((match = anchorPattern.exec(html)) !== null) {
    blocks.push(cardBlock(html, match.index, 700, 1000));
  }

  return blocks;
}

function cardBlock(html, index, before, after) {
  const start = Math.max(0, index - (before || 2000));
  const end = Math.min(html.length, index + (after || 3000));
  return html.slice(start, end);
}

function firstImage(html) {
  const imagePattern = /<img\b[^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(html)) !== null) {
    const url = imageURLFromTag(match[0]);
    if (url) {
      return url;
    }
  }

  return null;
}

function imageURLFromTag(tag) {
  const candidates = [
    attr(tag, "data-src"),
    attr(tag, "data-lazy-src"),
    attr(tag, "data-original"),
    attr(tag, "data-cfsrc"),
    attr(tag, "data-url"),
    attr(tag, "data-full"),
    attr(tag, "data-large_image"),
    firstSrcsetURL(attr(tag, "data-lazy-srcset")),
    firstSrcsetURL(attr(tag, "data-srcset")),
    firstSrcsetURL(attr(tag, "srcset")),
    attr(tag, "src")
  ];

  for (const candidate of candidates) {
    const url = decodeHTML(String(candidate || "").trim());
    if (isUsefulImageURL(url)) {
      return absoluteURL(url);
    }
  }

  return null;
}

function isUsefulImageURL(url) {
  const lower = String(url || "").toLowerCase();
  return Boolean(url)
    && !lower.startsWith("data:")
    && !lower.includes("blank")
    && !lower.includes("placeholder")
    && !lower.includes("loading")
    && !lower.includes("loader")
    && !lower.includes("logo")
    && !lower.includes("avatar")
    && !lower.includes("spinner")
    && !lower.includes("1x1")
    && !lower.includes("pixel")
    && !lower.includes("/cdn-cgi/")
    && /\.(?:avif|webp|jpe?g|png)(?:[?#].*)?$/i.test(lower);
}

function firstSrcsetURL(value) {
  const first = String(value || "").split(",")[0] || "";
  return first.trim().split(/\s+/)[0] || "";
}

function titleFromBlock(block, anchorHTML, slug) {
  return htmlText(firstMatch(block, /<h[1-6][^>]*class=["'][^"']*(?:post-title|manga-title|entry-title)[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/i))
    || htmlText(anchorHTML)
    || htmlText(attr(firstMatch(block, /<img\b[^>]*>/i), "alt"))
    || slug.replace(/-/g, " ");
}

function parseChapterDate(block) {
  const candidates = [
    attr(firstMatch(block, /<time\b[^>]*>/i), "datetime"),
    firstMatch(block, /<span[^>]+class=["'][^"']*(?:chapter-release-date|date|time|chapter-time)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i),
    firstMatch(block, /<i[^>]+class=["'][^"']*(?:chapter-release-date|date|time|chapter-time)[^"']*["'][^>]*>([\s\S]*?)<\/i>/i),
    firstMatch(block, /<a[^>]+class=["'][^"']*(?:chapter-release-date|date|time|chapter-time)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
  ];

  for (const candidate of candidates) {
    const iso = parseDateText(htmlText(candidate));
    if (iso) {
      return iso;
    }
  }

  return null;
}

function parseDateText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const direct = Date.parse(text);
  if (Number.isFinite(direct)) {
    return new Date(direct).toISOString();
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

  return null;
}

function attr(html, name) {
  if (!html) {
    return "";
  }
  return firstMatch(html, new RegExp(`${name}\\s*=\\s*[\"']([^\"']+)[\"']`, "i"));
}

function firstMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  if (!match) {
    return "";
  }
  return typeof match[1] === "undefined" ? match[0] : match[1];
}

function chapterPath(title, chapter) {
  const id = chapterID(chapter);
  if (id.startsWith("http") || id.startsWith("/")) {
    return id;
  }
  if (/^(?:webtoon|manga)\//i.test(id)) {
    return `/${id}`;
  }
  return `/webtoon/${titleSlug(title)}/${id}/`;
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

function chapterNumber(value) {
  const match = String(value || "").match(/(?:chapter|ch)[-\s]*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? numberValue(match[1]) : 0;
}

function pathFromURL(url) {
  const path = String(url || "").replace(/^https?:\/\/[^/]+/i, "");
  return path.replace(/^\/+|\/+$/g, "");
}

function absoluteURL(value) {
  const url = decodeHTML(String(value || "").trim());
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
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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
