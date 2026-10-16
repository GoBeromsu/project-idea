import asyncio
import ipaddress
import re
import socket
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from bs4 import BeautifulSoup
import httpx


MAX_PAYLOAD_BYTES = 2_000_000
MIN_EXTRACTED_TEXT_CHARS = 30
USER_AGENT = "ProjectIDEA-KnowledgeIngester/1.0 (+https://github.com/project-idea)"

BINARY_CONTENT_PREFIXES = (
    "application/pdf",
    "application/octet-stream",
    "application/zip",
    "application/gzip",
    "application/x-gzip",
    "application/x-tar",
    "application/x-rar",
    "application/x-7z-compressed",
    "application/msword",
    "application/vnd.",
    "image/",
    "audio/",
    "video/",
    "font/",
)

ALLOWED_TEXT_CONTENT_TYPES = (
    "text/",
    "application/xhtml+xml",
    "application/xml",
    "application/json",
)


class _AwaitableDict(dict):
    def __await__(self):
        async def _coro():
            return dict(self)

        return _coro().__await__()


def _validate_ip_address(ip_str: str) -> None:
    clean_ip = ip_str.split("%")[0].strip()
    try:
        ip_obj = ipaddress.ip_address(clean_ip)
    except ValueError as exc:
        raise ValueError("Blocked unsafe or non-public URL host") from exc

    if (
        ip_obj.is_private
        or ip_obj.is_loopback
        or ip_obj.is_link_local
        or ip_obj.is_multicast
        or ip_obj.is_reserved
        or ip_obj.is_unspecified
    ):
        raise ValueError("Blocked unsafe or non-public URL host")


def validate_public_url(url: str) -> str:
    if not url or not isinstance(url, str) or not url.strip():
        raise ValueError("Blocked unsafe or non-public URL host: URL is empty")

    cleaned_url = url.strip()
    parsed = urlparse(cleaned_url)

    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise ValueError("Blocked unsafe or non-public URL host: URL must use http or https with a valid hostname")

    hostname = parsed.hostname.strip().lower().rstrip(".")
    if (
        not hostname
        or hostname in ("localhost", "localhost.localdomain", "metadata.google.internal", "metadata")
        or hostname.endswith(".local")
        or hostname.endswith(".internal")
        or hostname.endswith(".localhost")
    ):
        raise ValueError("Blocked unsafe or non-public URL host")

    try:
        ipaddress.ip_address(hostname.split("%")[0])
        is_ip_literal = True
    except ValueError:
        is_ip_literal = False

    if is_ip_literal:
        _validate_ip_address(hostname)
        return cleaned_url

    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise ValueError(f"Blocked unsafe or non-public URL host: DNS resolution failed for {hostname}") from exc

    if not addr_info:
        raise ValueError("Blocked unsafe or non-public URL host")

    for entry in addr_info:
        sockaddr = entry[4]
        if sockaddr and len(sockaddr) >= 1:
            _validate_ip_address(str(sockaddr[0]))

    return cleaned_url


def _is_binary_content_type(content_type_header: str, raw_bytes: bytes) -> bool:
    if raw_bytes.startswith(b"%PDF-"):
        return True
    mime = (content_type_header or "").lower().split(";")[0].strip()
    if not mime:
        return False
    if any(mime.startswith(prefix) for prefix in BINARY_CONTENT_PREFIXES):
        return True
    if not any(mime.startswith(allowed) for allowed in ALLOWED_TEXT_CONTENT_TYPES):
        return True
    return False


def _extract_html_document(html: str, source_url: str, resolved_url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "noscript", "svg", "iframe"]):
        tag.decompose()

    parsed_resolved = urlparse(resolved_url)
    is_arxiv = "arxiv.org" in (parsed_resolved.hostname or "").lower()

    title = ""
    if is_arxiv:
        h1_title = soup.find("h1", class_=lambda c: c and "title" in c)
        if h1_title:
            for desc in h1_title.find_all("span", class_="descriptor"):
                desc.decompose()
            title = re.sub(r"^\s*Title:\s*", "", h1_title.get_text(" ", strip=True), flags=re.IGNORECASE).strip()

    if not title and soup.title and soup.title.string:
        raw_title = soup.title.string.strip()
        if is_arxiv:
            raw_title = re.sub(r"^\[[^\]]+\]\s*", "", raw_title).strip()
        title = re.sub(r"^\s*Title:\s*", "", raw_title, flags=re.IGNORECASE).strip()

    if not title:
        first_h1 = soup.find("h1")
        if first_h1:
            title = re.sub(r"^\s*Title:\s*", "", first_h1.get_text(" ", strip=True), flags=re.IGNORECASE).strip()

    if not title:
        title = resolved_url or source_url

    section_anchors: List[str] = []
    for heading in soup.find_all(["h1", "h2", "h3"]):
        for desc in heading.find_all("span", class_="descriptor"):
            desc.decompose()
        heading_text = re.sub(r"\s+", " ", heading.get_text(" ", strip=True)).strip()
        heading_text = re.sub(r"^\s*Title:\s*", "", heading_text, flags=re.IGNORECASE).strip()
        if heading_text and heading_text not in section_anchors:
            section_anchors.append(heading_text)

    abstract_block = soup.find("blockquote", class_=lambda c: c and "abstract" in c)
    if abstract_block and "Abstract" not in section_anchors:
        section_anchors.insert(0, "Abstract")

    if not section_anchors:
        section_anchors.append("Introduction")

    sections: List[Dict[str, str]] = []
    text_blocks: List[str] = []

    if is_arxiv and abstract_block:
        authors_div = soup.find("div", class_=lambda c: c and "authors" in c)
        if authors_div:
            for desc in authors_div.find_all("span", class_="descriptor"):
                desc.decompose()
            authors_text = re.sub(r"\s+", " ", authors_div.get_text(" ", strip=True)).strip()
            authors_text = re.sub(r"^\s*Authors?:\s*", "", authors_text, flags=re.IGNORECASE).strip()
            if authors_text:
                text_blocks.append(f"Authors: {authors_text}")

        subjects_el = soup.find("td", class_=lambda c: c and "subjects" in c) or soup.find(
            "span", class_=lambda c: c and "primary-subject" in c
        )
        if subjects_el:
            subjects_text = re.sub(r"\s+", " ", subjects_el.get_text(" ", strip=True)).strip()
            if subjects_text:
                text_blocks.append(f"Subjects: {subjects_text}")

        for desc in abstract_block.find_all("span", class_="descriptor"):
            desc.decompose()
        abstract_text = re.sub(r"\s+", " ", abstract_block.get_text(" ", strip=True)).strip()
        abstract_text = re.sub(r"^\s*Abstract:\s*", "", abstract_text, flags=re.IGNORECASE).strip()
        if abstract_text:
            text_blocks.append(f"[Section: Abstract]\n{abstract_text}")
            sections.append({"anchor": "Abstract", "content": abstract_text})

    for tag in soup(["nav", "footer"]):
        tag.decompose()

    current_anchor = section_anchors[0] if section_anchors else "Introduction"
    current_lines: List[str] = []

    elements = soup.find_all(["h1", "h2", "h3", "p", "li", "blockquote"])
    if elements:
        for el in elements:
            if is_arxiv and abstract_block and el == abstract_block:
                continue
            tag_name = el.name.lower()
            el_text = re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()
            if not el_text:
                continue
            if tag_name in ("h1", "h2", "h3"):
                el_text = re.sub(r"^\s*Title:\s*", "", el_text, flags=re.IGNORECASE).strip()
                if current_lines:
                    sections.append({"anchor": current_anchor, "content": "\n".join(current_lines)})
                    current_lines = []
                current_anchor = el_text or current_anchor
                text_blocks.append(f"[Section: {current_anchor}]")
            else:
                current_lines.append(el_text)
                text_blocks.append(el_text)
        if current_lines:
            sections.append({"anchor": current_anchor, "content": "\n".join(current_lines)})
    else:
        fallback_text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()
        if fallback_text:
            text_blocks.append(fallback_text)
            sections.append({"anchor": current_anchor, "content": fallback_text})

    clean_text = "\n\n".join(block for block in text_blocks if block).strip()
    if len(clean_text) < MIN_EXTRACTED_TEXT_CHARS:
        fallback_full = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()
        if len(fallback_full) >= MIN_EXTRACTED_TEXT_CHARS:
            clean_text = fallback_full

    if len(clean_text) < MIN_EXTRACTED_TEXT_CHARS:
        raise ValueError("Extracted source text is empty or unreadable")

    return {
        "url": source_url,
        "resolved_url": resolved_url,
        "title": title,
        "full_text": clean_text,
        "section_anchors": section_anchors,
        "sections": sections,
    }


async def fetch_and_parse_url(url: str, timeout: float = 15.0) -> Dict[str, Any]:
    validated_url = validate_public_url(url)

    parsed_initial = urlparse(validated_url)
    if "arxiv.org" in (parsed_initial.hostname or "").lower() and parsed_initial.path.startswith("/pdf/"):
        raise ValueError(
            "Unsupported binary content type; please provide a public web page or article URL (use https://arxiv.org/abs/... instead of /pdf/)"
        )

    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1"}
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
            max_redirects=5,
            headers=headers,
        ) as client:
            resp = await client.get(validated_url)
    except ValueError:
        raise
    except httpx.HTTPError as exc:
        raise ValueError(f"Failed to fetch public URL: {exc}") from exc

    for hist_resp in getattr(resp, "history", []) or []:
        validate_public_url(str(hist_resp.url))

    resolved_url = str(resp.url)
    validate_public_url(resolved_url)

    if resp.status_code >= 400:
        raise ValueError(f"Upstream URL returned HTTP {resp.status_code}")

    content_length_hdr = resp.headers.get("content-length")
    if content_length_hdr:
        try:
            if int(content_length_hdr) > MAX_PAYLOAD_BYTES:
                raise ValueError("Response payload exceeds maximum allowed size of 2,000,000 bytes")
        except ValueError as exc:
            if "exceeds maximum" in str(exc):
                raise

    raw_bytes = resp.content
    if len(raw_bytes) > MAX_PAYLOAD_BYTES:
        raise ValueError("Response payload exceeds maximum allowed size of 2,000,000 bytes")

    content_type = resp.headers.get("content-type", "")
    if _is_binary_content_type(content_type, raw_bytes):
        raise ValueError("Unsupported binary content type; please provide a public web page or article URL")

    html_text = resp.text
    if not html_text or len(html_text.strip()) < MIN_EXTRACTED_TEXT_CHARS:
        raise ValueError("Extracted source text is empty or unreadable")

    return _extract_html_document(html_text, source_url=validated_url, resolved_url=resolved_url)


def _parse_raw_text_document(
    content: str,
    title: Optional[str] = None,
    url: Optional[str] = None,
) -> Dict[str, Any]:
    if not content or not content.strip():
        raise ValueError("Extracted source text is empty or unreadable")

    raw_stripped = content.strip()
    if len(raw_stripped) < 10:
        raise ValueError("Extracted source text is empty or unreadable")

    doc_url = url.strip() if (url and url.strip()) else "local://input"
    if doc_url != "local://input":
        validate_public_url(doc_url)

    doc_title = title.strip() if (title and title.strip()) else "Pasted Technical Note"

    lines = content.split("\n")
    sections: List[Dict[str, Any]] = []
    section_anchors: List[str] = []
    current_section: Dict[str, Any] = {"anchor": "Introduction", "text": []}

    for line in lines:
        line_str = line.strip()
        if not line_str:
            continue
        sec_match = re.match(r"^\[Section:\s*(.+?)\]$", line_str, flags=re.IGNORECASE)
        if line_str.startswith("#") or sec_match:
            if current_section["text"]:
                current_section["content"] = "\n".join(current_section["text"])
                sections.append({"anchor": current_section["anchor"], "content": current_section["content"]})
            anchor_name = sec_match.group(1).strip() if sec_match else line_str.lstrip("#").strip()
            if anchor_name and anchor_name not in section_anchors:
                section_anchors.append(anchor_name)
            current_section = {"anchor": anchor_name or "Section", "text": []}
        else:
            current_section["text"].append(line_str)

    if current_section["text"]:
        current_section["content"] = "\n".join(current_section["text"])
        sections.append({"anchor": current_section["anchor"], "content": current_section["content"]})
        if current_section["anchor"] not in section_anchors:
            section_anchors.append(current_section["anchor"])

    if not section_anchors:
        section_anchors.append("Introduction")

    full_text = "\n\n".join(s["content"] for s in sections) if sections else raw_stripped

    return _AwaitableDict(
        {
            "url": doc_url,
            "resolved_url": doc_url,
            "title": doc_title,
            "full_text": full_text,
            "section_anchors": section_anchors,
            "sections": sections,
        }
    )


async def _prepare_url_async(url: str, title: Optional[str] = None) -> Dict[str, Any]:
    doc = await fetch_and_parse_url(url)
    if (
        title
        and title.strip()
        and title.strip() != "Pasted Technical Note"
        and doc.get("title") == doc.get("resolved_url")
    ):
        doc["title"] = title.strip()
    return _AwaitableDict(doc)


def prepare_document(
    text: Optional[str] = None,
    url: Optional[str] = None,
    title: Optional[str] = None,
) -> Any:
    has_url = bool(url and url.strip())
    has_text = bool(text and text.strip())

    if not has_url and not has_text:
        raise ValueError("Provide either a valid public 'url' or non-empty 'text'")

    if has_url:
        validate_public_url(url.strip())

    if has_text and not has_url:
        return _parse_raw_text_document(content=text, title=title, url=None)

    if has_text and has_url:
        return _parse_raw_text_document(content=text, title=title, url=url)

    try:
        asyncio.get_running_loop()
        in_running_loop = True
    except RuntimeError:
        in_running_loop = False

    if in_running_loop:
        return _prepare_url_async(url.strip(), title=title)
    return asyncio.run(_prepare_url_async(url.strip(), title=title))


class DocumentIngester:
    @staticmethod
    def parse_text(content: str, title: str = "Raw Input", url: str = "local://input") -> Dict[str, Any]:
        return dict(_parse_raw_text_document(content=content, title=title, url=url))

    @staticmethod
    async def fetch_url(url: str) -> Dict[str, Any]:
        return await fetch_and_parse_url(url)
