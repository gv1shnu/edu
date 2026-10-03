import sanitizeHtml from "sanitize-html";
import { slugify } from "@edu/shared";

/**
 * Lesson and class-note bodies are HTML written by the tutor. They are cleaned on save (and
 * the result is what gets stored and rendered): no scripts, frames, forms, event handlers or
 * embedded media. h2/h3 headings get stable ids so the notes reader can build a contents list.
 */
const options: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "figure",
    "figcaption",
    "details",
    "summary",
    "mark",
    "sub",
    "sup",
    "del",
    "ins",
    "kbd",
    // MathML, for formulas pasted from tools that export it.
    "math",
    "mrow",
    "mi",
    "mo",
    "mn",
    "msup",
    "msub",
    "msubsup",
    "mfrac",
    "msqrt",
    "mroot",
    "mtext",
    "mspace",
    "mtable",
    "mtr",
    "mtd",
    "munder",
    "mover",
    "munderover",
    "semantics",
    "annotation",
  ],
  allowedAttributes: {
    "*": ["class", "style", "title", "lang", "dir"],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height", "loading"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    ol: ["start", "type"],
    math: ["display", "xmlns"],
    annotation: ["encoding"],
  },
  allowedStyles: {
    "*": {
      color: [/^[#a-z0-9(),.\s%]+$/i],
      "background-color": [/^[#a-z0-9(),.\s%]+$/i],
      "text-align": [/^(left|right|center|justify)$/],
      "font-weight": [/^(normal|bold|[1-9]00)$/],
      "font-style": [/^(normal|italic)$/],
      "text-decoration": [/^[a-z\s-]+$/],
      width: [/^\d+(\.\d+)?(px|%|em|rem)$/],
      "margin-left": [/^\d+(\.\d+)?(px|em|rem)$/],
      "padding-left": [/^\d+(\.\d+)?(px|em|rem)$/],
    },
  },
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: { img: ["https", "data"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        ...(attribs.target === "_blank" ? { rel: "noopener noreferrer" } : {}),
      },
    }),
  },
};

export function cleanHtml(html: string) {
  return sanitizeHtml(html, options).replace(
    /<(h[23])([^>]*)>([\s\S]*?)<\/\1>/g,
    (_, tag, attrs, inner) =>
      `<${tag}${attrs} id="${slugify(inner.replace(/<[^>]*>/g, ""))}">${inner}</${tag}>`,
  );
}
