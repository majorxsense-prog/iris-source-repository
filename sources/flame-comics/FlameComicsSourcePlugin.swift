import Foundation

enum FlameComicsSourceError: LocalizedError {
    case invalidPageData
    case missingPages

    var errorDescription: String? {
        switch self {
        case .invalidPageData:
            return "Flame Comics returned page data the source could not read."
        case .missingPages:
            return "Flame Comics did not return any readable pages for this chapter."
        }
    }
}

extension ExtensionManifest {
    static let flameComics = ExtensionManifest(
        slug: "flame-comics",
        name: "Flame Comics",
        description: "Community source for flamecomics.xyz.",
        version: "0.1.0",
        iconName: "flame",
        language: "en",
        contentRating: "Everyone",
        capabilities: [
            .chapterProviding,
            .discoverSectionProviding,
            .searchResultProviding
        ],
        developers: [
            ExtensionDeveloper(name: "Community", github: nil)
        ],
        repositoryURL: URL(string: "https://flamecomics.xyz")
    )
}

struct FlameComicsSourcePlugin: ReaderSourcePlugin {
    let manifest: ExtensionManifest = .flameComics

    func makeRuntime() -> ReaderSourceRuntime {
        FlameComicsSourceClient()
    }
}

final class FlameComicsSourceClient: ReaderSourceRuntime {
    let manifest: ExtensionManifest = .flameComics

    private let siteBaseURL = URL(string: "https://flamecomics.xyz")!
    private let cdnBaseURL = URL(string: "https://cdn.flamecomics.xyz/uploads/images/series")!
    private let sourceName = "Flame Comics"

    func initialize() async throws {}

    func latestTitles(limit: Int) async throws -> [ReaderTitle] {
        let page: FlameHomePageProps = try await nextPageProps(path: "/")
        let entries = page.latestEntries?.blocks.first?.series ?? []
        return Array(entries.compactMap(mapListSeries).prefix(limit))
    }

    func discoverSections() async throws -> [ReaderDiscoverSection] {
        [
            ReaderDiscoverSection(id: "latest", title: "Latest", kind: .chapterUpdates),
            ReaderDiscoverSection(id: "popular", title: "Popular", kind: .simpleCarousel),
            ReaderDiscoverSection(id: "genres", title: "Genres", kind: .genres)
        ]
    }

    func details(for title: ReaderTitle) async throws -> ReaderTitle {
        let page: FlameSeriesPageProps = try await nextPageProps(path: "/series/\(title.id)")
        return mapSeriesDetail(page.series, chapterCount: page.chapters.count)
    }

    func search(_ request: ReaderSearchRequest) async throws -> [ReaderTitle] {
        let page: FlameBrowsePageProps = try await nextPageProps(path: "/browse")
        let query = request.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let mapped = page.series.compactMap(mapListSeries)

        guard !query.isEmpty else {
            return mapped
        }

        return mapped.filter { title in
            title.title.localizedCaseInsensitiveContains(query)
                || title.synopsis.localizedCaseInsensitiveContains(query)
                || title.tags.contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }

    func chapters(for title: ReaderTitle) async throws -> [ChapterSummary] {
        let page: FlameSeriesPageProps = try await nextPageProps(path: "/series/\(title.id)")
        return page.chapters.map(mapChapter)
    }

    func chapterDetails(for title: ReaderTitle, chapter: ChapterSummary) async throws -> ChapterDetails {
        let page: FlameChapterPageProps = try await nextPageProps(path: "/series/\(title.id)/\(chapter.id)")
        let currentChapter = mapChapter(page.chapter)
        let pages = page.chapter.sortedImages.enumerated().compactMap { offset, image -> ReaderPage? in
            guard let url = pageImageURL(seriesID: title.id, token: page.chapter.token, imageName: image.name) else {
                return nil
            }
            return ReaderPage(id: "\(currentChapter.id)-\(offset)", remoteURL: url)
        }

        guard !pages.isEmpty else {
            throw FlameComicsSourceError.missingPages
        }

        let allChapters = try? await chapters(for: title)
        let nextChapter = page.next.flatMap { token in allChapters?.first { $0.id == token } }
        let previousChapter = page.previous.flatMap { token in allChapters?.first { $0.id == token } }

        return ChapterDetails(
            title: title,
            chapter: currentChapter,
            pages: pages,
            nextChapter: nextChapter,
            previousChapter: previousChapter
        )
    }

    private func nextPageProps<Props: Decodable>(path: String) async throws -> Props {
        let html = try await htmlString(path: path)
        let marker = #"<script id="__NEXT_DATA__" type="application/json">"#
        guard let start = html.range(of: marker)?.upperBound,
              let end = html[start...].range(of: "</script>")?.lowerBound else {
            throw FlameComicsSourceError.invalidPageData
        }

        let jsonString = String(html[start..<end])
        guard let data = jsonString.data(using: .utf8) else {
            throw FlameComicsSourceError.invalidPageData
        }

        let envelope = try JSONDecoder().decode(FlameNextData<Props>.self, from: data)
        return envelope.props.pageProps
    }

    private func htmlString(path: String) async throws -> String {
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        guard let url = URL(string: normalizedPath, relativeTo: siteBaseURL)?.absoluteURL else {
            throw FlameComicsSourceError.invalidPageData
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        request.setValue("GlassReader/0.1", forHTTPHeaderField: "User-Agent")

        let (data, response) = try await URLSession.shared.data(for: request)
        if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
            throw URLError(.badServerResponse)
        }

        return String(decoding: data, as: UTF8.self)
    }

    private func mapListSeries(_ series: FlameSeriesListItem) -> ReaderTitle? {
        guard let seriesID = series.seriesID else { return nil }
        let tags = series.tagValues
        let latest = series.chapters?.first.map { "Chapter \(Self.formatNumber($0.chapterNumber))" }
            ?? series.chapterCount.map { "\($0) chapters" }
            ?? "Latest update"

        return ReaderTitle(
            id: "\(seriesID)",
            sourceID: manifest.id,
            title: series.title,
            subtitle: [series.type, series.status].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " - "),
            sourceName: sourceName,
            latestChapter: latest,
            progress: 0,
            coverSymbol: "flame",
            coverURL: coverURL(seriesID: "\(seriesID)", cover: series.cover, lastEdit: series.lastEdit),
            synopsis: Self.stripHTML(series.description ?? ""),
            status: series.status ?? "",
            type: series.type ?? "",
            author: series.author.values.joined(separator: ", ").nilIfEmpty,
            artist: series.artist.values.joined(separator: ", ").nilIfEmpty,
            rating: nil,
            chapterCount: series.chapterCount ?? 0,
            tags: tags
        )
    }

    private func mapSeriesDetail(_ series: FlameSeriesDetail, chapterCount: Int) -> ReaderTitle {
        ReaderTitle(
            id: "\(series.seriesID)",
            sourceID: manifest.id,
            title: series.title,
            subtitle: [series.type, series.status].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " - "),
            sourceName: sourceName,
            latestChapter: "\(chapterCount) chapters",
            progress: 0,
            coverSymbol: "flame",
            coverURL: coverURL(seriesID: "\(series.seriesID)", cover: series.cover, lastEdit: series.lastEdit),
            synopsis: Self.stripHTML(series.description ?? ""),
            status: series.status ?? "",
            type: series.type ?? "",
            author: series.author.values.joined(separator: ", ").nilIfEmpty,
            artist: series.artist.values.joined(separator: ", ").nilIfEmpty,
            rating: nil,
            chapterCount: chapterCount,
            tags: series.tags.values
        )
    }

    private func mapChapter(_ chapter: FlameChapterListItem) -> ChapterSummary {
        ChapterSummary(
            id: chapter.token,
            title: Self.chapterTitle(number: chapter.chapterNumber, title: chapter.title),
            number: chapter.chapterNumber,
            publishedAt: Date(timeIntervalSince1970: TimeInterval(chapter.releaseDate ?? 0)),
            isLocked: false,
            pageCount: 0
        )
    }

    private func mapChapter(_ chapter: FlameChapterPage) -> ChapterSummary {
        ChapterSummary(
            id: chapter.token,
            title: Self.chapterTitle(number: chapter.chapterNumber, title: chapter.chapterTitle),
            number: chapter.chapterNumber,
            publishedAt: Date(timeIntervalSince1970: TimeInterval(chapter.releaseDate ?? 0)),
            isLocked: false,
            pageCount: chapter.images.count
        )
    }

    private func coverURL(seriesID: String, cover: String?, lastEdit: Int?) -> URL? {
        guard let cover else { return nil }
        var url = cdnBaseURL
            .appendingPathComponent(seriesID)
            .appendingPathComponent(cover)

        if let lastEdit {
            url = URL(string: "\(url.absoluteString)?\(lastEdit)") ?? url
        }
        return url
    }

    private func pageImageURL(seriesID: String, token: String, imageName: String) -> URL? {
        cdnBaseURL
            .appendingPathComponent(seriesID)
            .appendingPathComponent(token)
            .appendingPathComponent(imageName)
    }

    private static func chapterTitle(number: Double, title: String?) -> String {
        let prefix = "Chapter \(formatNumber(number))"
        guard let title, !title.isEmpty else { return prefix }
        return "\(prefix) - \(title)"
    }

    private static func formatNumber(_ number: Double) -> String {
        if number.rounded() == number {
            return String(Int(number))
        }
        return String(format: "%.1f", number)
    }

    private static func stripHTML(_ html: String) -> String {
        guard let expression = try? NSRegularExpression(pattern: "<[^>]+>") else {
            return html
        }
        let range = NSRange(html.startIndex..., in: html)
        return expression
            .stringByReplacingMatches(in: html, range: range, withTemplate: "")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#x27;", with: "'")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct FlameNextData<PageProps: Decodable>: Decodable {
    let props: FlameNextDataProps<PageProps>
}

private struct FlameNextDataProps<PageProps: Decodable>: Decodable {
    let pageProps: PageProps
}

private struct FlameHomePageProps: Decodable {
    let latestEntries: FlameEntryBlocks?
}

private struct FlameBrowsePageProps: Decodable {
    let series: [FlameSeriesListItem]
}

private struct FlameSeriesPageProps: Decodable {
    let series: FlameSeriesDetail
    let chapters: [FlameChapterListItem]
}

private struct FlameChapterPageProps: Decodable {
    let chapter: FlameChapterPage
    let next: String?
    let previous: String?
}

private struct FlameEntryBlocks: Decodable {
    let blocks: [FlameEntryBlock]
}

private struct FlameEntryBlock: Decodable {
    let series: [FlameSeriesListItem]
}

private struct FlameSeriesListItem: Decodable {
    let seriesID: Int?
    let title: String
    let description: String?
    let type: String?
    let status: String?
    let cover: String?
    let lastEdit: Int?
    let author: FlexibleStringArray
    let artist: FlexibleStringArray
    let tags: FlexibleStringArray
    let categories: FlexibleStringArray
    let chapters: [FlameChapterListItem]?
    let chapterCount: Int?

    var tagValues: [String] {
        let values = categories.values.isEmpty ? tags.values : categories.values
        if values.count == 1 {
            return values[0]
                .split(separator: " ")
                .map(String.init)
                .filter { !$0.isEmpty }
        }
        return values
    }

    enum CodingKeys: String, CodingKey {
        case seriesID = "series_id"
        case title
        case description
        case type
        case status
        case cover
        case lastEdit = "last_edit"
        case author
        case artist
        case tags
        case categories
        case chapters
        case chapterCount = "chapter_count"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        seriesID = try container.decodeIfPresent(Int.self, forKey: .seriesID)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        type = try container.decodeIfPresent(String.self, forKey: .type)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        cover = try container.decodeIfPresent(String.self, forKey: .cover)
        lastEdit = try container.decodeIfPresent(Int.self, forKey: .lastEdit)
        author = (try? container.decode(FlexibleStringArray.self, forKey: .author)) ?? .empty
        artist = (try? container.decode(FlexibleStringArray.self, forKey: .artist)) ?? .empty
        tags = (try? container.decode(FlexibleStringArray.self, forKey: .tags)) ?? .empty
        categories = (try? container.decode(FlexibleStringArray.self, forKey: .categories)) ?? .empty
        chapters = try? container.decode([FlameChapterListItem].self, forKey: .chapters)
        chapterCount = try container.decodeIfPresent(Int.self, forKey: .chapterCount)
    }
}

private struct FlameSeriesDetail: Decodable {
    let seriesID: Int
    let title: String
    let description: String?
    let type: String?
    let status: String?
    let cover: String?
    let lastEdit: Int?
    let author: FlexibleStringArray
    let artist: FlexibleStringArray
    let tags: FlexibleStringArray

    enum CodingKeys: String, CodingKey {
        case seriesID = "series_id"
        case title
        case description
        case type
        case status
        case cover
        case lastEdit = "last_edit"
        case author
        case artist
        case tags
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        seriesID = try container.decode(Int.self, forKey: .seriesID)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        type = try container.decodeIfPresent(String.self, forKey: .type)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        cover = try container.decodeIfPresent(String.self, forKey: .cover)
        lastEdit = try container.decodeIfPresent(Int.self, forKey: .lastEdit)
        author = (try? container.decode(FlexibleStringArray.self, forKey: .author)) ?? .empty
        artist = (try? container.decode(FlexibleStringArray.self, forKey: .artist)) ?? .empty
        tags = (try? container.decode(FlexibleStringArray.self, forKey: .tags)) ?? .empty
    }
}

private struct FlameChapterListItem: Decodable {
    let chapterID: Int?
    let seriesID: Int?
    let chapter: String
    let title: String?
    let token: String
    let releaseDate: Int?

    var chapterNumber: Double {
        Double(chapter) ?? 0
    }

    enum CodingKeys: String, CodingKey {
        case chapterID = "chapter_id"
        case seriesID = "series_id"
        case chapter
        case title
        case token
        case releaseDate = "release_date"
    }
}

private struct FlameChapterPage: Decodable {
    let seriesID: Int
    let chapterID: Int?
    let chapter: String
    let chapterTitle: String?
    let images: [String: FlameChapterImage]
    let token: String
    let releaseDate: Int?

    var chapterNumber: Double {
        Double(chapter) ?? 0
    }

    var sortedImages: [FlameChapterImage] {
        images
            .sorted { (left, right) in
                (Int(left.key) ?? 0) < (Int(right.key) ?? 0)
            }
            .map(\.value)
    }

    enum CodingKeys: String, CodingKey {
        case seriesID = "series_id"
        case chapterID = "chapter_id"
        case chapter
        case chapterTitle = "chapter_title"
        case images
        case token
        case releaseDate = "release_date"
    }
}

private struct FlameChapterImage: Decodable {
    let name: String
}

private struct FlexibleStringArray: Decodable {
    static let empty = FlexibleStringArray(values: [])

    let values: [String]

    init(values: [String]) {
        self.values = values
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let values = try? container.decode([String].self) {
            self.values = values
        } else if let value = try? container.decode(String.self) {
            self.values = value.isEmpty ? [] : [value]
        } else {
            self.values = []
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
