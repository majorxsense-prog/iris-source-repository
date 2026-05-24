const SOURCE_ID = "mangadex";
const SOURCE_NAME = "MangaDex";
const SOURCE_AUTHOR = "majorxsense-prog";
const SITE_BASE_URL = "https://mangadex.org";
const API_BASE_URL = "https://api.mangadex.org";
const UPLOADS_BASE_URL = "https://uploads.mangadex.org";
const CONTENT_RATINGS = ["safe", "suggestive"];
const TRANSLATED_LANGUAGE = "en";
const COVER_SIZE_SUFFIX = ".512.jpg";

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    version: "0.1.0",
    language: TRANSLATED_LANGUAGE,
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
  return fetchMangaList({
    limit: limit || 20,
    offset: 0,
    order: { latestUploadedChapter: "desc" }
  });
}

async function discoverSections() {
  return [
    { id: "latest_updates", title: "Latest Updates", kind: "chapterUpdates" },
    { id: "popular", title: "Popular", kind: "featured" },
    { id: "recently_added", title: "Recently Added", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const offset = (Number(page) || 0) * size;

  switch (sectionID) {
  case "latest":
  case "latest_updates":
    return fetchMangaList({
      limit: size,
      offset,
      order: { latestUploadedChapter: "desc" }
    });
  case "popular":
    return fetchMangaList({
      limit: size,
      offset,
      order: { followedCount: "desc" }
    });
  case "recently_added":
    return fetchMangaList({
      limit: size,
      offset,
      order: { createdAt: "desc" }
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
  const limit = 20;

  if (!query) {
    return latestTitles(limit);
  }

  return fetchMangaList({
    title: query,
    limit,
    offset: page * limit,
    order: { relevance: "desc" }
  });
}

async function details(title) {
  const response = await apiGet(`/manga/${encodeURIComponent(titleID(title))}?${queryString({
    "includes[]": ["cover_art", "author", "artist"]
  })}`);
  return mapManga(response.data);
}

async function chapters(title) {
  const mangaID = titleID(title);
  const all = [];
  const limit = 100;
  let offset = 0;
  let total = Infinity;

  while (offset < total && all.length < 500) {
    const response = await apiGet(`/manga/${encodeURIComponent(mangaID)}/feed?${queryString({
      limit,
      offset,
      "translatedLanguage[]": [TRANSLATED_LANGUAGE],
      "contentRating[]": CONTENT_RATINGS,
      "includes[]": ["scanlation_group"],
      "order[chapter]": "desc",
      "order[createdAt]": "desc"
    })}`);

    const items = response.data || [];
    all.push(...items);
    total = Number(response.total || all.length);
    offset += limit;

    if (!items.length) {
      break;
    }
  }

  return all.map(mapChapter).filter(Boolean);
}

async function chapterDetails(title, chapter) {
  if (chapter && chapter.isLocked) {
    throw new Error("This MangaDex chapter does not have readable MangaDex@Home pages.");
  }

  const response = await apiGet(`/at-home/server/${encodeURIComponent(chapterID(chapter))}`);
  const chapterData = response.chapter || {};
  const hash = chapterData.hash;
  const files = Array.isArray(chapterData.data) && chapterData.data.length
    ? chapterData.data
    : chapterData.dataSaver || [];

  if (!response.baseUrl || !hash || !files.length) {
    throw new Error("MangaDex did not return any readable pages for this chapter.");
  }

  const pages = files.map((fileName, index) => {
    const url = `${response.baseUrl}/data/${hash}/${encodeURIComponent(fileName)}`;
    return {
      id: `${chapterID(chapter)}-${index}`,
      remoteURL: url,
      remoteUrl: url
    };
  });

  let allChapters = [];
  try {
    allChapters = await chapters(title);
  } catch (error) {
    hostLog(`Unable to fetch MangaDex chapter list for next/previous metadata: ${error.message || error}`);
  }

  const currentIndex = allChapters.findIndex((item) => item.id === chapterID(chapter));
  const nextChapter = currentIndex > 0 ? allChapters[currentIndex - 1] : null;
  const previousChapter = currentIndex >= 0 && currentIndex < allChapters.length - 1
    ? allChapters[currentIndex + 1]
    : null;

  return {
    title,
    chapter,
    pages,
    nextChapter,
    previousChapter,
    prevChapter: previousChapter
  };
}

async function fetchMangaList(options) {
  const params = {
    limit: options.limit || 20,
    offset: options.offset || 0,
    "availableTranslatedLanguage[]": [TRANSLATED_LANGUAGE],
    "contentRating[]": CONTENT_RATINGS,
    "includes[]": ["cover_art", "author", "artist"]
  };

  if (options.title) {
    params.title = options.title;
  }

  for (const key of Object.keys(options.order || {})) {
    params[`order[${key}]`] = options.order[key];
  }

  const response = await apiGet(`/manga?${queryString(params)}`);
  return (response.data || []).map(mapManga).filter(Boolean);
}

async function apiGet(path) {
  const text = await httpGetText(`${API_BASE_URL}${path}`, {
    Accept: "application/json",
    "User-Agent": "Iris/0.1 (MangaDex source)"
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

function mapManga(manga) {
  if (!manga || !manga.id || !manga.attributes) {
    return null;
  }

  const attrs = manga.attributes;
  const cover = relationship(manga, "cover_art");
  const author = relationship(manga, "author");
  const artist = relationship(manga, "artist");
  const coverURL = cover && cover.attributes && cover.attributes.fileName
    ? `${UPLOADS_BASE_URL}/covers/${manga.id}/${cover.attributes.fileName}${COVER_SIZE_SUFFIX}`
    : null;
  const latestChapter = attrs.lastChapter
    ? `Chapter ${attrs.lastChapter}`
    : attrs.latestUploadedChapter
      ? "Latest update"
      : "";

  return {
    id: manga.id,
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: localized(attrs.title) || "Untitled",
    subtitle: [attrs.publicationDemographic, attrs.status].filter(Boolean).map(capitalize).join(" - "),
    sourceName: SOURCE_NAME,
    latestChapter,
    progress: 0,
    coverSymbol: "book.closed",
    coverURL,
    coverUrl: coverURL,
    synopsis: localized(attrs.description) || "",
    status: attrs.status || "",
    type: attrs.originalLanguage ? attrs.originalLanguage.toUpperCase() : "",
    author: author && author.attributes ? author.attributes.name || null : null,
    artist: artist && artist.attributes ? artist.attributes.name || null : null,
    rating: null,
    chapterCount: 0,
    tags: tagNames(attrs.tags)
  };
}

function mapChapter(chapter) {
  if (!chapter || !chapter.id || !chapter.attributes) {
    return null;
  }

  const attrs = chapter.attributes;
  const number = numberValue(attrs.chapter);
  const label = attrs.chapter ? `Chapter ${formatNumber(number)}` : "Oneshot";
  const title = attrs.title ? `${label} - ${attrs.title}` : label;
  const pageCount = attrs.pages || 0;

  return {
    id: chapter.id,
    title,
    number,
    publishedAt: dateString(attrs.readableAt || attrs.publishAt || attrs.createdAt),
    isLocked: Boolean(attrs.externalUrl || pageCount <= 0),
    pageCount
  };
}

function relationship(item, type) {
  return (item.relationships || []).find((entry) => entry.type === type) || null;
}

function localized(values) {
  if (!values) {
    return "";
  }
  if (typeof values === "string") {
    return values;
  }
  return values.en || values["en-us"] || values["ja-ro"] || values.ja || values[Object.keys(values)[0]] || "";
}

function tagNames(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .map((tag) => tag && tag.attributes && localized(tag.attributes.name))
    .filter(Boolean);
}

function titleID(title) {
  if (typeof title === "string" || typeof title === "number") {
    return String(title);
  }
  return String(title.id || title.mangaID || title.mangaId || "");
}

function chapterID(chapter) {
  if (typeof chapter === "string" || typeof chapter === "number") {
    return String(chapter);
  }
  return String(chapter.id || chapter.chapterID || chapter.chapterId || "");
}

function queryString(values) {
  const parts = [];
  for (const key of Object.keys(values)) {
    const value = values[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else if (value !== undefined && value !== null && value !== "") {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join("&");
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function normalizeQuery(value) {
  return String(value || "").trim();
}

function capitalize(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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
