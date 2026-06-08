"""Image search + safe fetch for microcard illustrations.

Source: Openverse (https://api.openverse.org) — aggregates openly-licensed
images (Wikimedia Commons, Flickr CC, etc.), no API key required. Chosen
images are downloaded server-side and stored as own-origin assets (the app's
CSP forbids hot-linking third-party image hosts), so this module also provides
an SSRF-hardened fetch used by the proxy and import endpoints.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import urllib.parse
import urllib.request
from io import BytesIO
from typing import Any, Dict, List, Optional

# Wikimedia Commons (MediaWiki API) is the primary source: no API key, generous
# anonymous limits, openly-licensed media with attribution metadata.
WIKIMEDIA_API = "https://commons.wikimedia.org/w/api.php"
# Openverse aggregates more sources but its ANONYMOUS tier is heavily throttled
# (returns 401 after a few calls), so we only use it when a token is configured.
OPENVERSE_API = "https://api.openverse.org/v1/images/"
OPENVERSE_TOKEN = (os.environ.get("ACTRA_OPENVERSE_TOKEN") or "").strip()
USER_AGENT = "ACTRA-microcards/1.0 (+https://actra.site)"
_IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|gif|webp)$", re.IGNORECASE)
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
FETCH_TIMEOUT = 10  # seconds

# Pillow format -> safe file extension / mime we are willing to store & serve.
_ALLOWED_FORMATS = {
    "JPEG": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "GIF": ("gif", "image/gif"),
    "WEBP": ("webp", "image/webp"),
}


class ImageSearchError(Exception):
    """Upstream search provider failed."""


class ImageFetchError(Exception):
    """A specific image could not be safely fetched/validated. str() is a code."""


def _is_public_host(host: str) -> bool:
    """True only if every resolved address for `host` is a public, routable IP.

    Blocks SSRF to loopback/private/link-local/reserved ranges (incl. the cloud
    metadata endpoint 169.254.169.254, which is link-local).
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        ip = info[4][0]
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        if (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_multicast or addr.is_unspecified):
            return False
    return True


def _validate_fetch_url(url: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(url or "")
    if parsed.scheme not in ("http", "https"):
        raise ImageFetchError("bad_scheme")
    if not parsed.hostname:
        raise ImageFetchError("bad_host")
    if not _is_public_host(parsed.hostname):
        raise ImageFetchError("blocked_host")
    return parsed


def _get_json(url: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})}
    )
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _strip_html(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text = re.sub(r"<[^>]+>", "", str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def search_images(query: str, page: int = 1, page_size: int = 24) -> Dict[str, Any]:
    """Search openly-licensed images with attribution. Wikimedia Commons primary;
    Openverse only when a token is configured (anonymous Openverse is throttled).
    """
    q = (query or "").strip()
    if not q:
        return {"results": [], "page": 1, "page_count": 0}
    page = max(1, int(page or 1))
    page_size = min(50, max(1, int(page_size or 24)))
    if OPENVERSE_TOKEN:
        try:
            return _search_openverse(q, page, page_size)
        except Exception:  # noqa: BLE001 - fall through to Wikimedia on any failure
            pass
    return _search_wikimedia(q, page, page_size)


def _search_wikimedia(q: str, page: int, page_size: int) -> Dict[str, Any]:
    params = urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search",
        "gsrsearch": q, "gsrnamespace": "6", "gsrlimit": str(page_size),
        "gsroffset": str((page - 1) * page_size),
        "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": "320",
    })
    try:
        data = _get_json(f"{WIKIMEDIA_API}?{params}")
    except Exception as exc:  # noqa: BLE001
        raise ImageSearchError(str(exc))
    pages = ((data.get("query") or {}).get("pages") or {})
    items = sorted(pages.values(), key=lambda p: p.get("index", 0))
    results = [r for r in (_normalize_wikimedia(p) for p in items) if r]
    has_more = "continue" in data
    return {"results": results, "page": page, "page_count": page + 1 if has_more else page}


def _normalize_wikimedia(p: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    ii = (p.get("imageinfo") or [{}])[0]
    full = ii.get("url")
    if not full or not _IMAGE_EXT_RE.search(full):  # skip PDFs/audio/video
        return None
    em = ii.get("extmetadata") or {}
    def meta(k):
        return (em.get(k) or {}).get("value")
    return {
        "thumb": ii.get("thumburl") or full,
        "full": full,
        "width": ii.get("width"),
        "height": ii.get("height"),
        "title": re.sub(r"^File:", "", p.get("title") or ""),
        "attribution": {
            "author": _strip_html(meta("Artist")),
            "license": _strip_html(meta("LicenseShortName")),
            "license_url": meta("LicenseUrl"),
            "source_page": ii.get("descriptionurl"),
            "source": "Wikimedia Commons",
        },
    }


def _search_openverse(q: str, page: int, page_size: int) -> Dict[str, Any]:
    params = urllib.parse.urlencode({"q": q, "page": page, "page_size": page_size})
    data = _get_json(f"{OPENVERSE_API}?{params}",
                     headers={"Authorization": f"Bearer {OPENVERSE_TOKEN}"})
    return {
        "results": [r for r in (_normalize_openverse(x) for x in data.get("results") or []) if r],
        "page": page,
        "page_count": int(data.get("page_count") or 0),
    }


def _normalize_openverse(r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    full = r.get("url")
    if not full:
        return None
    lic = (r.get("license") or "").upper()
    ver = r.get("license_version") or ""
    return {
        "thumb": r.get("thumbnail") or full,
        "full": full,
        "width": r.get("width"),
        "height": r.get("height"),
        "title": r.get("title"),
        "attribution": {
            "author": r.get("creator") or None,
            "license": (f"{lic} {ver}".strip()) or None,
            "license_url": r.get("license_url") or None,
            "source_page": r.get("foreign_landing_url") or None,
            "source": r.get("source") or None,
        },
    }


def fetch_image(url: str, max_bytes: int = MAX_IMAGE_BYTES):
    """SSRF-safe download + validate. Returns (bytes, mime_type, extension).

    Raises ImageFetchError(code) on any policy violation.
    """
    _validate_fetch_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        resp = urllib.request.urlopen(req, timeout=FETCH_TIMEOUT)
    except Exception as exc:  # noqa: BLE001
        raise ImageFetchError("fetch_failed:" + str(exc))
    with resp:
        ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype and not ctype.startswith("image/"):
            raise ImageFetchError("not_an_image")
        data = resp.read(max_bytes + 1)
    if not data:
        raise ImageFetchError("empty")
    if len(data) > max_bytes:
        raise ImageFetchError("too_large")
    # Decode-validate with Pillow (defends against content-type spoofing).
    from PIL import Image  # local import: keeps module import cheap
    try:
        with Image.open(BytesIO(data)) as im:
            im.verify()
        with Image.open(BytesIO(data)) as im2:
            fmt = im2.format or ""
    except Exception:  # noqa: BLE001
        raise ImageFetchError("invalid_image")
    if fmt not in _ALLOWED_FORMATS:
        raise ImageFetchError("unsupported_format")
    ext, mime = _ALLOWED_FORMATS[fmt]
    return data, mime, ext
