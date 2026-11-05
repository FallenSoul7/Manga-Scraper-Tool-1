use std::collections::HashSet;
use std::io::{self, Read, Write};

use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use url::Url;

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = MAX_HTML_BYTES + 64 * 1024;
const MAX_CHAPTERS: usize = 300;
const MAX_ITEMS: usize = 200;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParseInput {
    html: String,
    url: String,
    title_selector: Option<String>,
    cover_selector: Option<String>,
    chapters_selector: Option<String>,
    chapter_title_selector: Option<String>,
    chapter_date_selector: Option<String>,
    items_selector: Option<String>,
    item_title_selector: Option<String>,
    item_cover_selector: Option<String>,
    has_next_page_selector: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParseOutput {
    title: String,
    url: String,
    cover: Option<String>,
    chapters: Vec<Chapter>,
    items: Vec<MangaItem>,
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

fn main() {
    let mut input = Vec::new();
    if io::stdin()
        .take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut input)
        .is_err()
    {
        fail("could not read stdin");
    }
    if input.len() > MAX_INPUT_BYTES {
        fail("parser input exceeds the size limit");
    }
    let request: ParseInput = match serde_json::from_slice(&input) {
        Ok(value) => value,
        Err(_) => fail("invalid parser input JSON"),
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

fn parse(input: ParseInput) -> Result<ParseOutput, &'static str> {
    let html = strip_noscript_contents(&input.html);
    let document = Html::parse_document(&html);
    let title_selector = selector(input.title_selector.as_deref().unwrap_or("h1"))?;
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

    let cover_selector = selector(input.cover_selector.as_deref().unwrap_or("img"))?;
    let cover = document.select(&cover_selector).find_map(|selected| {
        cover_candidate(selected, "img").and_then(|value| resolve_url(&input.url, &value))
    });

    let chapter_selector = input.chapters_selector.as_deref().map(selector).transpose()?;
    let chapter_title_selector = input.chapter_title_selector.as_deref().map(selector).transpose()?;
    let chapter_date_selector = input.chapter_date_selector.as_deref().map(selector).transpose()?;
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

    let items_selector = input.items_selector.as_deref().map(selector).transpose()?;
    let item_title_selector = input.item_title_selector.as_deref().map(selector).transpose()?;
    let item_cover_selector = input.item_cover_selector.as_deref().unwrap_or("img");
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

    let has_next_page = input
        .has_next_page_selector
        .as_deref()
        .map(selector)
        .transpose()?
        .is_some_and(|selector| document.select(&selector).next().is_some());

    Ok(ParseOutput {
        title,
        url: input.url,
        cover,
        chapters,
        items,
        has_next_page,
    })
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
