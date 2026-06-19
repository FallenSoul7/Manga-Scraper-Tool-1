---
name: Webtoons source implementation
description: How Webtoons (all.webtoons) is implemented — manga ID format, episode API, pages scraping.
---

## Manga ID format
The manga ID is the URL path: `/en/action/corporate-punch/list?title_no=10337`
- Extract `title_no` query param for API calls
- Path segments give: lang (en), type/genre (action), slug (corporate-punch)
- Type is "canvas" if path[1] === "canvas", else "webtoon"

## Chapter ID format
Chapter ID is the `viewerLink` from the mobile episodes API:
`/en/action/corporate-punch/episode-1/viewer?title_no=10337&episode_no=1`
- Full URL used to fetch the viewer page for images

## Key endpoints
- Popular: `GET /en/ranking/{trending|popular|originals|canvas}` — cycles through as "pages"
- Latest: `GET /en/originals/{day}?sortOrder=UPDATE` — day-of-week based
- Search: `GET /en/search/webtoon?keyword={query}&page=N`
- Details: scrape the manga list URL
- Episode list: `GET https://m.webtoons.com/api/v1/webtoon/{titleNo}/episodes?pageSize=99999`
- Pages: scrape `https://www.webtoons.com{viewerLink}` for `#_imageList > img[data-url]`

## Required cookies
All requests need: `ageGatePass=true; locale=en; needGDPR=false`

## Pages note
- Episode panels are in `div#_imageList > img[data-url]` (direct children only)
- Skip images with `/thumb_` in URL (episode navigation thumbnails)
- Images require `Referer: https://www.webtoons.com/` — served via image proxy
- 200-300+ panels per episode is normal for long-form vertical scroll webtoons
