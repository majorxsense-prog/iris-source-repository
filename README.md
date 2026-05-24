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

## Catalog Flow

1. Iris fetches `repository.json`.
2. Iris displays each source's `name`, `author`, `language`, `contentRating`, and `description`.
3. When the user taps Add, Iris opens `installURL`.
4. Iris fetches the source manifest and installs the source package.

Swift source files are included for native development builds. Runtime-installable community sources should target the same manifest shape and the app's dynamic source runner.
