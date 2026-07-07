import sanitizeHtml from "sanitize-html";

// Titles, names, resolution numbers, etc. A generous cap that prevents both the
// unbounded-title issue and null-byte 500s, without truncating legitimate input.
const MAX_TEXT_LENGTH = 500;

// C0 control characters (0x00-0x1F) plus DEL (0x7F). Null bytes in particular
// make Postgres text inserts throw a 500 instead of failing gracefully.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

export function sanitizeText(input: string, maxLength = MAX_TEXT_LENGTH): string {
  const cleaned = sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: [],
  })
    .replace(CONTROL_CHARS, "")
    .trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

export function sanitizeRichHtml(input: string): string {
  return sanitizeHtml(input.replace(CONTROL_CHARS, ""), {
    allowedTags: ["b", "i", "u", "strong", "em", "p", "br", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "blockquote", "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: {
      a: ["href", "target"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
    disallowedTagsMode: "discard",
  });
}
