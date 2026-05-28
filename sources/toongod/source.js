const SOURCE_ID = "toongod";
const SOURCE_NAME = "ToonGod";
const SOURCE_AUTHOR = "majorxsense-prog";
const SITE_BASE_URL = "https://www.toongod.org";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    version: "0.1.8",
    language: "en",
    contentRating: "Mature",
    website: `${SITE_BASE_URL}/webtoons/`,
    requiresWebSession: true,
    cookieDomains: ["www.toongod.org", "toongod.org"],
    settings: [
      {
        id: "showAdultTitles",
        type: "boolean",
        title: "Show 18+ Titles",
        defaultValue: true
      }
    ],
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
    { id: "webtoons", title: "All Webtoons", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const pageNumber = (Number(page) || 0) + 1;

  switch (sectionID) {
  case "latest_updates":
  case "latest":
    return discoverPagedTitles((page) => webtoonListPath(page, "latest"), size, pageNumber);
  case "popular":
    return discoverPagedTitles((page) => webtoonListPath(page, "views"), size, pageNumber);
  case "webtoons":
  case "catalog":
    return discoverPagedTitles((page) => webtoonListPath(page, ""), size, pageNumber);
  case "genres":
    return [];
  default:
    return latestTitles(size);
  }
}

async function discoverPagedTitles(pathForPage, limit, requestedPageNumber) {
  const size = Math.max(1, Number(limit) || 20);
  const pageNumber = Math.max(1, Number(requestedPageNumber) || 1);

  if (pageNumber > 1) {
    return enrichTitleMetadata(parseTitleList(await htmlGet(pathForPage(pageNumber)), size), size);
  }

  const items = [];
  const seen = {};
  const maxPages = Math.min(260, Math.max(1, Math.ceil(size / 20) + 3));
  let stagnantPages = 0;

  for (let currentPage = 1; items.length < size && currentPage <= maxPages && stagnantPages < 2; currentPage += 1) {
    const before = items.length;
    const pageItems = parseTitleList(await htmlGet(pathForPage(currentPage)), 200);
    for (const item of pageItems) {
      if (!item || !item.id || seen[item.id]) {
        continue;
      }
      seen[item.id] = true;
      items.push(item);
      if (items.length >= size) {
        break;
      }
    }
    stagnantPages = items.length === before ? stagnantPages + 1 : 0;
  }

  return enrichTitleMetadata(items.slice(0, size), size);
}

function webtoonListPath(pageNumber, order) {
  const path = pageNumber > 1 ? `/webtoons/page/${pageNumber}/` : "/webtoons/";
  return order ? `${path}?order=${encodeURIComponent(order)}` : path;
}

async function search(request) {
  const query = normalizeQuery(request && (request.title || request.query || request.text || request));
  const page = Number(request && request.page) || 0;
  if (!query) {
    return discoverItems("webtoons", 20, page);
  }

  const paths = searchPaths(query, page);
  let lastError = null;

  for (const path of paths) {
    try {
      const items = parseTitleList(await htmlGet(path), 20);
      hostLog(`ToonGod search path ${path} returned ${items.length} item(s).`);
      if (items.length) {
        return items;
      }
    } catch (error) {
      lastError = error;
      hostLog(`ToonGod search path ${path} failed: ${error.message || error}`);
    }
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}

function searchPaths(query, page) {
  const encoded = encodeURIComponent(query);
  const pageNumber = Math.max(1, (Number(page) || 0) + 1);
  if (pageNumber > 1) {
    return [
      `/page/${pageNumber}/?s=${encoded}&post_type=wp-manga`,
      `/page/${pageNumber}/?s=${encoded}`,
      `/search/?s=${encoded}`
    ];
  }

  return [
    `/search/?s=${encoded}`,
    `/?s=${encoded}&post_type=wp-manga`,
    `/?s=${encoded}`
  ];
}

async function details(title) {
  const slug = titleSlug(title);
  const html = await htmlGet(`/webtoon/${encodeURIComponent(slug)}/`);
  const blocks = chapterBlocks(html);
  const parsedChapterCount = blocks.length;
  const parsedLatestChapter = latestChapterFromChapterBlocks(blocks) || (parsedChapterCount ? `${parsedChapterCount} chapters` : "");
  const base = titleDTO({
    id: slug,
    title: titleFromDocument(html, title, slug),
    coverURL: firstImage(html) || (title && (title.coverURL || title.coverUrl || title.cover)),
    synopsis: htmlText(firstMatch(html, /<div[^>]*class="[^"]*(?:summary__content|description-summary|manga-excerpt)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || ""),
    status: htmlText(firstMatch(html, /(?:Status|State)[\s\S]{0,160}?<[^>]*>([^<]+)<\/[^>]+>/i) || ""),
    type: "Webtoon",
    latestChapter: parsedLatestChapter || (title && title.latestChapter) || "",
    chapterCount: parsedChapterCount || (title && title.chapterCount) || 0,
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
    const text = chapterTitle(block, id);
    const number = chapterNumber(text || id);
    const publishedAt = parseChapterDate(block);
    const summary = {
      id,
      title: text || `Chapter ${formatNumber(number)}`,
      number,
      publishedAt: publishedAt || null,
      isLocked: false,
      pageCount: 0
    };
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
    hostLog(`ToonGod chapter image parse failed. Image tags: ${countMatches(html, /<(?:img|amp-img|source)\b/gi)}. HTML title: ${titleFromDocument(html, title, titleSlug(title))}`);
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
    const block = listingBlock(html, match.index);
    const isAdult = isAdultBlock(block);
    if (isAdult && !shouldShowAdultTitles()) {
      continue;
    }
    const title = titleFromBlock(block, match[3], slug, match[0]);
    const latest = latestChapterFromBlock(block);
    const chapterCount = chapterCountFromBlock(block, latest);
    const coverURL = firstImage(match[0]) || firstImage(block) || coverFallbackURL(slug);
    items.push(titleDTO({
      id: slug,
      title,
      latestChapter: latest || (chapterCount ? `${chapterCount} chapters` : ""),
      coverURL,
      chapterCount,
      synopsis: "",
      status: "",
      type: "Webtoon",
      tags: []
    }));
  }

  return items;
}

async function enrichTitleMetadata(items, limit) {
  const sourceItems = Array.isArray(items) ? items : [];
  const maxEnriched = Math.min(sourceItems.length, Math.max(1, Number(limit) || sourceItems.length), 12);
  const enriched = [];

  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    if (!item || index >= maxEnriched || (item.latestChapter && numericChapterCount(item.chapterCount) > 0)) {
      enriched.push(item);
      continue;
    }

    try {
      const meta = await titleMetadata(item.id || item.slug);
      enriched.push(titleDTO(Object.assign({}, item, {
        latestChapter: item.latestChapter || meta.latestChapter || (meta.chapterCount ? `${meta.chapterCount} chapters` : ""),
        chapterCount: item.chapterCount || meta.chapterCount || 0,
        coverURL: item.coverURL || item.coverUrl || meta.coverURL || null
      })));
    } catch (error) {
      hostLog(`Unable to enrich ToonGod metadata for ${item.id || item.slug}: ${error.message || error}`);
      enriched.push(item);
    }
  }

  return enriched;
}

async function titleMetadata(slug) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) {
    return {};
  }

  const cached = cachedTitleMetadata(normalizedSlug);
  if (cached) {
    return cached;
  }

  const html = await htmlGet(`/webtoon/${encodeURIComponent(normalizedSlug)}/`);
  const blocks = chapterBlocks(html);
  const chapterCount = blocks.length;
  const latestChapter = latestChapterFromChapterBlocks(blocks) || (chapterCount ? `${chapterCount} chapters` : "");
  const coverURL = firstImage(html);
  const metadata = {
    latestChapter,
    chapterCount,
    coverURL
  };
  cacheTitleMetadata(normalizedSlug, metadata);
  return metadata;
}

function parseReaderImages(html) {
  const content = readerContent(html) || html;
  const images = [];
  const seen = {};
  collectReaderImageURLs(content, images, seen);

  if (!images.length && content !== html) {
    collectReaderImageURLs(html, images, seen);
  }

  const readerPages = images.filter(isReaderPageImageURL);
  return readerPages.length ? readerPages : images;
}

function collectReaderImageURLs(content, images, seen) {
  const imagePattern = /<(?:img|amp-img|source)\b[^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(content)) !== null) {
    const urls = imageURLsFromTag(match[0], true);
    for (const url of urls) {
      if (!url || seen[url]) {
        continue;
      }
      seen[url] = true;
      images.push(absoluteURL(url));
    }
  }

  for (const url of scriptImageURLs(content)) {
    if (!url || seen[url]) {
      continue;
    }
    seen[url] = true;
    images.push(absoluteURL(url));
  }
}

function readerContent(html) {
  const source = String(html || "");
  const startMatch = source.match(/<div[^>]+class=["'][^"']*(?:reading-content|reading-img|reader-area|chapter-content|chapter-images|entry-content)[^"']*["'][^>]*>/i);
  if (!startMatch) {
    return "";
  }

  const start = startMatch.index;
  const rest = source.slice(start);
  const endMatch = rest.search(/<div[^>]+class=["'][^"']*(?:choose-chapter|newest-chapter|nav-links|chapter-nav|wp-manga-nav|comments-area)[^"']*["']|<\/article>|<\/main>|<footer\b/i);
  return endMatch > 0 ? rest.slice(0, endMatch) : rest;
}

function scriptImageURLs(html) {
  const urls = [];
  const seen = {};
  const text = String(html || "");
  const patterns = [
    /https?:\\?\/\\?\/[^"'`<>\s]+/gi,
    /["'](\/[^"'`<>\s]+(?:\/chapters?\/|\/chapter\/)[^"'`<>\s]+)["']/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = normalizeImageURL(match[1] || match[0]);
      if (value && !seen[value] && isUsefulImageURL(value, true)) {
        seen[value] = true;
        urls.push(value);
      }
    }
  }

  return urls;
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
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: input.title || "Untitled",
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

  const listItemPattern = /<li\b[^>]*>[\s\S]*?<\/li>/gi;
  while ((match = listItemPattern.exec(html)) !== null) {
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

function listingBlock(html, index) {
  const start = Math.max(0, index - 1400);
  const end = Math.min(html.length, index + 2200);
  const window = html.slice(start, end);
  const relativeIndex = index - start;
  const itemPattern = /<(?:div|article|li)[^>]+class=["'][^"']*(?:latest-item|page-item-detail|manga-item|manga|bsx|utao|listupd|item-thumb|item-summary)[^"']*["'][^>]*>/gi;
  let itemStart = -1;
  let match;

  while ((match = itemPattern.exec(window)) !== null) {
    if (match.index <= relativeIndex) {
      itemStart = match.index;
    }
  }

  if (itemStart < 0) {
    return cardBlock(html, index, 500, 1600);
  }

  const tail = window.slice(Math.max(relativeIndex + 1, itemStart + 1));
  itemPattern.lastIndex = 0;
  const nextMatch = itemPattern.exec(tail);
  const itemEnd = nextMatch && typeof nextMatch.index === "number"
    ? Math.max(relativeIndex + 1, itemStart + 1) + nextMatch.index
    : window.length;
  return window.slice(itemStart, itemEnd);
}

function firstImage(html) {
  const imagePattern = /<(?:img|amp-img|source)\b[^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(html)) !== null) {
    const url = imageURLsFromTag(match[0], false)[0];
    if (url) {
      return url;
    }
  }

  return null;
}

function coverFallbackURL(slug) {
  return slug ? `${SITE_BASE_URL}/manga/${encodePathComponent(slug)}-cover.jpg` : null;
}

function imageURLsFromTag(tag, readerOnly) {
  const candidates = [
    attr(tag, "data-src"),
    attr(tag, "data-lazy-src"),
    attr(tag, "data-pagespeed-lazy-src"),
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
  const urls = [];
  const seen = {};

  for (const candidate of candidates) {
    const url = normalizeImageURL(candidate);
    if (url && !seen[url] && isUsefulImageURL(url, readerOnly)) {
      seen[url] = true;
      urls.push(absoluteURL(url));
    }
  }

  return urls;
}

function isUsefulImageURL(url, readerOnly) {
  const lower = String(url || "").toLowerCase();
  if (!url
    || lower.startsWith("data:")
    || lower.includes("blank")
    || lower.includes("placeholder")
    || lower.includes("loading")
    || lower.includes("loader")
    || lower.includes("logo")
    || lower.includes("avatar")
    || lower.includes("spinner")
    || lower.includes("1x1")
    || lower.includes("pixel")
    || lower.includes("/cdn-cgi/")) {
    return false;
  }

  const looksLikeImage = /\.(?:avif|webp|jpe?g|png)(?:[?#].*)?$/i.test(lower);
  if (!readerOnly) {
    return looksLikeImage;
  }

  return isReaderPageImageURL(url);
}

function isReaderPageImageURL(url) {
  const lower = String(url || "").toLowerCase();
  if (!/\.(?:avif|webp|jpe?g|png)(?:[?#].*)?$/i.test(lower)) {
    return false;
  }

  if (lower.includes("thumb")
    || lower.includes("thumbnail")
    || lower.includes("cover")
    || lower.includes("logo")
    || lower.includes("arrow")
    || lower.includes("prev")
    || lower.includes("next")
    || lower.includes("banner")
    || lower.includes("avatar")
    || lower.includes("wp-content")
    || lower.includes("toongod.org/wp-")
    || lower.includes("/uploads/series/")
    || lower.includes("/uploads/images/")) {
    return false;
  }

  return /\/\/i\.tngcdn\.com\/manga_[^\/]+\/[^\/]+\/[^\/]+\.(?:avif|webp|jpe?g|png)(?:[?#].*)?$/i.test(lower)
    || /\/manga_[^\/]+\/[^\/]+\/(?:\d+|page)[^\/]*\.(?:avif|webp|jpe?g|png)(?:[?#].*)?$/i.test(lower)
    || /\/chapters?\/[^\/]+\/(?:\d+|page)[^\/]*\.(?:avif|webp|jpe?g|png)(?:[?#].*)?$/i.test(lower);
}

function normalizeImageURL(value) {
  return decodeHTML(String(value || "")
    .trim()
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&"));
}

function cleanCoverURL(value) {
  const url = normalizeImageURL(value);
  if (!url || !isUsefulImageURL(url, false)) {
    return null;
  }
  return absoluteURL(url);
}

function firstSrcsetURL(value) {
  const first = String(value || "").split(",")[0] || "";
  return first.trim().split(/\s+/)[0] || "";
}

function titleFromBlock(block, anchorHTML, slug, anchorTag) {
  return firstCleanTitle([
    attr(anchorTag, "title"),
    attr(anchorTag, "aria-label"),
    attr(anchorTag, "data-title"),
    attr(firstMatch(block, /<img\b[^>]*>/i), "alt"),
    attr(firstMatch(block, /<img\b[^>]*>/i), "title"),
    firstMatch(block, /<h[1-6][^>]*class=["'][^"']*(?:post-title|manga-title|entry-title)[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/i),
    anchorHTML,
    slug.replace(/-/g, " ")
  ]) || slug.replace(/-/g, " ");
}

function chapterTitle(block, id) {
  const anchor = firstMatch(block, /<a[^>]+href=["'][^"']*\/(?:webtoon|manga)\/[^"']+\/(?:chapter|ch)-[^"']+\/?["'][^>]*>[\s\S]*?<\/a>/i);
  const titleAttribute = attr(anchor, "title").replace(/^.*\s+-\s+/i, "");
  const text = htmlText(firstMatch(block, /<span[^>]+class=["'][^"']*chapter-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i))
    || htmlText(titleAttribute)
    || htmlText(anchor);
  const cleaned = text
    .replace(/\b(?:today|yesterday)\b.*$/i, "")
    .replace(/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b.*$/i, "")
    .replace(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b.*$/i, "")
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b.*$/i, "")
    .replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\b.*$/i, "")
    .trim();
  return cleaned || `Chapter ${formatNumber(chapterNumber(id))}`;
}

function latestChapterFromBlock(block) {
  const anchor = firstMatch(block, /<a[^>]+href=["'][^"']*\/(?:webtoon|manga)\/[^"']+\/(?:chapter|ch)-[^"']+\/?["'][^>]*>[\s\S]*?<\/a>/i);
  const title = attr(anchor, "title").replace(/^.*\s+-\s+/i, "");
  const text = htmlText(title) || htmlText(anchor);
  const match = text.match(/(?:chapter|ch)\.?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? `Chapter ${formatNumber(match[1])}` : "";
}

function latestChapterFromChapterBlocks(blocks) {
  let highest = 0;

  for (const block of blocks || []) {
    const latest = latestChapterFromBlock(block);
    const latestNumber = numberFromChapterText(latest);
    if (latestNumber > highest) {
      highest = latestNumber;
    }

    const href = firstMatch(block, /\/(?:chapter|ch)-([0-9]+(?:\.[0-9]+)?)/i);
    const hrefNumber = numberValue(href);
    if (hrefNumber > highest) {
      highest = hrefNumber;
    }

    const textNumber = numberFromChapterText(htmlText(block));
    if (textNumber > highest) {
      highest = textNumber;
    }
  }

  return highest > 0 ? `Chapter ${formatNumber(highest)}` : "";
}

function chapterCountFromBlock(block, latestChapter) {
  const candidates = [
    firstMatch(block, /(?:latest|newest|last)\s+(?:chapter|ch)\.?\s*([0-9]+(?:\.[0-9]+)?)/i),
    firstMatch(block, /(?:chapter|chapters)\s*[:#]?\s*([0-9]+(?:\.[0-9]+)?)/i),
    firstMatch(block, /([0-9]+(?:\.[0-9]+)?)\s+(?:chapter|chapters)\b/i),
    firstMatch(latestChapter, /([0-9]+(?:\.[0-9]+)?)/i)
  ];

  for (const candidate of candidates) {
    const count = numericChapterCount(candidate);
    if (count > 0) {
      return count;
    }
  }
  return 0;
}

function numberFromChapterText(value) {
  const match = String(value || "").match(/(?:chapter|ch)\.?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? numberValue(match[1]) : 0;
}

function titleFromDocument(html, fallbackTitle, slug) {
  return firstCleanTitle([
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i),
    firstMatch(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i),
    firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    firstMatch(html, /<h3[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i),
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    fallbackTitle && fallbackTitle.title,
    slug.replace(/-/g, " ")
  ]) || slug.replace(/-/g, " ");
}

function firstCleanTitle(candidates) {
  for (const candidate of candidates) {
    const title = cleanTitle(candidate);
    if (title) {
      return title;
    }
  }
  return "";
}

function cleanTitle(value) {
  let title = htmlText(value)
    .replace(/^read\s+/i, "")
    .replace(/\s*(?:-|\u2013|\u2014)\s*toon\s*god.*$/i, "")
    .replace(/\s*(?:-|\u2013|\u2014)\s*toongod.*$/i, "")
    .replace(/\s*(?:-|\u2013|\u2014)\s*chapter\s+\d+(?:\.\d+)?.*$/i, "")
    .replace(/\s+(?:manga|manhwa|manhua)\s*\[?latest chapters?\]?.*$/i, "")
    .replace(/\s*\[?latest chapters?\]?.*$/i, "")
    .trim();

  if (!title || isBlockedTitle(title)) {
    return "";
  }
  return title;
}

function isBlockedTitle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized
    || normalized === "18"
    || normalized === "18+"
    || normalized === "+18"
    || normalized === "adult"
    || normalized === "mature"
    || normalized === "webtoon"
    || normalized === "manga"
    || normalized === "read more"
    || normalized === "view details";
}

function isAdultBlock(block) {
  return /(?:^|[>\s])(?:18\+|adult|mature|smut|uncensored)(?:[<\s]|$)/i.test(htmlText(block))
    || /(?:webtoon-tag|manga-genre)\/(?:18|18-plus|adult|mature|smut|uncensored)/i.test(block);
}

function parseChapterDate(block) {
  const candidates = [
    attr(firstMatch(block, /<time\b[^>]*>/i), "datetime"),
    firstMatch(block, /<span[^>]+class=["'][^"']*(?:chapter-release-date|ct-update|date|time|chapter-time)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i),
    firstMatch(block, /<i[^>]+class=["'][^"']*(?:chapter-release-date|ct-update|date|time|chapter-time)[^"']*["'][^>]*>([\s\S]*?)<\/i>/i),
    firstMatch(block, /<a[^>]+class=["'][^"']*(?:chapter-release-date|ct-update|date|time|chapter-time)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i),
    firstMatch(block, /((?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i),
    firstMatch(block, /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})/i),
    firstMatch(block, /(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})/i)
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

  if (/^today$/i.test(text)) {
    return new Date().toISOString();
  }

  if (/^yesterday$/i.test(text)) {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

  if (!looksLikeDate(text)) {
    return null;
  }

  const direct = Date.parse(text);
  if (Number.isFinite(direct)) {
    const date = new Date(direct);
    const year = date.getUTCFullYear();
    const maxYear = new Date().getUTCFullYear() + 1;
    if (year >= 2000 && year <= maxYear) {
      return date.toISOString();
    }
  }

  return null;
}

function looksLikeDate(text) {
  return /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i.test(text)
    || /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/i.test(text)
    || /\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(text)
    || /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}/.test(text);
}

function shouldShowAdultTitles() {
  const value = hostState([
    `${SOURCE_ID}.showAdultTitles`,
    "showAdultTitles",
    `sources.${SOURCE_ID}.showAdultTitles`
  ]);

  if (value === null || typeof value === "undefined" || value === "") {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
}

function hostState(keys) {
  if (typeof host === "undefined" || !host || typeof host.getState !== "function") {
    return null;
  }

  for (const key of keys) {
    try {
      const value = host.getState(key);
      if (value !== null && typeof value !== "undefined") {
        return value;
      }
    } catch (error) {
      hostLog(`Unable to read ToonGod setting ${key}: ${error.message || error}`);
    }
  }

  return null;
}

function cachedTitleMetadata(slug) {
  const raw = hostState([
    `titleMeta.${slug}`,
    `${SOURCE_ID}.titleMeta.${slug}`,
    `sources.${SOURCE_ID}.titleMeta.${slug}`
  ]);

  if (!raw) {
    return null;
  }

  try {
    const cached = JSON.parse(raw);
    const cachedAt = Number(cached.cachedAt || 0);
    if (!cachedAt || Date.now() - cachedAt > 7 * 24 * 60 * 60 * 1000) {
      return null;
    }
    return {
      latestChapter: cached.latestChapter || "",
      chapterCount: numericChapterCount(cached.chapterCount),
      coverURL: cached.coverURL || null
    };
  } catch (error) {
    hostLog(`Unable to parse ToonGod cached metadata for ${slug}: ${error.message || error}`);
    return null;
  }
}

function cacheTitleMetadata(slug, metadata) {
  if (typeof host === "undefined" || !host || typeof host.setState !== "function") {
    return;
  }

  try {
    host.setState(`titleMeta.${slug}`, JSON.stringify({
      latestChapter: metadata.latestChapter || "",
      chapterCount: numericChapterCount(metadata.chapterCount),
      coverURL: metadata.coverURL || null,
      cachedAt: Date.now()
    }));
  } catch (error) {
    hostLog(`Unable to cache ToonGod metadata for ${slug}: ${error.message || error}`);
  }
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

function encodePathComponent(value) {
  return String(value)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
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

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
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
