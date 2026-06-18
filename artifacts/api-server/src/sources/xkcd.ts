import { type AxiosInstance } from "axios";
import { fetchHtml, absUrl, imgAttr, type MangaScraper } from "./scraper-utils";

export class XkcdScraper implements MangaScraper {
  readonly name = "xkcd";
  readonly baseUrl = "https://xkcd.com";

  constructor(private http: AxiosInstance) {}

  async getDetails() {
    return {
      title: "xkcd",
      author: "Randall Munroe",
      description: "A webcomic of romance, sarcasm, math and language.",
      status: "ONGOING",
      thumbnail_url: "https://xkcd.com/s/0b7742.png",
    };
  }

  async getChapters() {
    const { $ } = await fetchHtml(this.http, `${this.baseUrl}/archive/`);
    const chapters: any[] = [];

    $("#middleContainer > a").each((_, element) => {
      const $el = $(element);
      const relativeUrl = $el.attr("href") || "";
      const comicNumber = parseInt(relativeUrl.replace(/\//g, ""), 10);
      const title = $el.text().trim();
      const date = $el.attr("title") || "";

      if (!isNaN(comicNumber)) {
        chapters.push({
          chapter_number: comicNumber,
          name: `${comicNumber}: ${title}`,
          url: absUrl(this.baseUrl, relativeUrl),
          date_upload: date,
        });
      }
    });

    return chapters.reverse();
  }

  async getPages(chapterUrl: string) {
    const { $ } = await fetchHtml(this.http, chapterUrl);
    const $img = $("#comic > img");
    
    if ($img.length === 0) {
      throw new Error("Image asset not found.");
    }

    return {
      images: [absUrl(this.baseUrl, imgAttr($img))],
      alt_text: $img.attr("title") || "",
    };
  }
}
