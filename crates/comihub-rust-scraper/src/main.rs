use std::io::{self, Read, Write};

use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use url::Url;

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = MAX_HTML_BYTES + 64 * 1024;
const MAX_CHAPTERS: usize = 300;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParseInput {
    html: String,
    url: String,
    title_selector: Option<String>,
    cover_selector: Option<String>,
    chapters_selector: Option<String>,
}

#[derive(Serialize)]
struct ParseOutput {
    title: String,
    url: String,
    cover: Option<String>,
    chapters: Vec<Chapter>,
}

#[derive(Serialize)]
struct Chapter {
    title: String,
    url: String,
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
    let document = Html::parse_document(&input.html);
    let title_selector = selector(input.title_selector.as_deref().unwrap_or("h1"))?;
    let title = document
        .select(&title_selector)
        .next()
        .map(text)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            Selector::parse("title")
                .ok()
                .and_then(|title_selector| document.select(&title_selector).next().map(text))
        })
        .unwrap_or_default();

    let cover_selector = selector(input.cover_selector.as_deref().unwrap_or("img"))?;
    let cover = document.select(&cover_selector).find_map(|selected| {
        let image_selector = Selector::parse("img").ok()?;
        let image = if selected.value().name() == "img" {
            Some(selected)
        } else {
            selected.select(&image_selector).next()
        }?;
        preferred_image_attribute(image).and_then(|value| resolve_url(&input.url, &value))
    });

    let chapters = if let Some(selector_text) = input.chapters_selector.as_deref() {
        let chapter_selector = selector(selector_text)?;
        let link_selector = Selector::parse("a[href]").map_err(|_| "invalid anchor selector")?;
        let mut seen = std::collections::HashSet::new();
        document
            .select(&chapter_selector)
            .take(MAX_CHAPTERS)
            .filter_map(|item| {
                let link = if item.value().name() == "a" && item.value().attr("href").is_some() {
                    Some(item)
                } else {
                    item.select(&link_selector).next()
                }?;
                let url = resolve_url(&input.url, link.value().attr("href")?)?;
                if !seen.insert(url.clone()) {
                    return None;
                }
                let title = text(link);
                (!title.is_empty()).then_some(Chapter { title, url })
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(ParseOutput {
        title,
        url: input.url,
        cover,
        chapters,
    })
}

fn selector(value: &str) -> Result<Selector, &'static str> {
    if value.is_empty() || value.len() > 256 {
        return Err("selector is empty or too long");
    }
    Selector::parse(value).map_err(|_| "invalid CSS selector")
}

fn text(element: ElementRef<'_>) -> String {
    element
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn preferred_image_attribute(element: ElementRef<'_>) -> Option<String> {
    ["data-lazy-src", "data-original", "data-src", "src"]
        .iter()
        .filter_map(|name| element.value().attr(name))
        .map(str::trim)
        .find(|value| {
            !value.is_empty()
                && !value.starts_with("data:")
                && !value.to_ascii_lowercase().contains("placeholder")
                && !value.to_ascii_lowercase().contains("transparent")
                && !value.to_ascii_lowercase().contains("blank")
        })
        .map(str::to_owned)
}

fn resolve_url(base: &str, value: &str) -> Option<String> {
    let url = Url::parse(base).ok()?.join(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

fn fail(message: &str) -> ! {
    let _ = writeln!(io::stderr().lock(), "{message}");
    std::process::exit(1);
}
