const SOURCE_ID = "flame-comics";
const SOURCE_NAME = "Flame Comics";
const SITE_BASE_URL = "https://flamecomics.xyz";
const CDN_SERIES_URL = "https://cdn.flamecomics.xyz/uploads/images/series";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: "Community",
    version: "0.1.0",
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
  const data = await nextData("/");
  const entries = (((data.latestEntries || {}).blocks || [])[0] || {}).series || [];
  return entries.map(mapListSeries).filter(Boolean).slice(0, limit || 20);
}

async function discoverSections() {
  return [
    { id: "latest", title: "Latest", kind: "chapterUpdates" },
    { id: "popular", title: "Popular", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
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
  return {
    id: input.id,
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: input.title,
    subtitle: input.subtitle || "",
    sourceName: SOURCE_NAME,
    latestChapter: input.latestChapter || "",
    progress: 0,
    coverSymbol: "flame",
    coverURL: input.coverURL || null,
    coverUrl: input.coverURL || null,
    synopsis: input.synopsis || "",
    status: input.status || "",
    type: input.type || "",
    author: input.author || null,
    artist: input.artist || null,
    rating: null,
    chapterCount: input.chapterCount || 0,
    tags: input.tags || []
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
    return new Date(0).toISOString();
  }
  return new Date(seconds * 1000).toISOString();
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
root.search = search;
root.details = details;
root.chapters = chapters;
root.chapterDetails = chapterDetails;

if (typeof module !== "undefined") {
  module.exports = {
    getManifest,
    latestTitles,
    discoverSections,
    search,
    details,
    chapters,
    chapterDetails
  };
}
