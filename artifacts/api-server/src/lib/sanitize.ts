import sanitizeHtml from "sanitize-html";

export function sanitizeText(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
  });
}

export function sanitizeRichHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ["b", "i", "u", "strong", "em", "p", "br", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "blockquote", "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: {
      a: ["href", "target"],
    },
  });
}
