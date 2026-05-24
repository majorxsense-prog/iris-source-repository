# Asura Scans

JavaScript source plugin for `https://asurascans.com`.

Author: majorxsense-prog

## Capabilities

- Latest titles
- Trending Today discovery
- Popular discovery
- Browse/search catalog
- Series details
- Chapter list
- Chapter page image rendering
- Seamless next-chapter metadata

## Data Used

The source reads Asura's current public JSON API:

- `/api/series` for latest and search results
- `/api/series/{slug}` for details
- `/api/series/{slug}/chapters` for chapter lists
- `/api/series/{slug}/chapters/{number}` for page images

## Install URL

```text
iris://source/add?repository=https%3A%2F%2Fraw.githubusercontent.com%2Fmajorxsense-prog%2Firis-source-repository%2Fmain%2Frepository.json&source=asura-scans
```

## Runtime

This source uses the Iris JavaScript runtime and `source.js`. It is an Iris-owned implementation.
