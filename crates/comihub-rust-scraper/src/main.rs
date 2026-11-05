use std::{collections::HashSet, env, net::IpAddr, sync::Arc, time::Duration};

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use reqwest::{redirect::Policy, Client};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use url::Url;

const MAX_HTML_BYTES: usize = 1024 * 1024;
const MAX_CHAPTERS: usize = 300;
const MAX_URL_BYTES: usize = 2048;

#[derive(Clone)]
struct AppState {
    client: Client,
    scrape_slots: Arc<Semaphore>,
    api_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScrapeRequest {
    url: String,
    title_selector: Option<String>,
    cover_selector: Option<String>,
    chapters_selector: Option<String>,
}

#[derive(Debug, Serialize)]
struct ScrapeResponse {
    title: String,
    url: String,
    cover: Option<String>,
    chapters: Vec<ScrapedChapter>,
}

#[derive(Debug, Serialize)]
struct ScrapedChapter {
    title: String,
    url: String,
}

struct ApiError(StatusCode, &'static str);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

async fn scrape(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ScrapeRequest>,
) -> Result<Json<ScrapeResponse>, ApiError> {
    let Some(expected) = state.api_token.as_deref() else {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "Scraper token is not configured"));
    };
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if supplied != format!("Bearer {expected}") {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "Unauthorized"));
    }
    if request.url.len() > MAX_URL_BYTES {
        return Err(ApiError(StatusCode::BAD_REQUEST, "URL is too long"));
    }
    let start_url = Url::parse(&request.url)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Invalid URL"))?;
    if !is_safe_url(&start_url) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Only public HTTPS URLs are allowed"));
    }

    let _permit = state
        .scrape_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "Scraper is shutting down"))?;

    let response = state
        .client
        .get(start_url)
        .header(header::ACCEPT, "text/html,application/xhtml+xml;q=0.9")
        .header(header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .header(header::USER_AGENT, "ComiHubRustScraper/0.1")
        .send()
        .await
        .map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Upstream request failed"))?;
    if !response.status().is_success() {
        return Err(ApiError(StatusCode::BAD_GATEWAY, "Upstream returned an error"));
    }
    let final_url = response.url().clone();
    if !is_safe_url(&final_url) {
        return Err(ApiError(StatusCode::BAD_GATEWAY, "Unsafe redirect destination"));
    }
    if response.content_length().is_some_and(|length| length > MAX_HTML_BYTES as u64) {
        return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "Upstream HTML exceeds the size limit"));
    }

    let mut body = Vec::with_capacity(response.content_length().unwrap_or(16 * 1024) as usize);
    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ApiError(StatusCode::BAD_GATEWAY, "Could not read upstream HTML"))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_HTML_BYTES {
            return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "Upstream HTML exceeds the size limit"));
        }
        body.extend_from_slice(&chunk);
    }
    let html = String::from_utf8_lossy(&body);
    let document = Html::parse_document(&html);
    let base_url = final_url.as_str();

    let title_selector = parse_selector(request.title_selector.as_deref().unwrap_or("h1"))?;
    let title = document
        .select(&title_selector)
        .next()
        .map(element_text)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            Selector::parse("title")
                .ok()
                .and_then(|selector| document.select(&selector).next().map(element_text))
        })
        .unwrap_or_default();

    let cover_selector = parse_selector(request.cover_selector.as_deref().unwrap_or("img"))?;
    let cover = document
        .select(&cover_selector)
        .find_map(|selected| {
            let image_selector = Selector::parse("img").ok()?;
            let image = if selected.value().name() == "img" {
                Some(selected)
            } else {
                selected.select(&image_selector).next()
            }?;
            resolve_url(base_url, &preferred_image_attribute(image)?)
        });

    let chapters = if let Some(selector_text) = request.chapters_selector.as_deref() {
        let selector = parse_selector(selector_text)?;
        let link_selector = Selector::parse("a[href]")
            .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "Could not initialize parser"))?;
        let mut seen = HashSet::new();
        document
            .select(&selector)
            .take(MAX_CHAPTERS)
            .filter_map(|item| {
                let link = if item.value().name() == "a" && item.value().attr("href").is_some() {
                    Some(item)
                } else {
                    item.select(&link_selector).next()
                }?;
                let url = resolve_url(base_url, link.value().attr("href")?)?;
                if !seen.insert(url.clone()) {
                    return None;
                }
                let title = element_text(link);
                if title.is_empty() {
                    return None;
                }
                Some(ScrapedChapter { title, url })
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(Json(ScrapeResponse {
        title,
        url: final_url.to_string(),
        cover,
        chapters,
    }))
}

fn parse_selector(value: &str) -> Result<Selector, ApiError> {
    if value.is_empty() || value.len() > 256 {
        return Err(ApiError(StatusCode::BAD_REQUEST, "Selector is empty or too long"));
    }
    Selector::parse(value).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Invalid CSS selector"))
}

fn element_text(element: ElementRef<'_>) -> String {
    element.text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
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
    Url::parse(base)
        .ok()?
        .join(value)
        .ok()
        .filter(is_safe_url)
        .map(|url| url.to_string())
}

fn is_safe_url(url: &Url) -> bool {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
    {
        return false;
    }
    let Some(host) = url.host_str() else { return false };
    !is_blocked_host(host)
}

fn is_blocked_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".test")
        || host.ends_with(".invalid")
        || host.ends_with(".example")
    {
        return true;
    }
    let Ok(ip) = host.parse::<IpAddr>() else { return false };
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_broadcast()
                || a == 0
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0)
                || (a == 192 && b == 0 && ip.octets()[2] == 2)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && ip.octets()[2] == 100)
                || (a == 203 && b == 0 && ip.octets()[2] == 113)
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_multicast()
                || ip.to_ipv4().is_some_and(|mapped| is_blocked_host(&mapped.to_string()))
        }
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(2)
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !is_safe_url(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .expect("HTTP client initialization failed");
    let state = AppState {
        client,
        scrape_slots: Arc::new(Semaphore::new(1)),
        api_token: env::var("SCRAPER_API_TOKEN").ok().filter(|value| !value.is_empty()),
    };
    let app = Router::new()
        .route("/healthz", get(health))
        .route("/scrape", post(scrape))
        .layer(DefaultBodyLimit::max(32 * 1024))
        .with_state(state);
    let port = env::var("PORT").unwrap_or_else(|_| "10000".to_owned());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .expect("HTTP listener bind failed");
    axum::serve(listener, app)
        .await
        .expect("HTTP server failed");
}
