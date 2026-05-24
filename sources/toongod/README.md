# ToonGod

JavaScript source plugin for `https://www.toongod.org/webtoons/`.

Author: majorxsense-prog

## Capabilities

- Webtoon discovery
- Search
- Title details
- Chapter list
- Chapter page image rendering

## Important

ToonGod currently returns a Cloudflare managed challenge to direct app requests. This source is ready for Iris' JavaScript runtime, but it requires Iris to support source-scoped WebView verification/cookies before it can work reliably on device.

## Install URL

```text
iris://source/add?repository=https%3A%2F%2Fraw.githubusercontent.com%2Fmajorxsense-prog%2Firis-source-repository%2Fmain%2Frepository.json&source=toongod
```

## Runtime

This source uses the Iris JavaScript runtime and `source.js`.
