# Flame Comics

JavaScript source plugin for `https://flamecomics.xyz`.

Author: Community

## Capabilities

- Latest titles
- Browse/search catalog
- Series details
- Chapter list
- Chapter page image rendering
- Seamless next-chapter metadata

## Data Used

The source reads Flame Comics' public Next.js page data:

- `/` for latest entries
- `/browse` for searchable catalog entries
- `/series/{seriesID}` for details and chapters
- `/series/{seriesID}/{chapterToken}` for page images

## Install URL

```text
iris://source/add?repository=https%3A%2F%2Fraw.githubusercontent.com%2Fmajorxsense-prog%2Firis-source-repository%2Fmain%2Frepository.json&source=flame-comics
```

## Runtime

This source uses the Iris JavaScript runtime and `source.js`; it does not require a native app rebuild once JavaScript sources are supported.

`FlameComicsSourcePlugin.swift` is kept only as a native reference implementation.
