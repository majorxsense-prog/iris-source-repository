const SOURCE_ID = "example-source";
const SOURCE_NAME = "Example Source";
const SOURCE_AUTHOR = "Your Name";
const SITE_BASE_URL = "https://example.com";

function getManifest() {
  return {
    id: SOURCE_ID,
    slug: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    description: "Iris Official Source for example.com.",
    version: "0.1.0",
    schemaVersion: 1,
    language: "en",
    contentRating: "Teen",
    website: SITE_BASE_URL,
    entry: "source.js",
    runtime: {
      kind: "javascript",
      entry: "source.js",
      minimumIrisVersion: "0.1.0"
    },
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
    { id: "popular", title: "Popular", kind: "simpleCarousel" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const pageNumber = (Number(page) || 0) + 1;
  hostLog(`TODO discover ${sectionID} limit=${size} page=${pageNumber}`);
  return [];
}

async function search(request) {
  const query = normalizeQuery(request && (request.title || request.query || request.text || request));
  if (!query) {
    return latestTitles(20);
  }
  hostLog(`TODO search ${query}`);
  return [];
}

async function details(title) {
  return titleDTO(titleFromObject(title));
}

async function chapters(title) {
  hostLog(`TODO chapters for ${titleID(title)}`);
  return [];
}

async function chapterDetails(title, chapter) {
  throw new Error("This source template does not implement chapterDetails yet.");
}

async function htmlGet(pathOrURL, headers) {
  return httpGetText(absoluteURL(pathOrURL), Object.assign({
    Accept: "text/html,application/xhtml+xml,application/xml",
    Referer: `${SITE_BASE_URL}/`
  }, headers || {}));
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
  input = input || {};
  const coverURL = cleanCoverURL(input.coverURL);
  const chapterCount = numericChapterCount(input.chapterCount);

  return {
    id: String(input.id || input.slug || ""),
    sourceID: SOURCE_ID,
    title: input.title || "Untitled",
    subtitle: input.subtitle || [input.type, input.status].filter(Boolean).join(" - "),
    sourceName: SOURCE_NAME,
    latestChapter: input.latestChapter || "",
    coverURL,
    synopsis: input.synopsis || "",
    status: input.status || "",
    type: input.type || "",
    author: input.author || null,
    artist: input.artist || null,
    rating: numberOrNull(input.rating),
    chapterCount,
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : []
  };
}

function chapterDTO(input) {
  input = input || {};
  return {
    id: String(input.id || input.url || input.slug || ""),
    title: input.title || `Chapter ${formatNumber(input.number)}`,
    number: numberValue(input.number),
    publishedAt: realDateString(input.publishedAt || input.date || input.createdAt),
    isLocked: Boolean(input.isLocked),
    pageCount: numericChapterCount(input.pageCount)
  };
}

function pageDTO(url, id) {
  const remoteURL = absoluteURL(url);
  return {
    id: String(id || remoteURL),
    remoteURL
  };
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

function realDateString(value) {
  if (!value) {
    return null;
  }
  const time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) {
    return null;
  }
  const date = new Date(time);
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= new Date().getUTCFullYear() + 1 ? date.toISOString() : null;
}

function absoluteURL(value) {
  const url = String(value || "").trim();
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

function titleFromObject(title) {
  return typeof title === "object" && title ? title : { id: String(title || "") };
}

function titleID(title) {
  if (typeof title === "string" || typeof title === "number") {
    return String(title);
  }
  return String(title && (title.id || title.slug) || "");
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
