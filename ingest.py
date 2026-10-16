"""
Document and Text Ingestion module for Project IDEA.
Extracts clean text, paragraphs, and section anchors from raw text or URLs.
"""
import re
from typing import Dict, List, Any
from bs4 import BeautifulSoup
import httpx

class DocumentIngester:
    @staticmethod
    def parse_text(content: str, title: str = "Raw Input", url: str = "local://input") -> Dict[str, Any]:
        """Parses clean text into sections and paragraphs."""
        lines = content.split("\n")
        sections = []
        current_section = {"anchor": "Introduction", "text": []}

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue
            # Markdown header detection
            if line_str.startswith("#"):
                if current_section["text"]:
                    current_section["content"] = "\n".join(current_section["text"])
                    sections.append(current_section)
                anchor_name = line_str.lstrip("#").strip()
                current_section = {"anchor": anchor_name, "text": []}
            else:
                current_section["text"].append(line_str)

        if current_section["text"]:
            current_section["content"] = "\n".join(current_section["text"])
            sections.append(current_section)

        full_text = "\n\n".join(s["content"] for s in sections) if sections else content

        return {
            "title": title,
            "url": url,
            "full_text": full_text,
            "sections": sections
        }

    @staticmethod
    async def fetch_url(url: str) -> Dict[str, Any]:
        """Fetches and extracts clean text from a web URL."""
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text

        soup = BeautifulSoup(html, "html.parser")
        # Remove script and style elements
        for element in soup(["script", "style", "nav", "footer", "header"]):
            element.decompose()

        title = soup.title.string.strip() if soup.title and soup.title.string else url

        # Extract text blocks
        paragraphs = [p.get_text().strip() for p in soup.find_all(["p", "h1", "h2", "h3", "li"])]
        clean_text = "\n\n".join(p for p in paragraphs if p)

        return DocumentIngester.parse_text(clean_text, title=title, url=url)
