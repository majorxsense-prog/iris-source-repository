# Iris Source Repository

Community source catalog for the Iris reader app.

The app can fetch `repository.json`, show a simplified list of sources, and install a selected source by opening its `installURL` or reading the referenced manifest.

## Catalog URL

```text
https://raw.githubusercontent.com/majorxsense-prog/iris-source-repository/main/repository.json
```

## Sources

- Flame Comics (`flame-comics`) - `https://flamecomics.xyz`
- Asura Scans (`asura-scans`) - `https://asurascans.com`
- MangaDex (`mangadex`) - `https://mangadex.org`
- ToonGod (`toongod`) - `https://www.toongod.org/webtoons/`
- WEBTOON (`webtoon`) - `https://www.webtoons.com/en/`
- Vortex Scans (`vortex-scans`) - `https://vortexscans.org`
- Rolia Scan (`rolia-scan`) - `https://roliascan.com/home/`
- Thunder Scans EN (`thunder-scans`) - `https://en-thunderscans.com/`

## Catalog Flow

1. Iris fetches `repository.json`.
2. Iris displays each source's `name`, `author`, `language`, `contentRating`, and `description`.
3. When the user taps Add, Iris opens `installURL`.
4. Iris fetches the source manifest and installs the source package.

Swift source files are included for native development builds. Runtime-installable community sources should target the JavaScript manifest shape and the app's dynamic source runner.

## Community Sources

To make a source for Iris:

1. Read `SOURCE_CONTRACT.md`.
2. Copy `templates/source-template.js`.
3. Create a `source.json` manifest with `runtime.kind` set to `javascript`.
4. Return the standard DTO shapes for discovery, search, details, chapters, and pages.
5. Submit the package to this repository so Iris users can add it from the catalog.
