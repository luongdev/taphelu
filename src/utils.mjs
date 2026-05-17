

export function section(markdown, heading) {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start === -1) return "";
  const bodyStart = start + marker.length;
  const rest = markdown.slice(bodyStart);
  const next = rest.search(/\n#{1,2}\s/);
  return rest.slice(0, next === -1 ? rest.length : next).trim();
}

export function replaceSection(markdown, heading, body) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  const bodyText = String(body).trim();
  const replacement = [
    `## ${heading}`,
    "",
    ...(bodyText ? bodyText.split(/\r?\n/) : []),
    "",
  ];

  if (start === -1) {
    const prefix = markdown.trimEnd();
    const next = prefix ? [...prefix.split(/\r?\n/), "", ...replacement] : replacement;
    return `${next.join("\n").replace(/\n*$/, "")}\n`;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s/.test(lines[index])) {
      end = index;
      break;
    }
  }

  const next = [
    ...lines.slice(0, start),
    ...replacement,
    ...lines.slice(end),
  ];
  return `${next.join("\n").replace(/\n*$/, "")}\n`;
}

export function hasAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

export function formatList(items, emptyText) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${emptyText}`;
}

export function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function titleCase(value) {
  return String(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function unsafeMemory(value) {
  const text = String(value);
  return [
    /(password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*\S+/i,
    /(?:\\?["'])?(password|passwd|token|secret|api[_ -]?key)(?:\\?["'])?\s*[:=]\s*(?:\\?["']).*?(?:\\?["'])/i,
    /authorization\s*:\s*bearer\s+\S+/i,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\b[A-Za-z0-9+/]{48,}={0,2}\b/,
    /cookie\s*[:=]\s*\S+/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    /\braw browser content\b/i,
    /\braw log\b/i,
    /\bfull log\b/i,
  ].some((pattern) => pattern.test(text));
}

export function unsafeBrowserArtifact(value) {
  const text = String(value);
  if (!text) return false;
  return unsafeMemory(text) ||
    text.length > 2000 ||
    /<html[\s>]/i.test(text) ||
    /<!doctype html/i.test(text) ||
    /\b(localStorage|sessionStorage|document\.cookie)\b/i.test(text);
}
