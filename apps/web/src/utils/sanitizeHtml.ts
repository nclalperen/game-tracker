import DOMPurify from "dompurify";

type SanitizeOptions = {
  allowedTags?: string[];
  allowedAttributes?: string[];
};

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  allowedTags: [
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "em",
    "i",
    "li",
    "ol",
    "p",
    "strong",
    "ul",
    "span",
    "small",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "img",
  ],
  allowedAttributes: ["href", "title", "target", "rel", "src", "alt", "width", "height", "class"],
};

function ensureDom(): boolean {
  return typeof window !== "undefined" && typeof window.document !== "undefined";
}

function applyLinkAttributes(html: string): string {
  if (!ensureDom() || !html) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener");
  });
  return template.innerHTML;
}

export function sanitizeHtml(input: string | null | undefined, options: SanitizeOptions = {}): string {
  if (!input) return "";
  const merged = {
    allowedTags: options.allowedTags ?? DEFAULT_OPTIONS.allowedTags,
    allowedAttributes: options.allowedAttributes ?? DEFAULT_OPTIONS.allowedAttributes,
  };

  const sanitized = DOMPurify.sanitize(input, {
    ALLOWED_TAGS: merged.allowedTags,
    ALLOWED_ATTR: merged.allowedAttributes,
    RETURN_TRUSTED_TYPE: false,
  });

  return applyLinkAttributes(sanitized);
}
