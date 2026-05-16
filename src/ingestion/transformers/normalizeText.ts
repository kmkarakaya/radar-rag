const ZERO_WIDTH_CHARACTERS = /[\u200B-\u200D\uFEFF]/g;
const NON_BREAKING_SPACES = /\u00A0/g;
const FORM_FEED_CHARACTERS = /\f/g;
const VERTICAL_WHITESPACE = /\r\n?|\u2028|\u2029/g;
const TRAILING_HORIZONTAL_WHITESPACE = /[ \t]+\n/g;
const LEADING_HORIZONTAL_WHITESPACE = /\n[ \t]+/g;
const REPEATED_HORIZONTAL_WHITESPACE = /[ \t]{2,}/g;
const HYPHENATED_LINE_BREAK = /(\p{L})-\n(\p{L})/gu;
const EXCESSIVE_BLANK_LINES = /\n{3,}/g;

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(NON_BREAKING_SPACES, " ")
    .replace(ZERO_WIDTH_CHARACTERS, "")
    .replace(FORM_FEED_CHARACTERS, "\n")
    .replace(VERTICAL_WHITESPACE, "\n")
    .replace(HYPHENATED_LINE_BREAK, "$1$2")
    .replace(TRAILING_HORIZONTAL_WHITESPACE, "\n")
    .replace(LEADING_HORIZONTAL_WHITESPACE, "\n")
    .replace(REPEATED_HORIZONTAL_WHITESPACE, " ")
    .replace(EXCESSIVE_BLANK_LINES, "\n\n")
    .trim();
}