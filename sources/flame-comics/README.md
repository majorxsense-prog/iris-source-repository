# Flame Comics

Swift source plugin for `https://flamecomics.xyz`.

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

## Native App Registration

Add `FlameComicsSourcePlugin.swift` to the app target and register:

```swift
FlameComicsSourcePlugin()
```
