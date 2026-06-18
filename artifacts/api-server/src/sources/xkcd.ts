export class XkcdScraper {
    readonly name = "xkcd";
    readonly baseUrl = "https://xkcd.com";
    readonly lang = "en";

    // Standard DOM parser for web environments
    private parseHTML(html: string): Document {
        const parser = new DOMParser();
        return parser.parseFromString(html, "text/html");
    }

    // 1. Return the main "Manga" details (xkcd is just one big manga)
    async getDetails() {
        return {
            title: "xkcd",
            author: "Randall Munroe",
            artist: "Randall Munroe",
            description: "A webcomic of romance, sarcasm, math and language.",
            status: "ONGOING",
            thumbnail_url: "https://xkcd.com/s/0b7742.png"
        };
    }

    // 2. Fetch the Archive and return it as a list of Chapters
    async getChapters() {
        // NOTE: Add your proxy url prefix here if running strictly client-side to bypass CORS
        const response = await fetch(`${this.baseUrl}/archive/`);
        const html = await response.text();
        const doc = this.parseHTML(html);

        const chapterLinks = doc.querySelectorAll("#middleContainer > a");
        const chapters: Array<{ chapter_number: number; name: string; url: string; date_upload: string }> = [];

        chapterLinks.forEach(link => {
            const url = link.getAttribute("href") || "";
            const comicNumber = parseInt(url.replace(/\//g, ""));
            const title = link.textContent || "";
            const date = link.getAttribute("title") || "";

            if (!isNaN(comicNumber)) {
                chapters.push({
                    chapter_number: comicNumber,
                    name: `${comicNumber}: ${title}`,
                    url: `${this.baseUrl}${url}`,
                    date_upload: date
                });
            }
        });

        // Return descending (newest first) to match Tachiyomi standard
        return chapters.reverse();
    }

    // 3. Fetch a specific comic page and its alt text
    async getPages(chapterUrl: string) {
        const response = await fetch(chapterUrl);
        const html = await response.text();
        const doc = this.parseHTML(html);

        const imgElement = doc.querySelector("#comic > img");
        if (!imgElement) {
            throw new Error("Interactive comic or image not found");
        }

        const imageUrl = imgElement.getAttribute("srcset") 
            ? imgElement.getAttribute("srcset")?.split(" ")[0] // Get high-res if available
            : imgElement.getAttribute("src");

        const altText = imgElement.getAttribute("title") || "";

        return {
            images: [
                imageUrl?.startsWith("//") ? `https:${imageUrl}` : imageUrl
            ],
            alt_text: altText
        };
    }
}
