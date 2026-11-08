// The studyat-media://<kind>/<id> protocol: the renderer's only file access (spec §3.2, §7;
// study-dev rule 5). It streams DB-registered local media with HTTP Range support. The resolver
// maps (kind, id) to a path the user added; nothing else on disk is ever reachable.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";

export const MEDIA_SCHEME = "studyat-media";

export type MediaKind = "space" | "sound" | "chime";
export type MediaResolver = (kind: MediaKind, id: number) => string | null;

const KINDS: readonly string[] = ["space", "sound", "chime"];

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

/** Must run before app.ready: gives the scheme the privileges media streaming needs. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

function fail(
  status: number,
  message: string,
  headers?: Record<string, string>,
): Response {
  return new Response(message, { status, headers });
}

/** Parses the raw URL string (no dot-segment normalisation): exactly `<kind>/<digits>`. */
function parseMediaUrl(url: string): { kind: MediaKind; id: number } | null {
  const m = /^studyat-media:\/\/([^/?#]+)\/(\d+)$/i.exec(url);
  if (m === null) return null;
  const kind = (m[1] ?? "").toLowerCase();
  const id = Number(m[2]);
  if (!KINDS.includes(kind) || !Number.isSafeInteger(id) || id <= 0)
    return null;
  return { kind: kind as MediaKind, id };
}

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/** A single `bytes=a-b`, `a-` or `-n` range; a malformed header is ignored (full body). */
function parseRange(header: string | null, size: number): ByteRange {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

export async function handleMediaRequest(
  req: Request,
  resolve: MediaResolver,
): Promise<Response> {
  const target = parseMediaUrl(req.url);
  if (target === null) return fail(400, "Bad media URL");

  const path = resolve(target.kind, target.id);
  if (path === null) return fail(404, "Unknown media");

  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) return fail(404, "Media file missing");
    size = info.size;
  } catch {
    return fail(404, "Media file missing");
  }

  const type =
    CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const range = parseRange(req.headers.get("Range"), size);
  if (range === "unsatisfiable") {
    return fail(416, "Range not satisfiable", {
      "Content-Range": `bytes */${size}`,
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
  };
  if (size === 0)
    return new Response(null, {
      status: 200,
      headers: { ...headers, "Content-Length": "0" },
    });

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers["Content-Length"] = String(end - start + 1);
  if (range !== null)
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;

  const body =
    req.method === "HEAD"
      ? null
      : (Readable.toWeb(
          createReadStream(path, { start, end }),
        ) as ReadableStream<Uint8Array>);
  return new Response(body, { status: range === null ? 200 : 206, headers });
}

/** Wires the protocol once the app is ready. */
export function installMediaProtocol(resolve: MediaResolver): void {
  protocol.handle(MEDIA_SCHEME, (req) => handleMediaRequest(req, resolve));
}
