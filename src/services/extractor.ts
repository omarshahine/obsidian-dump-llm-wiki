import { requestUrl } from "obsidian";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface ExtractedContent {
  title: string;
  author: string | null;
  content: string;
  excerpt: string;
  hostname: string;
  publishedDate: string | null;
}

/**
 * Extracts article content from a URL using requestUrl + Readability.
 * requestUrl() bypasses CORS (critical for mobile).
 */
export async function extractFromURL(url: string): Promise<ExtractedContent> {
  const response = await requestUrl({ url, method: "GET" });
  const html = response.text;
  const hostname = new URL(url).hostname.replace("www.", "");

  // Parse HTML into a DOM using linkedom (lightweight, no browser needed)
  const { document } = parseHTML(html);

  // Extract with Readability
  const reader = new Readability(document as unknown as Document);
  const article = reader.parse();

  if (!article || !article.textContent) {
    // Fallback: extract text from body
    const bodyText = document.body?.textContent?.trim() || "";
    return {
      title: document.title || hostname,
      author: null,
      content: bodyText.substring(0, 10000),
      excerpt: bodyText.substring(0, 200),
      hostname,
      publishedDate: null,
    };
  }

  // Convert Readability HTML output to simple markdown-ish text
  const markdownContent = htmlToMarkdown(article.content || article.textContent);

  return {
    title: article.title || document.title || hostname,
    author: article.byline || null,
    content: markdownContent,
    excerpt: article.excerpt || markdownContent.substring(0, 200),
    hostname,
    publishedDate: extractPublishedDate(html),
  };
}

/**
 * Simple HTML to markdown conversion for article content.
 * Not perfect, but good enough for raw source storage.
 */
function htmlToMarkdown(html: string): string {
  return html
    // Headers
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n")
    // Paragraphs and line breaks
    .replace(/<p[^>]*>/gi, "\n\n")
    .replace(/<\/p>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    // Bold and italic
    .replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>(.*?)<\/\1>/gi, "*$2*")
    // Links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    // Lists
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n")
    // Code
    .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>(.*?)<\/pre>/gis, "```\n$1\n```\n")
    // Blockquotes
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_, content: string) =>
      content
        .split("\n")
        .map((l: string) => `> ${l}`)
        .join("\n")
    )
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Clean up entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Try to extract a published date from common meta tags.
 */
function extractPublishedDate(html: string): string | null {
  const patterns = [
    /property="article:published_time"\s+content="([^"]+)"/i,
    /name="date"\s+content="([^"]+)"/i,
    /name="DC\.date"\s+content="([^"]+)"/i,
    /datePublished['"]\s*:\s*['"]([\d-T:]+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const date = match[1].split("T")[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    }
  }

  return null;
}
