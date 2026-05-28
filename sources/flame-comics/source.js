const SOURCE_ID = "flame-comics";
const SOURCE_NAME = "Flame Comics";
const SITE_BASE_URL = "https://flamecomics.xyz";
const CDN_SERIES_URL = "https://cdn.flamecomics.xyz/uploads/images/series";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: "Community",
    version: "0.1.3",
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
  return discoverItems("latest", limit || 20, 0);
}

async function discoverSections() {
  return [
    { id: "popular", title: "Popular", kind: "featured" },
    { id: "staff_picks", title: "Staff Picks", kind: "simpleCarousel" },
    { id: "latest", title: "Latest", kind: "chapterUpdates" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const pageIndex = Number(page) || 0;
  let entries = [];

  switch (sectionID) {
  case "popular":
    entries = await browseEntries();
    entries.sort((left, right) => numberValue(right.likes) - numberValue(left.likes));
    return pagedTitles(entries, size, pageIndex);
  case "staff_picks":
    entries = blockSeries((await nextData("/")).staffPicks);
    return pageIndex > 0 ? [] : pagedTitles(entries, size, 0);
  case "latest":
  case "latest_updates":
    entries = await latestEntries();
    return pagedTitles(entries, size, pageIndex);
  case "catalog":
  case "browse":
    entries = await browseEntries();
    return pagedTitles(entries, size, pageIndex);
  case "genres":
    return [];
  default:
    return latestTitles(size);
  }
}

async function latestEntries() {
  const data = await nextData("/latest");
  if (Array.isArray(data.allSeries)) {
    return data.allSeries;
  }
  return blockSeries((await nextData("/")).latestEntries);
}

async function browseEntries() {
  const data = await nextData("/browse");
  return Array.isArray(data.series) ? data.series : [];
}

function pagedTitles(entries, limit, page) {
  const size = Math.max(1, Number(limit) || 20);
  const pageIndex = Math.max(0, Number(page) || 0);
  const offset = pageIndex * size;
  return uniqueSeries(entries)
    .map(mapListSeries)
    .filter(Boolean)
    .slice(offset, offset + size);
}

function uniqueSeries(entries) {
  const seen = {};
  const results = [];

  for (const entry of entries || []) {
    const id = entry && (entry.series_id || entry.seriesID);
    if (!id || seen[id]) {
      continue;
    }
    seen[id] = true;
    results.push(entry);
  }

  return results;
}

async function search(query) {
  const data = await nextData("/browse");
  const titles = (data.series || []).map(mapListSeries).filter(Boolean);
  const searchText = normalizeQuery(query && (query.title || query.query || query.text || query));

  if (!searchText) {
    return titles;
  }

  return titles.filter((title) => {
    const haystack = [
      title.title,
      title.subtitle,
      title.synopsis,
      title.status,
      title.type,
      title.tags.join(" ")
    ].join(" ").toLowerCase();
    return haystack.includes(searchText);
  });
}

async function details(title) {
  const seriesId = titleId(title);
  const data = await nextData(`/series/${seriesId}`);
  return mapSeriesDetail(data.series, (data.chapters || []).length);
}

async function chapters(title) {
  const seriesId = titleId(title);
  const data = await nextData(`/series/${seriesId}`);
  return (data.chapters || []).map(mapChapterListItem);
}

async function chapterDetails(title, chapter) {
  const seriesId = titleId(title);
  const chapterToken = chapterId(chapter);
  const data = await nextData(`/series/${seriesId}/${chapterToken}`);
  const currentChapter = mapChapterPage(data.chapter);
  const pages = sortedImages(data.chapter.images).map((image, index) => {
    const url = `${CDN_SERIES_URL}/${seriesId}/${data.chapter.token}/${encodePathComponent(image.name)}`;
    return {
      id: `${currentChapter.id}-${index}`,
      remoteURL: url,
      remoteUrl: url
    };
  });

  if (!pages.length) {
    throw new Error("Flame Comics did not return any readable pages for this chapter.");
  }

  let allChapters = [];
  try {
    allChapters = await chapters(title);
  } catch (error) {
    hostLog(`Unable to fetch chapter list for next/previous metadata: ${error.message || error}`);
  }

  return {
    title,
    chapter: currentChapter,
    pages,
    nextChapter: data.next ? allChapters.find((item) => item.id === data.next) || null : null,
    previousChapter: data.previous ? allChapters.find((item) => item.id === data.previous) || null : null,
    prevChapter: data.previous ? allChapters.find((item) => item.id === data.previous) || null : null
  };
}

async function nextData(path) {
  const html = await httpGetText(`${SITE_BASE_URL}${path}`);
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("Unable to find Flame Comics page data.");
  }

  const envelope = JSON.parse(match[1]);
  if (!envelope.props || !envelope.props.pageProps) {
    throw new Error("Flame Comics page data is missing props.");
  }
  return envelope.props.pageProps;
}

async function httpGetText(url) {
  if (typeof host === "undefined" || !host || typeof host.httpGet !== "function") {
    throw new Error("Iris host.httpGet is unavailable.");
  }

  const response = await host.httpGet(url, {
    Accept: "text/html,application/xhtml+xml,application/json",
    "User-Agent": "Iris/0.1"
  });

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

function mapListSeries(series) {
  const seriesId = series.series_id || series.seriesID;
  if (!seriesId) {
    return null;
  }

  const tags = tagValues(series);
  const latestChapter = Array.isArray(series.chapters) && series.chapters.length
    ? `Chapter ${formatNumber(numberValue(series.chapters[0].chapter))}`
    : series.chapter_count
      ? `${series.chapter_count} chapters`
      : "Latest update";

  return titleDTO({
    id: String(seriesId),
    title: series.title || "Untitled",
    subtitle: [series.type, series.status].filter(Boolean).join(" - "),
    latestChapter,
    coverURL: coverURL(seriesId, series.cover, series.last_edit || series.lastEdit),
    synopsis: stripHTML(series.description || ""),
    status: series.status || "",
    type: series.type || "",
    author: joined(series.author),
    artist: joined(series.artist),
    chapterCount: series.chapter_count || series.chapterCount || 0,
    tags
  });
}

function blockSeries(section) {
  return (((section || {}).blocks || [])[0] || {}).series || [];
}

function mapSeriesDetail(series, chapterCount) {
  const seriesId = series.series_id || series.seriesID;
  return titleDTO({
    id: String(seriesId),
    title: series.title || "Untitled",
    subtitle: [series.type, series.status].filter(Boolean).join(" - "),
    latestChapter: `${chapterCount || 0} chapters`,
    coverURL: coverURL(seriesId, series.cover, series.last_edit || series.lastEdit),
    synopsis: stripHTML(series.description || ""),
    status: series.status || "",
    type: series.type || "",
    author: joined(series.author),
    artist: joined(series.artist),
    chapterCount: chapterCount || 0,
    tags: Array.isArray(series.tags) ? series.tags : splitTags(series.tags)
  });
}

function titleDTO(input) {
  const coverURLValue = cleanCoverURL(input.coverURL
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
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: input.title || "Untitled",
    subtitle: input.subtitle || "",
    sourceName: SOURCE_NAME,
    latestChapter: input.latestChapter || "",
    progress: 0,
    coverSymbol: "flame",
    coverURL: coverURLValue,
    coverUrl: coverURLValue,
    cover: coverURLValue,
    thumbnail: coverURLValue,
    thumbnailURL: coverURLValue,
    thumbnailUrl: coverURLValue,
    image: coverURLValue,
    imageURL: coverURLValue,
    imageUrl: coverURLValue,
    poster: coverURLValue,
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

function mapChapterListItem(chapter) {
  const number = numberValue(chapter.chapter);
  return {
    id: chapter.token,
    title: chapterTitle(number, chapter.title),
    number,
    publishedAt: dateString(chapter.release_date || chapter.releaseDate),
    isLocked: false,
    pageCount: 0
  };
}

function mapChapterPage(chapter) {
  const number = numberValue(chapter.chapter);
  return {
    id: chapter.token,
    title: chapterTitle(number, chapter.chapter_title || chapter.chapterTitle),
    number,
    publishedAt: dateString(chapter.release_date || chapter.releaseDate),
    isLocked: false,
    pageCount: sortedImages(chapter.images).length
  };
}

function titleId(title) {
  if (typeof title === "string" || typeof title === "number") {
    return String(title);
  }
  return String(title.id || title.seriesID || title.seriesId);
}

function chapterId(chapter) {
  if (typeof chapter === "string" || typeof chapter === "number") {
    return String(chapter);
  }
  return String(chapter.id || chapter.token);
}

function tagValues(series) {
  if (Array.isArray(series.categories)) {
    return series.categories;
  }
  if (Array.isArray(series.tags)) {
    return series.tags;
  }
  return splitTags(series.categories || series.tags || "");
}

function splitTags(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return String(value).split(/\s+/).filter(Boolean);
}

function sortedImages(images) {
  return Object.keys(images || {})
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => images[key])
    .filter((image) => image && image.name);
}

function coverURL(seriesId, cover, lastEdit) {
  if (!cover) {
    return null;
  }
  const base = `${CDN_SERIES_URL}/${seriesId}/${encodePathComponent(cover)}`;
  return lastEdit ? `${base}?${lastEdit}` : base;
}

function chapterTitle(number, title) {
  const prefix = `Chapter ${formatNumber(number)}`;
  return title ? `${prefix} - ${title}` : prefix;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function dateString(unixSeconds) {
  const seconds = Number(unixSeconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function cleanCoverURL(value) {
  const url = String(value || "").trim().replace(/&amp;/g, "&").replace(/\\\//g, "/");
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

function normalizeQuery(value) {
  return String(value || "").trim().toLowerCase();
}

function joined(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ") || null;
  }
  return value ? String(value) : null;
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

function encodePathComponent(value) {
  return String(value)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
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
