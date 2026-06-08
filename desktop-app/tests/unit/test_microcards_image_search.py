import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services import microcards_image_search as img


class _FakeResp:
    def __init__(self, body: bytes, content_type: str = "application/json"):
        self._body = body
        self.headers = {"Content-Type": content_type}
        # mimic http.client.HTTPMessage.get
        self.headers = type("H", (), {"get": lambda self, k, d=None: {"Content-Type": content_type}.get(k, d)})()

    def read(self, n: int = -1):
        return self._body if n < 0 else self._body[:n]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _png_bytes():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


# ── SSRF guard ────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,code", [
    ("ftp://example.com/x.png", "bad_scheme"),
    ("file:///etc/passwd", "bad_scheme"),
    ("http://127.0.0.1/x.png", "blocked_host"),
    ("http://localhost/x.png", "blocked_host"),
    ("http://169.254.169.254/latest/meta-data/", "blocked_host"),  # cloud metadata
    ("http://10.0.0.5/x.png", "blocked_host"),
    ("https:///nohost.png", "bad_host"),
])
def test_fetch_image_blocks_unsafe_urls(url, code):
    with pytest.raises(img.ImageFetchError) as ei:
        img.fetch_image(url)
    assert str(ei.value) == code


# ── Safe fetch happy-path + validation ────────────────────────────────

def test_fetch_image_accepts_real_png(monkeypatch):
    monkeypatch.setattr(img, "_is_public_host", lambda h: True)
    monkeypatch.setattr(img.urllib.request, "urlopen",
                        lambda req, timeout=None: _FakeResp(_png_bytes(), "image/png"))
    data, mime, ext = img.fetch_image("https://cdn.example.org/cat.png")
    assert mime == "image/png" and ext == "png" and len(data) > 0


def test_fetch_image_rejects_non_image_content(monkeypatch):
    monkeypatch.setattr(img, "_is_public_host", lambda h: True)
    monkeypatch.setattr(img.urllib.request, "urlopen",
                        lambda req, timeout=None: _FakeResp(b"<html>nope</html>", "text/html"))
    with pytest.raises(img.ImageFetchError) as ei:
        img.fetch_image("https://evil.example.org/page")
    assert str(ei.value) == "not_an_image"


def test_fetch_image_rejects_spoofed_image(monkeypatch):
    # Declares image/png but body is not a decodable image.
    monkeypatch.setattr(img, "_is_public_host", lambda h: True)
    monkeypatch.setattr(img.urllib.request, "urlopen",
                        lambda req, timeout=None: _FakeResp(b"not really a png", "image/png"))
    with pytest.raises(img.ImageFetchError) as ei:
        img.fetch_image("https://cdn.example.org/fake.png")
    assert str(ei.value) == "invalid_image"


def test_fetch_image_rejects_oversize(monkeypatch):
    monkeypatch.setattr(img, "_is_public_host", lambda h: True)
    big = b"\x89PNG\r\n\x1a\n" + b"0" * (200)
    monkeypatch.setattr(img.urllib.request, "urlopen",
                        lambda req, timeout=None: _FakeResp(big, "image/png"))
    with pytest.raises(img.ImageFetchError) as ei:
        img.fetch_image("https://cdn.example.org/big.png", max_bytes=64)
    assert str(ei.value) == "too_large"


# ── Wikimedia Commons normalization (default source) ──────────────────

def test_search_images_normalizes_wikimedia(monkeypatch):
    payload = {
        "continue": {"gsroffset": 24},  # → has more pages
        "query": {"pages": {
            "111": {
                "index": 1, "title": "File:Cat.jpg",
                "imageinfo": [{
                    "url": "https://upload.wikimedia.org/wikipedia/commons/0/0c/Cat.jpg",
                    "thumburl": "https://upload.wikimedia.org/.../320px-Cat.jpg",
                    "width": 800, "height": 600,
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Cat.jpg",
                    "extmetadata": {
                        "Artist": {"value": "<a href='x'>Jane Doe</a>"},
                        "LicenseShortName": {"value": "CC BY-SA 4.0"},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0/"},
                    },
                }],
            },
            "222": {  # non-image (PDF) → filtered out
                "index": 2, "title": "File:Doc.pdf",
                "imageinfo": [{"url": "https://upload.wikimedia.org/x/Doc.pdf"}],
            },
        }},
    }
    monkeypatch.setattr(img.urllib.request, "urlopen",
                        lambda req, timeout=None: _FakeResp(json.dumps(payload).encode("utf-8")))
    out = img.search_images("cat", page=1)
    assert out["page"] == 1 and out["page_count"] == 2  # continue → page+1
    assert len(out["results"]) == 1  # PDF dropped
    r = out["results"][0]
    assert r["full"].endswith("Cat.jpg")
    assert r["title"] == "Cat.jpg"  # "File:" stripped
    assert r["attribution"]["author"] == "Jane Doe"  # HTML stripped
    assert r["attribution"]["license"] == "CC BY-SA 4.0"
    assert r["attribution"]["source_page"].endswith("File:Cat.jpg")
    assert r["attribution"]["source"] == "Wikimedia Commons"


def test_search_images_empty_query_short_circuits(monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("should not call upstream for empty query")
    monkeypatch.setattr(img.urllib.request, "urlopen", _boom)
    assert img.search_images("   ")["results"] == []
