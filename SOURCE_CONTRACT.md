# Iris JavaScript Source Standard

This document is the public compatibility contract for community-made Iris sources. It describes what a source package must expose and what data shapes Iris expects. It intentionally does not include Iris app source code.

Use `templates/source-template.js` as a starting point for new sources.

## Package Layout

A source package should live in its own folder:

```text
sources/example-source/
  source.json
  source.js
```

The source manifest must use the JavaScript runtime:

```json
{
  "id": "example-source",
  "slug": "example-source",
  "name": "Example Source",
  "author": "Your Name",
  "description": "Read public titles from example.com.",
  "version": "0.1.0",
  "schemaVersion": 1,
  "language": "en",
  "website": "https://example.com",
  "contentRating": "Teen",
  "repository": "https://github.com/owner/repo",
  "entry": "source.js",
  "runtime": {
    "kind": "javascript",
    "entry": "source.js",
    "minimumIrisVersion": "0.1.0"
  },
  "capabilities": [
    "CHAPTER_PROVIDING",
    "DISCOVER_SECTION_PROVIDING",
    "SEARCH_RESULT_PROVIDING"
  ]
}
```

Optional Cloudflare/web-session fields:

```json
{
  "requiresWebSession": true,
  "cookieDomains": ["example.com", "www.example.com"]
}
```

Optional settings:

```json
{
  "settings": [
    {
      "id": "showAdultTitles",
      "type": "boolean",
      "title": "Show 18+ Titles",
      "defaultValue": false
    }
  ]
}
```

Read settings with `host.getState("showAdultTitles")` or a source-prefixed key such as `host.getState("example-source.showAdultTitles")`.

## Required Exports

Export these functions on `globalThis` and, for local testing, `module.exports`:

- `getManifest()`
- `discoverSections()`
- `discoverItems(sectionID, limit, page)`
- `latestTitles(limit)`
- `search(request)`
- `details(title)`
- `chapters(title)`
- `chapterDetails(title, chapter)`

Functions may be synchronous or `async`. `page` is zero-based. `limit` is the number of titles Iris wants for that request.

## Host API

Iris exposes this JavaScript host object:

- `host.httpGet(url, headers)` returns a promise resolving to `{ status, body, url }`.
- `host.log(message)` writes a source-scoped debug log.
- `host.getState(key)` returns a persisted string value or `null`.
- `host.setState(key, value)` persists a string value.

Use absolute request URLs for `host.httpGet`. For image/page URLs returned to Iris, use absolute `http` or `https` URLs.

## Discovery Sections

`discoverSections()` returns:

```json
[
  { "id": "latest_updates", "title": "Latest Updates", "kind": "chapterUpdates" },
  { "id": "popular", "title": "Popular", "kind": "simpleCarousel" },
  { "id": "genres", "title": "Genres", "kind": "genres" }
]
```

Recognized `kind` values include:

- `chapterUpdates`
- `latestUpdates`
- `chapter_updates`
- `featured`
- `genres`
- `simpleCarousel`

Unknown kinds are displayed as simple carousels.

## SourceTitleDTO

Return this shape from `latestTitles`, `discoverItems`, `search`, and `details`:

```json
{
  "id": "stable-series-id",
  "title": "Series Title",
  "subtitle": "Manhwa - Ongoing",
  "sourceName": "Example Source",
  "latestChapter": "Chapter 12",
  "coverURL": "https://example.com/covers/series-title.webp",
  "synopsis": "Description text.",
  "status": "Ongoing",
  "type": "Manhwa",
  "author": "Author Name",
  "artist": "Artist Name",
  "rating": 4.5,
  "chapterCount": 12,
  "tags": ["Action", "Fantasy"]
}
```

Required:

- `id`
- `title`

Accepted aliases:

- Description: `synopsis` or `description`
- Chapter count: `chapterCount` or `chapters`
- Cover: `coverURL`, `coverUrl`, `cover_url`, `cover`, `thumbnail`, `thumbnailURL`, `thumbnailUrl`, `image`, `imageURL`, `imageUrl`, or `poster`

Preferred source output should still use `coverURL`, `synopsis`, and `chapterCount`.

Cover rules:

- Return the actual title cover, not the website logo.
- Do not return OpenGraph share cards unless they are the only actual cover available.
- Do not return placeholders, avatars, banners, headers, ads, or unrelated title thumbnails.
- Avoid returning the same cover URL for multiple different titles in one result batch; Iris may drop duplicated covers.
- Relative cover URLs are resolved against the source manifest website, but absolute URLs are safest.

`chapterCount` should be numeric. If a site only exposes the latest chapter label, using that number as a best-effort count is acceptable. If unknown, return `0` or omit the field.

## ChapterSummaryDTO

`chapters(title)` returns:

```json
{
  "id": "stable-chapter-id-or-absolute-url",
  "title": "Chapter 12",
  "number": 12,
  "publishedAt": "2026-05-28T00:00:00.000Z",
  "isLocked": false,
  "pageCount": 0
}
```

Rules:

- `id` and `title` are required.
- `number` should be numeric.
- `publishedAt` should be a real ISO8601 date when known.
- Omit `publishedAt` or return `null` when unknown.
- Do not return fake epoch dates such as 1969, 1970, or year 1.
- Set `isLocked` to `true` for paid, unavailable, external, or blocked chapters.

## ReaderPageDTO

`chapterDetails(title, chapter).pages` returns:

```json
{
  "id": "chapter-id-0",
  "remoteURL": "https://example.com/pages/001.jpg"
}
```

Accepted URL fields:

- `remoteURL`
- `remoteUrl`
- `url`

Page URLs must be absolute. Return only readable page images. Filter out logos, arrows, recommendation thumbnails, avatars, ad images, tracking pixels, placeholders, and reader UI assets.

## ChapterDetailsDTO

`chapterDetails(title, chapter)` returns:

```json
{
  "title": { "id": "stable-series-id", "title": "Series Title" },
  "chapter": { "id": "chapter-id", "title": "Chapter 12", "number": 12 },
  "pages": [
    { "id": "chapter-id-0", "remoteURL": "https://example.com/pages/001.jpg" }
  ],
  "nextChapter": null,
  "previousChapter": null
}
```

Rules:

- `chapter` is required.
- `pages` must contain at least one readable page for readable chapters.
- `nextChapter` should point to the next chapter in reading order.
- `previousChapter` should point to the previous chapter in reading order.
- Throw a normal `Error("Readable message")` when a chapter cannot be read.

## Compatibility Checklist

Before submitting a source:

- `source.js` has no syntax errors.
- `source.json` is valid JSON and uses `runtime.kind = "javascript"`.
- Manifest `id`, repository `id`, and source `SOURCE_ID` match exactly.
- All functions are exported on `globalThis`.
- `discoverItems(sectionID, limit, page)` honors `limit` and `page` when the site supports pagination.
- Titles have stable IDs.
- Covers are actual covers and are not duplicated placeholders.
- Search returns the same `SourceTitleDTO` shape as discovery.
- Details preserves or improves `coverURL`, `chapterCount`, `synopsis`, `status`, `author`, `artist`, and `tags`.
- Chapters use real dates or `null`.
- Reader pages are only page images.
- Locked/unavailable chapters fail clearly instead of showing blank pages.
