use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::{self, Read, Write};

use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use url::Url;

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = MAX_HTML_BYTES + 64 * 1024;
const MAX_CHAPTERS: usize = 300;
const MAX_ITEMS: usize = 200;
const MAX_PAGES: usize = 500;
const MAX_CONFIG_BYTES: usize = 64 * 1024;

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectorConfig {
    title: Option<String>,
    cover: Option<String>,
    status: Option<String>,
    description: Option<String>,
    #[serde(alias = "items")]
    manga_list: Option<String>,
    #[serde(alias = "chapters")]
    chapter_list: Option<String>,
    chapter_title: Option<String>,
    chapter_date: Option<String>,
    reader_pages: Option<String>,
    item_title: Option<String>,
    item_cover: Option<String>,
    #[serde(alias = "hasNextPage")]
    next_page: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParseInput {
    html: String,
    url: String,
    #[serde(default)]
    source_id: Option<String>,
    #[serde(default)]
    custom_parser: bool,
    selectors: Option<SelectorConfig>,
    // Legacy flat fields remain accepted for existing CLI callers.
    title_selector: Option<String>,
    cover_selector: Option<String>,
    status_selector: Option<String>,
    description_selector: Option<String>,
    chapters_selector: Option<String>,
    chapter_title_selector: Option<String>,
    chapter_date_selector: Option<String>,
    items_selector: Option<String>,
    reader_pages_selector: Option<String>,
    item_title_selector: Option<String>,
    item_cover_selector: Option<String>,
    has_next_page_selector: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfigDocument {
    #[serde(rename = "version")]
    _version: Option<u32>,
    url: Option<String>,
    source_id: Option<String>,
    selectors: Option<SelectorConfig>,
    custom_parser: Option<bool>,
    sources: Option<Vec<RegistrySource>>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegistrySource {
    id: String,
    #[serde(rename = "name")]
    _name: Option<String>,
    base_url: Option<String>,
    selectors: Option<SelectorConfig>,
    custom_parser: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParseOutput {
    title: String,
    url: String,
    cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    chapters: Vec<Chapter>,
    items: Vec<MangaItem>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pages: Vec<ReaderPage>,
    has_next_page: bool,
}

#[derive(Serialize)]
struct Chapter {
    title: String,
    url: String,
    date: Option<String>,
}

#[derive(Serialize)]
struct MangaItem {
    title: String,
    url: String,
    cover: Option<String>,
}

#[derive(Serialize)]
struct ReaderPage {
    index: usize,
    url: String,
}

#[derive(Default)]
struct CliOptions {
    config: Option<String>,
    source_id: Option<String>,
    url: Option<String>,
    selectors: SelectorConfig,
    custom_parser: Option<bool>,
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("Usage: comihub-parser [--config <JSON|path>] [--source-id <id>] --url <URL> [selector flags] [--custom-parser] < HTML");
        return;
    }
    let request = if args.is_empty() {
        let bytes = read_stdin(MAX_INPUT_BYTES);
        if bytes.len() > MAX_INPUT_BYTES {
            fail("parser input exceeds the size limit");
        }
        match serde_json::from_slice::<ParseInput>(&bytes) {
            Ok(value) => value,
            Err(_) => fail("invalid parser input JSON"),
        }
    } else {
        parse_cli(args)
    };
    if request.html.len() > MAX_HTML_BYTES {
        fail("HTML exceeds the size limit");
    }
    let output = match parse(request) {
        Ok(value) => value,
        Err(message) => fail(message),
    };
    match serde_json::to_writer(io::stdout().lock(), &output) {
        Ok(()) => {
            let _ = io::stdout().lock().write_all(b"\n");
        }
        Err(_) => fail("could not write parser result"),
    }
}

fn read_stdin(limit: usize) -> Vec<u8> {
    let mut input = Vec::new();
    if io::stdin().take((limit + 1) as u64).read_to_end(&mut input).is_err() {
        fail("could not read stdin");
    }
    input
}

fn read_config(value: &str) -> ConfigDocument {
    let (contents, is_inline) = if value.trim_start().starts_with('{') {
        (value.to_owned(), true)
    } else {
        let path = value.strip_prefix('@').unwrap_or(value);
        let contents = fs::read_to_string(path).unwrap_or_else(|_| fail("could not read config file"));
        (contents, false)
    };
    if contents.len() > MAX_CONFIG_BYTES {
        fail("parser config exceeds the size limit");
    }
    match serde_json::from_str(&contents) {
        Ok(config) => config,
        Err(_) if is_inline => fail("invalid parser config JSON"),
        Err(_) => fail("invalid config file JSON"),
    }
}

fn parse_cli(args: Vec<String>) -> ParseInput {
    let mut options = CliOptions::default();
    let mut index = 0;
    while index < args.len() {
        let flag = args[index].as_str();
        if flag == "--custom-parser" {
            options.custom_parser = Some(true);
            index += 1;
            continue;
        }
        if flag == "--no-custom-parser" {
            options.custom_parser = Some(false);
            index += 1;
            continue;
        }
        let value = args.get(index + 1).unwrap_or_else(|| fail("missing CLI option value"));
        match flag {
            "--config" => options.config = Some(value.clone()),
            "--source-id" | "--source" => options.source_id = Some(value.clone()),
            "--url" => options.url = Some(value.clone()),
            "--title-selector" => options.selectors.title = Some(value.clone()),
            "--cover-selector" => options.selectors.cover = Some(value.clone()),
            "--status-selector" => options.selectors.status = Some(value.clone()),
            "--description-selector" => options.selectors.description = Some(value.clone()),
            "--manga-list-selector" | "--items-selector" => options.selectors.manga_list = Some(value.clone()),
            "--chapter-list-selector" | "--chapters-selector" => options.selectors.chapter_list = Some(value.clone()),
            "--chapter-title-selector" => options.selectors.chapter_title = Some(value.clone()),
            "--chapter-date-selector" => options.selectors.chapter_date = Some(value.clone()),
            "--reader-pages-selector" => options.selectors.reader_pages = Some(value.clone()),
            "--item-title-selector" => options.selectors.item_title = Some(value.clone()),
            "--item-cover-selector" => options.selectors.item_cover = Some(value.clone()),
            "--next-page-selector" | "--has-next-page-selector" => options.selectors.next_page = Some(value.clone()),
            _ => fail("unknown CLI option"),
        }
        index += 2;
    }

    let config = options.config.as_deref().map(read_config).unwrap_or_default();
    let source_id = options.source_id.or(config.source_id.clone());
    let sources = config.sources.as_deref().unwrap_or_default();
    let source = source_id.as_deref().and_then(|id| sources.iter().find(|source| source.id == id));
    if !sources.is_empty() && source_id.is_some() && source.is_none() {
        fail("source ID is not present in the config registry");
    }
    let source = source.or_else(|| if sources.len() == 1 { sources.first() } else { None });
    let url = options.url.or(config.url).or_else(|| source.and_then(|entry| entry.base_url.clone()))
        .unwrap_or_else(|| fail("target URL is required (use --url or config baseUrl)"));
    let source_id = source_id.or_else(|| source.map(|entry| entry.id.clone()));
    let selectors = merge_selectors(
        options.selectors,
        merge_selectors(config.selectors.unwrap_or_default(), source.and_then(|entry| entry.selectors.clone()).unwrap_or_default()),
    );
    let custom_parser = options.custom_parser.unwrap_or_else(|| {
        config.custom_parser.unwrap_or(false) || source.and_then(|entry| entry.custom_parser).unwrap_or(false)
    });
    let html = String::from_utf8_lossy(&read_stdin(MAX_HTML_BYTES)).into_owned();

    ParseInput {
        html,
        url,
        source_id,
        custom_parser,
        selectors: Some(selectors),
        title_selector: None,
        cover_selector: None,
        status_selector: None,
        description_selector: None,
        chapters_selector: None,
        chapter_title_selector: None,
        chapter_date_selector: None,
        items_selector: None,
        reader_pages_selector: None,
        item_title_selector: None,
        item_cover_selector: None,
        has_next_page_selector: None,
    }
}

fn merge_selectors(primary: SelectorConfig, fallback: SelectorConfig) -> SelectorConfig {
    SelectorConfig {
        title: primary.title.or(fallback.title),
        cover: primary.cover.or(fallback.cover),
        status: primary.status.or(fallback.status),
        description: primary.description.or(fallback.description),
        manga_list: primary.manga_list.or(fallback.manga_list),
        chapter_list: primary.chapter_list.or(fallback.chapter_list),
        chapter_title: primary.chapter_title.or(fallback.chapter_title),
        chapter_date: primary.chapter_date.or(fallback.chapter_date),
        reader_pages: primary.reader_pages.or(fallback.reader_pages),
        item_title: primary.item_title.or(fallback.item_title),
        item_cover: primary.item_cover.or(fallback.item_cover),
        next_page: primary.next_page.or(fallback.next_page),
    }
}

fn parse(input: ParseInput) -> Result<ParseOutput, &'static str> {
    let mut output = parse_generic(&input)?;
    if input.custom_parser && input.source_id.as_deref() == Some("en.elftoon") && output.pages.is_empty() {
        output.pages = parse_elftoon_script_pages(&input.html, &input.url);
    }
    Ok(output)
}

fn parse_generic(input: &ParseInput) -> Result<ParseOutput, &'static str> {
    let html = strip_noscript_contents(&input.html);
    let document = Html::parse_document(&html);
    let configured = input.selectors.as_ref();
    let title_selector_text = configured.and_then(|value| value.title.as_deref())
        .or(input.title_selector.as_deref()).unwrap_or("h1");
    let title_selector = selector(title_selector_text)?;
    let title = document
        .select(&title_selector)
        .next()
        .map(text)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            Selector::parse("title")
                .ok()
                .and_then(|selector| document.select(&selector).next().map(text))
        })
        .unwrap_or_default();

    let cover_selector_text = configured.and_then(|value| value.cover.as_deref())
        .or(input.cover_selector.as_deref()).unwrap_or("img");
    let cover_selector = selector(cover_selector_text)?;
    let cover = document.select(&cover_selector).find_map(|selected| {
        cover_candidate(selected, "img").and_then(|value| resolve_url(&input.url, &value))
    });

    let status_selector_text = configured.and_then(|value| value.status.as_deref())
        .or(input.status_selector.as_deref());
    let status = status_selector_text.map(selector).transpose()?.and_then(|selector| {
        document.select(&selector).next().map(text).filter(|value| !value.is_empty())
    });
    let description_selector_text = configured.and_then(|value| value.description.as_deref())
        .or(input.description_selector.as_deref());
    let description = description_selector_text.map(selector).transpose()?.and_then(|selector| {
        document.select(&selector).next().map(text).filter(|value| !value.is_empty())
    });

    let chapters_selector_text = configured.and_then(|value| value.chapter_list.as_deref())
        .or(input.chapters_selector.as_deref());
    let chapter_title_selector_text = configured.and_then(|value| value.chapter_title.as_deref())
        .or(input.chapter_title_selector.as_deref());
    let chapter_date_selector_text = configured.and_then(|value| value.chapter_date.as_deref())
        .or(input.chapter_date_selector.as_deref());
    let chapter_selector = chapters_selector_text.map(selector).transpose()?;
    let chapter_title_selector = chapter_title_selector_text.map(selector).transpose()?;
    let chapter_date_selector = chapter_date_selector_text.map(selector).transpose()?;
    let link_selector = Selector::parse("a[href]").map_err(|_| "invalid anchor selector")?;
    let chapters = if let Some(chapter_selector) = chapter_selector {
        let mut seen = HashSet::new();
        document
            .select(&chapter_selector)
            .take(MAX_CHAPTERS)
            .filter_map(|item| {
                let link = if item.value().name() == "a" && item.value().attr("href").is_some() {
                    Some(item)
                } else {
                    item.select(&link_selector).next()
                }?;
                let href = link.value().attr("href")?;
                if is_javascript_placeholder(href) || href == "#" {
                    return None;
                }
                let url = resolve_url(&input.url, href)?;
                if !seen.insert(url.clone()) {
                    return None;
                }
                let title = chapter_title_selector
                    .as_ref()
                    .and_then(|selector| item.select(selector).next().map(text))
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| text(link));
                if title.is_empty() {
                    return None;
                }
                let date = chapter_date_selector
                    .as_ref()
                    .and_then(|selector| item.select(selector).next().map(text))
                    .filter(|value| !value.is_empty());
                Some(Chapter { title, url, date })
            })
            .collect()
    } else {
        Vec::new()
    };

    let items_selector_text = configured.and_then(|value| value.manga_list.as_deref())
        .or(input.items_selector.as_deref());
    let item_title_selector_text = configured.and_then(|value| value.item_title.as_deref())
        .or(input.item_title_selector.as_deref());
    let item_cover_selector = configured.and_then(|value| value.item_cover.as_deref())
        .or(input.item_cover_selector.as_deref()).unwrap_or("img");
    let items_selector = items_selector_text.map(selector).transpose()?;
    let item_title_selector = item_title_selector_text.map(selector).transpose()?;
    let items = if let Some(items_selector) = items_selector {
        let mut seen = HashSet::new();
        document
            .select(&items_selector)
            .take(MAX_ITEMS)
            .filter_map(|item| {
                let link = if item.value().name() == "a" && item.value().attr("href").is_some() {
                    Some(item)
                } else {
                    item.select(&link_selector).next()
                }?;
                let href = link.value().attr("href")?;
                if is_javascript_placeholder(href) {
                    return None;
                }
                let url = resolve_url(&input.url, href)?;
                if !seen.insert(url.clone()) {
                    return None;
                }
                let title = link
                    .value()
                    .attr("title")
                    .map(clean_text_value)
                    .filter(|value| !value.is_empty())
                    .or_else(|| {
                        item_title_selector
                            .as_ref()
                            .and_then(|selector| item.select(selector).next().map(text))
                            .filter(|value| !value.is_empty())
                    })
                    .unwrap_or_else(|| text(link));
                if title.is_empty() {
                    return None;
                }
                let cover = cover_candidate(item, item_cover_selector)
                    .and_then(|value| resolve_url(&input.url, &value));
                Some(MangaItem { title, url, cover })
            })
            .collect()
    } else {
        Vec::new()
    };

    let reader_pages_selector_text = configured.and_then(|value| value.reader_pages.as_deref())
        .or(input.reader_pages_selector.as_deref());
    let reader_pages_selector = reader_pages_selector_text.map(selector).transpose()?;
    let mut seen_pages = HashSet::new();
    let pages = reader_pages_selector.map(|page_selector| {
        document.select(&page_selector).take(MAX_PAGES).filter_map(|element| {
            let raw = cover_candidate(element, "img")?;
            let url = resolve_url(&input.url, &raw)?;
            if !seen_pages.insert(url.clone()) {
                return None;
            }
            Some(ReaderPage { index: seen_pages.len() - 1, url })
        }).collect()
    }).unwrap_or_default();

    let has_next_page_selector = configured.and_then(|value| value.next_page.as_deref())
        .or(input.has_next_page_selector.as_deref());
    let has_next_page = has_next_page_selector
        .map(selector)
        .transpose()?
        .is_some_and(|selector| document.select(&selector).next().is_some());

    Ok(ParseOutput {
        title,
        url: input.url.clone(),
        cover,
        status,
        description,
        chapters,
        items,
        pages,
        has_next_page,
    })
}

fn parse_elftoon_script_pages(html: &str, base_url: &str) -> Vec<ReaderPage> {
    let Some(call) = html.find("ts_reader.run(") else { return Vec::new() };
    let after_call = call + "ts_reader.run(".len();
    let Some(relative_start) = html[after_call..].find('{') else { return Vec::new() };
    let start = after_call + relative_start;
    let Some(end) = json_object_end(html, start) else { return Vec::new() };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&html[start..=end]) else { return Vec::new() };
    let Some(images) = value.get("sources").and_then(|sources| sources.get(0))
        .and_then(|source| source.get("images")).and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    images.iter().filter_map(|image| {
        let raw = image.as_str()?;
        let url = resolve_url(base_url, raw)?;
        if !seen.insert(url.clone()) { return None; }
        Some(ReaderPage { index: seen.len() - 1, url })
    }).take(MAX_PAGES).collect()
}

fn json_object_end(input: &str, start: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (index, byte) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escaped { escaped = false; }
            else if *byte == b'\\' { escaped = true; }
            else if *byte == b'"' { in_string = false; }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 { return Some(index); }
            }
            _ => {}
        }
    }
    None
}

fn strip_noscript_contents(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut output = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<noscript") {
        let start = cursor + relative_start;
        output.push_str(&html[cursor..start]);
        let Some(open_end_relative) = lower[start..].find('>') else {
            return output;
        };
        let content_start = start + open_end_relative + 1;
        let Some(close_relative) = lower[content_start..].find("</noscript") else {
            return output;
        };
        let close_start = content_start + close_relative;
        let close_end = lower[close_start..]
            .find('>')
            .map(|offset| close_start + offset + 1)
            .unwrap_or(html.len());
        cursor = close_end;
    }
    output.push_str(&html[cursor..]);
    output
}

fn selector(value: &str) -> Result<Selector, &'static str> {
    if value.is_empty() || value.len() > 256 {
        return Err("selector is empty or too long");
    }
    Selector::parse(value).map_err(|_| "invalid CSS selector")
}

fn clean_text_value(value: &str) -> String {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() || is_javascript_placeholder(&text) || text.to_ascii_lowercase().contains("javascript required") {
        String::new()
    } else {
        text
    }
}

fn is_javascript_placeholder(value: &str) -> bool {
    value.to_ascii_lowercase().contains("javascript:void(0)")
}

fn text(element: ElementRef<'_>) -> String {
    clean_text_value(&element.text().collect::<Vec<_>>().join(" "))
}

fn cover_candidate(element: ElementRef<'_>, image_selector_text: &str) -> Option<String> {
    let image_selector = selector(image_selector_text).ok()?;
    let image = if element.value().name() == "img" {
        Some(element)
    } else {
        element.select(&image_selector).next()
    };
    let image_source = image.and_then(preferred_image_attribute);
    let background = background_in(element);
    let is_snapshot = image.is_some_and(|image| is_layout_snapshot(image, image_source.as_deref().unwrap_or("")));
    if background.is_some() && (image_source.is_none() || is_snapshot) {
        background
    } else {
        image_source.or(background)
    }
}

fn preferred_image_attribute(element: ElementRef<'_>) -> Option<String> {
    ["data-src", "data-original", "data-bg", "src", "data-lazy-src"]
        .iter()
        .filter_map(|name| element.value().attr(name))
        .map(str::trim)
        .find(|value| {
            !value.is_empty()
                && !value.starts_with("data:")
                && !is_javascript_placeholder(value)
                && !value.to_ascii_lowercase().contains("placeholder")
                && !value.to_ascii_lowercase().contains("transparent")
                && !value.to_ascii_lowercase().contains("blank")
        })
        .map(str::to_owned)
}

fn background_in(element: ElementRef<'_>) -> Option<String> {
    if let Some(value) = background_from_node(element) {
        return Some(value);
    }
    let selector = Selector::parse("[data-bg], [style]").ok()?;
    element.select(&selector).find_map(background_from_node)
}

fn background_from_node(element: ElementRef<'_>) -> Option<String> {
    if let Some(value) = element.value().attr("data-bg") {
        if let Some(url) = css_url(value).or_else(|| Some(value.trim().to_owned())) {
            if usable_url(&url) {
                return Some(url);
            }
        }
    }
    let style = element.value().attr("style")?;
    if !style.to_ascii_lowercase().contains("background-image") {
        return None;
    }
    css_url(style).filter(|value| usable_url(value))
}

fn css_url(value: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    let start = lower.find("url(")? + 4;
    let end = value[start..].find(')')? + start;
    let candidate = value[start..end].trim().trim_matches(|ch| ch == '\'' || ch == '"').trim();
    (!candidate.is_empty()).then(|| candidate.to_owned())
}

fn usable_url(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with("data:")
        && !is_javascript_placeholder(value)
        && !value.to_ascii_lowercase().contains("placeholder")
        && !value.to_ascii_lowercase().contains("transparent")
        && !value.to_ascii_lowercase().contains("blank")
}

fn is_layout_snapshot(image: ElementRef<'_>, source: &str) -> bool {
    let width = image.value().attr("width").and_then(|value| value.parse::<f64>().ok()).unwrap_or(0.0);
    let height = image.value().attr("height").and_then(|value| value.parse::<f64>().ok()).unwrap_or(0.0);
    (width > 0.0 && height > 0.0 && width / height >= 2.0)
        || ["layout", "snapshot", "full-section", "full_section", "slider", "trending", "popular", "hero", "banner"]
            .iter()
            .any(|marker| source.to_ascii_lowercase().contains(marker))
}

fn resolve_url(base: &str, value: &str) -> Option<String> {
    let url = Url::parse(base).ok()?.join(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

fn fail(message: &str) -> ! {
    let _ = writeln!(io::stderr().lock(), "{message}");
    std::process::exit(1);
}
