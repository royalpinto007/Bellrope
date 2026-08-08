/**
 * Working out how to read the bytes a page came back as.
 *
 * `response.text()` assumes UTF-8 unless the Content-Type header says
 * otherwise. A browser is cleverer: it also reads the meta charset in the
 * markup. Plenty of pages, particularly older ones and a lot of the world
 * outside English, declare their encoding only there.
 *
 * Getting this wrong is quiet and permanent. The text decodes into mojibake,
 * it decodes into the same mojibake every time, so nothing ever looks like a
 * change and the watch simply never fires. The user concludes the page has not
 * changed. That is the worst failure this product has, because it looks
 * exactly like working.
 */

/** The charset named in a Content-Type header, if it names one. */
export function charsetFromHeader(contentType: string | null): string | null {
  if (!contentType) return null;
  const match = contentType.match(/charset\s*=\s*"?([\w-]+)"?/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * The charset declared in the markup.
 *
 * Both spellings: the HTML5 `<meta charset>` and the older http-equiv form.
 * Only the head is worth reading, and the spec says a declaration after the
 * first 1024 bytes does not count anyway.
 */
export function charsetFromMeta(head: string): string | null {
  const short = head.slice(0, 2048);

  const html5 = short.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i);
  if (html5?.[1]) return html5[1].toLowerCase();

  const legacy = short.match(/<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*>/i);
  if (legacy?.[0]) return charsetFromHeader(legacy[0]);

  return null;
}

/** Encodings TextDecoder will not accept, mapped to what was meant. */
const ALIASES: Record<string, string> = {
  utf8: 'utf-8',
  'utf-8': 'utf-8',
  latin1: 'windows-1252',
  'iso-8859-1': 'windows-1252', // what browsers actually do with this label
  ascii: 'utf-8',
  'us-ascii': 'utf-8',
  none: 'utf-8',
};

export function normaliseCharset(charset: string | null): string {
  if (!charset) return 'utf-8';
  const name = charset.trim().toLowerCase();
  return ALIASES[name] ?? name;
}

/**
 * Decode a fetched page the way a browser would.
 *
 * Header first, since it wins in the spec, then the meta declaration, then
 * UTF-8. An encoding TextDecoder does not know falls back to UTF-8 rather than
 * throwing: mangled text still lets the watch run, and an exception loses it.
 */
export function decodePage(bytes: ArrayBuffer, contentType: string | null): string {
  const declared = charsetFromHeader(contentType);
  if (declared) return decodeWith(bytes, normaliseCharset(declared));

  // Latin-1 maps every byte to a character, so the head is always readable
  // enough to find a meta tag in, whatever the real encoding turns out to be.
  const head = decodeWith(bytes.slice(0, 2048), 'windows-1252');
  return decodeWith(bytes, normaliseCharset(charsetFromMeta(head)));
}

function decodeWith(bytes: ArrayBuffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
