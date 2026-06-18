import { type AxiosInstance } from "axios";
import { fetchHtml, absUrl, imgAttr, type MangaScraper } from "../scraper.util";

export class XkcdScraper implements MangaScraper {
  readonly name = "xkcd";
  readonly baseUrl = "https://xkcd.com";

  // Receives the custom configured Axios instance from the ScraperEngine
  constructor(private http: AxiosInstance) {}

  async getDetails() {
    return {
      title: "xkcd",
      author: "Randall Munroe",
      artist: "Randall Munroe",
      description: "A webcomic of romance, sarcasm, math and language.",
      status: "ONGOING",
      thumbnail_url: "https://xkcd.com/s/0b7742.png",
    };
  }

  async getChapters() {
    // Uses your utility fetchHtml helper to execute the request and load Cheerio ($)
    const { $ } = await fetchHtml(this.http, `${this.baseUrl}/archive/`);
    const chapters: any[] = [];

    // Pure cheerio implementation of your Kotlin: "#middleContainer > a"
    $("#middleContainer > a").each((_, element) => {
      const $el = $(element);
      const relativeUrl = $el.attr("href") || "";
      const comicNumber = parseInt(relativeUrl.replace(/\//g, ""), 10);
      const title = $el.text().trim();
      const date = $el.attr("title") || ""; // format: "2026-1-9"

      if (!isNaN(comicNumber)) {
        chapters.push({
          chapter_number: comicNumber,
          name: `${comicNumber}: ${title}`,
          url: absUrl(this.baseUrl, relativeUrl),
          date_upload: date,
        });
      }
    });

    // Reverse list to match Tachiyomi convention (newest uploads first)
    return chapters.reverse();
  }

  async getPages(chapterUrl: string) {
    const { $ } = await fetchHtml(this.http, chapterUrl);
    
    // Grabs the image element based on your selector: "#comic > img"
    const $img = $("#comic > img");
    if ($img.length === 0) {
      throw new Error("Interactive comic framework or clean image asset not found.");
    }

    // Leverages your utility's multi-attribute image fallbacks (src, srcset, data-src)
    const rawImageUrl = imgAttr($img);
    const absoluteImageUrl = absUrl(this.baseUrl, rawImageUrl);
    const altText = $img.attr("title") || "";

    return {
      images: [absoluteImageUrl],
      alt_text: altText, // Preserves the sub-text joke layer
    };
  }
}
