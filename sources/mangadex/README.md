# MangaDex

JavaScript source plugin for `https://mangadex.org`.

Author: majorxsense-prog

## Capabilities

- Latest translated updates
- Popular manga discovery
- Recently added manga discovery
- Manga search
- Manga details
- English chapter list
- MangaDex@Home page image rendering

## Data Used

The source reads MangaDex's public API:

- `/manga` for discovery and search
- `/manga/{id}` for details
- `/manga/{id}/feed` for chapter lists
- `/at-home/server/{chapterId}` for page image metadata

## Install URL

```text
iris://source/add?repository=https%3A%2F%2Fraw.githubusercontent.com%2Fmajorxsense-prog%2Firis-source-repository%2Fmain%2Frepository.json&source=mangadex
```

## Runtime

This source uses the Iris JavaScript runtime and `source.js`.
