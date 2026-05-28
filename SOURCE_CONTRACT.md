# Iris JavaScript Source Contract

Community sources should export these functions on `globalThis` or `module.exports`:

- `getManifest()`
- `discoverSections()`
- `discoverItems(sectionID, limit, page)`
- `latestTitles(limit)`
- `search(request)`
- `details(title)`
- `chapters(title)`
- `chapterDetails(title, chapter)`

`discoverItems`, `latestTitles`, `search`, and `details` should return `SourceTitleDTO` objects:

```json
{
  "id": "series-slug-or-stable-id",
  "title": "Series title",
  "subtitle": "Optional short metadata",
  "sourceName": "Source name",
  "latestChapter": "Chapter 12",
  "coverURL": "https://example.com/actual-cover.webp",
  "synopsis": "Description text",
  "status": "Ongoing",
  "type": "Manhwa",
  "author": "Author name",
  "artist": "Artist name",
  "rating": 4.5,
  "chapterCount": 12,
  "tags": ["Action", "Fantasy"]
}
```

Cover fields may also be provided as `coverUrl`, `cover_url`, `cover`, `thumbnail`, `thumbnailURL`, `thumbnailUrl`, `image`, `imageURL`, `imageUrl`, or `poster`, but `coverURL` is preferred. The URL must be the actual title cover. Do not return site logos, OpenGraph share cards, placeholder images, ads, avatars, thumbnails for unrelated titles, or the first random image on the page.

`chapterCount` should be a number when the site exposes it. If the site only exposes the latest chapter label, return the numeric latest chapter as a best effort. If neither is known, return `0` or omit it.

`chapters(title)` should return `ChapterSummaryDTO` objects:

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

Only set `publishedAt` when a real date is available. Avoid fake epoch dates such as 1969, 1970, or year 1.

`chapterDetails(title, chapter)` should return:

```json
{
  "title": { "id": "series-id", "title": "Series title" },
  "chapter": { "id": "chapter-id", "title": "Chapter 12" },
  "pages": [
    { "id": "chapter-id-0", "remoteURL": "https://example.com/page-001.jpg" }
  ],
  "nextChapter": null,
  "previousChapter": null
}
```

Reader pages must be page images only. Filter out logos, arrows, recommendation thumbnails, avatars, ad images, tracking pixels, placeholders, and reader UI assets.
