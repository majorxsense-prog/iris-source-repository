const SOURCE_ID = "asura-scans";
const SOURCE_NAME = "Asura Scans";
const SOURCE_AUTHOR = "majorxsense-prog";
const SITE_BASE_URL = "https://asurascans.com";
const API_BASE_URL = "https://api.asurascans.com";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    version: "0.1.1",
    language: "en",
    contentRating: "Everyone",
    website: SITE_BASE_URL,
    capabilities: [
      "CHAPTER_PROVIDING",
      "DISCOVER_SECTION_PROVIDING",
      "SEARCH_RESULT_PROVIDING"
    ]
  };
}

async function latestTitles(limit) {
  return fetchSeries({
    sort: "latest",
    order: "desc",
    limit: limit || 20,
    offset: 0
  });
}

async function discoverSections() {
  return [
    { id: "trending_today", title: "Trending Today", kind: "featured" },
    { id: "latest_updates", title: "Latest Updates", kind: "chapterUpdates" },
    { id: "popular_all_time", title: "Popular", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const offset = (Number(page) || 0) * size;

  switch (sectionID) {
  case "trending_today":
  case "featured":
    return fetchSeries({
      sort: "trending",
      order: "desc",
      limit: size,
      offset
    });
  case "latest_updates":
  case "latest":
    return fetchSeries({
      sort: "latest",
      order: "desc",
      limit: size,
      offset
    });
  case "popular":
  case "popular_all_time":
    return fetchSeries({
      sort: "popular",
      order: "desc",
      limit: size,
      offset
    });
  case "genres":
    return [];
  default:
    return latestTitles(size);
  }
}

async function search(request) {
  const query = normalizeQuery(request && (request.title || request.query || request.text || request));
  const page = Number(request && request.page) || 0;
  const filters = request && request.filters ? request.filters : {};

  return fetchSeries({
    search: query,
    sort: filters.sort || "latest",
    order: filters.order || "desc",
    limit: 20,
    offset: page * 20
  });
}

async function details(title) {
  const slug = titleSlug(title);
  const response = await apiGet(`/api/series/${encodeURIComponent(slug)}`);
  return mapSeries(response.series || response.data || response);
}

async function chapters(title) {
  const slug = titleSlug(title);
  const response = await apiGet(`/api/series/${encodeURIComponent(slug)}/chapters`);
  return (response.data || []).map(mapChapter).filter(Boolean);
}

async function chapterDetails(title, chapter) {
  if (chapter && chapter.isLocked) {
    throw new Error("This chapter is locked or still in early access.");
  }

  const slug = titleSlug(title);
  const number = chapterNumber(chapter);
  const response = await apiGet(`/api/series/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(formatNumber(number))}`, {
    "X-Page-Token": "asura-reader-2026",
    "User-Agent": "Iris/0.1"
  });
  const payload = response.data || {};

  if (payload.is_locked || payload.isLocked) {
    throw new Error("This chapter is locked or still in early access.");
  }

  const currentChapter = mapChapter(payload.chapter || chapter);
  const pages = ((payload.chapter || {}).pages || [])
    .map((page, index) => {
      if (!page || !page.url) {
        return null;
      }
      return {
        id: `${currentChapter.id}-${index}`,
        remoteURL: page.url,
        remoteUrl: page.url
      };
    })
    .filter(Boolean);

  if (!pages.length) {
    throw new Error("Asura Scans did not return any readable pages for this chapter.");
  }

  return {
    title,
    chapter: currentChapter,
    pages,
    nextChapter: mapChapter(payload.next_chapter || payload.nextChapter),
    previousChapter: mapChapter(payload.prev_chapter || payload.prevChapter),
    prevChapter: mapChapter(payload.prev_chapter || payload.prevChapter)
  };
}

async function fetchSeries(options) {
  const query = {
    sort: options.sort || "latest",
    order: options.order || "desc",
    limit: options.limit || 20,
    offset: options.offset || 0
  };

  if (options.search) {
    query.search = options.search;
  }

  const response = await apiGet(`/api/series?${queryString(query)}`);
  return (response.data || []).map(mapSeries).filter(Boolean);
}

async function apiGet(path, extraHeaders) {
  const text = await httpGetText(`${API_BASE_URL}${path}`, Object.assign({
    Accept: "application/json",
    "User-Agent": "Iris/0.1"
  }, extraHeaders || {}));
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

function mapSeries(series) {
  if (!series || !series.slug) {
    return null;
  }

  const latest = Array.isArray(series.latest_chapters) && series.latest_chapters.length
    ? series.latest_chapters[0]
    : null;
  const latestChapter = latest
    ? `Chapter ${formatNumber(numberValue(latest.number))}`
    : `${series.chapter_count || series.chapterCount || 0} chapters`;
  const type = series.type || "";
  const status = series.status || "";
  const subtitle = [capitalize(type), capitalize(status)].filter(Boolean).join(" - ") || latestChapter;

  return {
    id: series.slug,
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: series.title || "Untitled",
    subtitle,
    sourceName: SOURCE_NAME,
    latestChapter,
    progress: 0,
    coverSymbol: "book.closed",
    coverURL: series.cover_url || series.cover || null,
    coverUrl: series.cover_url || series.cover || null,
    synopsis: stripHTML(series.description || ""),
    status,
    type,
    author: cleanPlaceholder(series.author),
    artist: cleanPlaceholder(series.artist),
    rating: numberOrNull(series.rating),
    chapterCount: series.chapter_count || series.chapterCount || 0,
    tags: genreNames(series.genres)
  };
}

function mapChapter(chapter) {
  if (!chapter) {
    return null;
  }

  const number = numberValue(chapter.number);
  const isLocked = Boolean(chapter.is_locked || chapter.isLocked || (chapter.is_premium && isFutureDate(chapter.early_access_until || chapter.earlyAccessUntil)));

  return {
    id: String(chapter.id || chapter.slug || formatNumber(number)),
    title: chapterTitle(number, chapter.title),
    number,
    publishedAt: dateString(chapter.published_at || chapter.publishedAt || chapter.created_at || chapter.createdAt),
    isLocked,
    pageCount: chapter.page_count || chapter.pageCount || (Array.isArray(chapter.pages) ? chapter.pages.length : 0)
  };
}

function titleSlug(title) {
  if (typeof title === "string" || typeof title === "number") {
    return String(title);
  }
  return String(title.id || title.slug || "");
}

function chapterNumber(chapter) {
  if (typeof chapter === "number") {
    return chapter;
  }
  if (typeof chapter === "string") {
    return numberValue(chapter.replace(/^chapter-/i, ""));
  }
  return numberValue(chapter && (chapter.number || chapter.chapter || chapter.id));
}

function queryString(values) {
  return Object.keys(values)
    .filter((key) => values[key] !== undefined && values[key] !== null && values[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(values[key]))}`)
    .join("&");
}

function genreNames(genres) {
  if (!Array.isArray(genres)) {
    return [];
  }
  return genres
    .map((genre) => typeof genre === "string" ? genre : genre && genre.name)
    .filter(Boolean);
}

function chapterTitle(number, title) {
  const prefix = `Chapter ${formatNumber(number)}`;
  return title ? `${prefix} - ${title}` : prefix;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value) {
  const number = numberValue(value);
  return Number.isInteger(number) ? String(number) : String(number);
}

function dateString(value) {
  if (!value) {
    return new Date(0).toISOString();
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return new Date(0).toISOString();
  }
  return new Date(time).toISOString();
}

function isFutureDate(value) {
  if (!value) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && time > Date.now();
}

function normalizeQuery(value) {
  return String(value || "").trim();
}

function capitalize(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function cleanPlaceholder(value) {
  if (!value || value === "_") {
    return null;
  }
  return String(value);
}

function stripHTML(html) {
  return String(html || "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
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
