const SOURCE_ID = "webtoon";
const SOURCE_NAME = "WEBTOON";
const SOURCE_AUTHOR = "majorxsense-prog";
const SITE_BASE_URL = "https://www.webtoons.com";
const EN_BASE_URL = `${SITE_BASE_URL}/en`;

function getManifest() {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    author: SOURCE_AUTHOR,
    version: "0.1.1",
    language: "en",
    contentRating: "Teen",
    website: `${EN_BASE_URL}/`,
    capabilities: [
      "CHAPTER_PROVIDING",
      "DISCOVER_SECTION_PROVIDING",
      "SEARCH_RESULT_PROVIDING"
    ]
  };
}

async function latestTitles(limit) {
  return discoverItems("originals", limit || 20, 0);
}

async function discoverSections() {
  return [
    { id: "originals", title: "Originals", kind: "featured" },
    { id: "rankings", title: "Rankings", kind: "simpleCarousel" },
    { id: "canvas", title: "Canvas", kind: "simpleCarousel" },
    { id: "genres", title: "Genres", kind: "genres" }
  ];
}

async function discoverItems(sectionID, limit, page) {
  const size = Number(limit) || 20;
  const pageNumber = (Number(page) || 0) + 1;

  switch (sectionID) {
  case "rankings":
  case "popular":
    return parseTitleList(await htmlGet(`/en/ranking?page=${pageNumber}`), size);
  case "canvas":
    return parseTitleList(await htmlGet(`/en/canvas?page=${pageNumber}`), size);
  case "genres":
    return [];
  case "originals":
  default:
    return parseTitleList(await htmlGet(pageNumber > 1 ? `/en/originals?page=${pageNumber}` : "/en/originals"), size);
  }
}

async function search(request) {
  const query = normalizeQuery(request && (request.title || request.query || request.text || request));
  const page = Number(request && request.page) || 0;
  if (!query) {
    return latestTitles(20);
  }

  const html = await htmlGet(`/en/search?keyword=${encodeURIComponent(query)}&searchType=WEBTOON&page=${page + 1}`);
  return parseTitleList(html, 30);
}

async function details(title) {
  const html = await htmlGet(titleURL(title));
  const base = titleFromObject(title);
  const titleName = firstClean([
    meta(html, "og:title"),
    firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    firstMatch(html, /<h2[^>]*class=["'][^"']*subj[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i),
    base.title
  ]);

  return titleDTO({
    id: titleID(title),
    title: titleName,
    url: titleURL(title),
    coverURL: firstClean([meta(html, "og:image"), firstImage(html)]),
    synopsis: decodeHTML(meta(html, "og:description")),
    author: decodeHTML(meta(html, "com-linewebtoon:webtoon:author")),
    type: genreFromURL(titleURL(title)),
    latestChapter: base.latestChapter || "",
    tags: parseTags(html)
  });
}

async function chapters(title) {
  const firstURL = titleURL(title);
  const titleNo = webtoonTitleNo(title) || queryValue(firstURL, "title_no");
  const all = [];
  const seen = {};
  let page = 1;
  let stagnant = 0;

  while (page <= 20 && stagnant < 2 && all.length < 500) {
    const url = addOrReplaceQuery(firstURL, "page", page);
    const html = await htmlGet(url);
    const items = parseEpisodeList(html, titleNo);
    const before = all.length;
    for (const item of items) {
      if (!item || !item.id || seen[item.id]) {
        continue;
      }
      seen[item.id] = true;
      all.push(item);
    }
    stagnant = all.length === before ? stagnant + 1 : 0;
    if (!items.length) {
      break;
    }
    page += 1;
  }

  return all;
}

async function chapterDetails(title, chapter) {
  const url = chapterURL(chapter);
  const html = await htmlGet(url);
  const imageURLs = parseImageList(html);
  if (!imageURLs.length) {
    throw new Error("WEBTOON did not expose readable images for this episode. It may be locked, app-only, or unavailable in the public web viewer.");
  }

  const pages = imageURLs.map((remoteURL, index) => ({
    id: `${chapterID(chapter)}-${index}`,
    remoteURL,
    remoteUrl: remoteURL
  }));

  let allChapters = [];
  try {
    allChapters = await chapters(title);
  } catch (error) {
    hostLog(`Unable to fetch WEBTOON episode list for next/previous metadata: ${error.message || error}`);
  }

  const currentID = chapterID(chapter);
  const currentIndex = allChapters.findIndex((item) => item.id === currentID || chapterURL(item) === url);
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
  const anchorPattern = /<a\b[^>]*href=["']([^"']*\/en\/[^"']+\/list\?title_no=\d+[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null && items.length < (limit || 20)) {
    const block = match[0];
    const url = absoluteURL(match[1]);
    const id = queryValue(url, "title_no") || url;
    if (!id || seen[id]) {
      continue;
    }
    seen[id] = true;
    const title = firstClean([
      firstMatch(block, /<strong[^>]+class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i),
      attr(block, "title"),
      urlSlug(url)
    ]);
    const author = htmlText(firstMatch(block, /<div[^>]+class=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/div>/i));
    const latestChapter = firstClean([
      htmlText(firstMatch(block, /<span[^>]+class=["'][^"']*(?:subj|episode)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)),
      htmlText(firstMatch(block, /<span[^>]+class=["'][^"']*badge_up[^"']*["'][^>]*>([\s\S]*?)<\/span>/i))
    ]);

    items.push(titleDTO({
      id,
      url,
      title,
      coverURL: firstImage(block),
      author,
      type: genreFromURL(url),
      latestChapter,
      tags: []
    }));
  }

  return items;
}

function parseEpisodeList(html, titleNo) {
  const items = [];
  const seen = {};
  const episodePattern = /<li\b[^>]*class=["'][^"']*_episodeItem[^"']*["'][^>]*>[\s\S]*?<\/li>/gi;
  let match;

  while ((match = episodePattern.exec(html)) !== null) {
    const block = match[0];
    const href = firstMatch(block, /<a\b[^>]*href=["']([^"']*\/viewer\?[^"']+)["'][^>]*>/i);
    if (!href) {
      continue;
    }
    const url = absoluteURL(href);
    const episodeNo = queryValue(url, "episode_no") || firstMatch(block, /data-episode-no=["'](\d+)["']/i);
    const id = episodeNo ? `${titleNo || queryValue(url, "title_no")}-${episodeNo}` : url;
    if (seen[id]) {
      continue;
    }
    seen[id] = true;
    const number = numberValue(episodeNo);
    items.push({
      id,
      url,
      title: htmlText(firstMatch(block, /<span[^>]+class=["'][^"']*subj[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)) || `Episode ${formatNumber(number)}`,
      number,
      publishedAt: parseDateText(firstMatch(block, /<span[^>]+class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)),
      isLocked: false,
      pageCount: 0
    });
  }

  return items;
}

function parseImageList(html) {
  const images = [];
  const seen = {};
  const imageListBlock = firstMatch(html, /var\s+imageList\s*=\s*\[([\s\S]*?)\]\s*;/i);
  const source = imageListBlock || html;
  const urlPattern = /url\s*:\s*["']([^"']+)["']/gi;
  let match;

  while ((match = urlPattern.exec(source)) !== null) {
    const url = normalizeImageURL(match[1]);
    if (isReaderImage(url) && !seen[url]) {
      seen[url] = true;
      images.push(url);
    }
  }

  if (!images.length) {
    const tagPattern = /<img\b[^>]*>/gi;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(html)) !== null) {
      const className = attr(tagMatch[0], "class");
      if (!/(^|\s)_images(\s|$)/.test(className)) {
        continue;
      }
      const url = normalizeImageURL(attr(tagMatch[0], "data-url") || attr(tagMatch[0], "data-src") || attr(tagMatch[0], "src"));
      if (isReaderImage(url) && !seen[url]) {
        seen[url] = true;
        images.push(url);
      }
    }
  }

  return images;
}

async function htmlGet(pathOrURL) {
  return httpGetText(absoluteURL(pathOrURL), {
    Accept: "text/html,application/xhtml+xml,application/xml",
    Referer: `${EN_BASE_URL}/`,
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Iris/0.1"
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
    url: input.url || null,
    sourceID: SOURCE_ID,
    sourceId: SOURCE_ID,
    title: input.title || "Untitled",
    subtitle: [input.type, input.author].filter(Boolean).join(" - "),
    sourceName: SOURCE_NAME,
    latestChapter: input.latestChapter || "",
    progress: 0,
    coverSymbol: "book.closed",
    coverURL: input.coverURL || null,
    coverUrl: input.coverURL || null,
    synopsis: input.synopsis || "",
    status: input.status || "",
    type: input.type || "",
    author: input.author || null,
    artist: null,
    rating: null,
    chapterCount: 0,
    tags: input.tags || []
  };
}

function parseTags(html) {
  const metaKeywords = firstMatch(html, /<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  return metaKeywords ? metaKeywords.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12) : [];
}

function titleFromObject(title) {
  if (!title || typeof title === "string" || typeof title === "number") {
    return { id: String(title || ""), title: "", url: "" };
  }
  return title;
}

function titleID(title) {
  if (typeof title === "string" || typeof title === "number") {
    return String(title);
  }
  return String(title.id || queryValue(title.url || title.remoteURL || title.remoteUrl || "", "title_no") || "");
}

function webtoonTitleNo(title) {
  const id = titleID(title);
  return /^\d+$/.test(id) ? id : "";
}

function titleURL(title) {
  if (typeof title === "object" && title) {
    const url = title.url || title.remoteURL || title.remoteUrl;
    if (url) {
      return absoluteURL(url);
    }
  }
  const id = webtoonTitleNo(title);
  if (!id) {
    return absoluteURL(String(title || ""));
  }
  return `${EN_BASE_URL}/challenge/series/list?title_no=${encodeURIComponent(id)}`;
}

function chapterID(chapter) {
  if (typeof chapter === "string" || typeof chapter === "number") {
    return String(chapter);
  }
  return String(chapter.id || chapter.url || chapter.remoteURL || chapter.remoteUrl || "");
}

function chapterURL(chapter) {
  if (typeof chapter === "object" && chapter && (chapter.url || chapter.remoteURL || chapter.remoteUrl)) {
    return absoluteURL(chapter.url || chapter.remoteURL || chapter.remoteUrl);
  }
  return absoluteURL(String(chapter || ""));
}

function addOrReplaceQuery(url, key, value) {
  const base = absoluteURL(url);
  const encoded = `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
  if (new RegExp(`([?&])${key}=`).test(base)) {
    return base.replace(new RegExp(`([?&])${key}=[^&]*`), `$1${encoded}`);
  }
  return `${base}${base.includes("?") ? "&" : "?"}${encoded}`;
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

function queryValue(url, key) {
  const pattern = new RegExp(`[?&]${key}=([^&#]+)`, "i");
  const match = String(url || "").match(pattern);
  return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
}

function genreFromURL(url) {
  const match = String(url || "").match(/\/en\/([^\/?#]+)\//i);
  return match ? capitalize(match[1].replace(/-/g, " ")) : "";
}

function urlSlug(url) {
  const match = String(url || "").match(/\/([^\/?#]+)\/list\?/i);
  return match ? capitalize(match[1].replace(/-/g, " ")) : "";
}

function firstImage(html) {
  const tag = firstMatch(html, /<img\b[^>]*>/i);
  return normalizeImageURL(attr(tag, "data-src") || attr(tag, "src"));
}

function normalizeImageURL(value) {
  const url = decodeHTML(String(value || "").trim().replace(/\\\//g, "/"));
  return url ? absoluteURL(url) : "";
}

function isReaderImage(url) {
  const lower = String(url || "").toLowerCase();
  return /^https?:\/\//.test(lower)
    && /\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/i.test(lower)
    && !lower.includes("thumb_")
    && !lower.includes("thumbnail")
    && !lower.includes("bg_transparency")
    && !lower.includes("favicon")
    && !lower.includes("logo");
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

function parseDateText(value) {
  const text = htmlText(value);
  if (!text) {
    return null;
  }
  const time = Date.parse(text);
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
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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
