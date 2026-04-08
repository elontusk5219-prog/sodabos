"""Shared text chunking utilities."""

import re


def split_chunks(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    """Split text into overlapping chunks for FTS indexing.

    Uses paragraph-aware splitting: prefers breaking at double-newlines,
    falls back to hard truncation for oversized paragraphs.

    Args:
        text: Input text to split
        chunk_size: Maximum characters per chunk
        overlap: Character overlap between chunks

    Returns:
        List of text chunks
    """
    if not text or not text.strip():
        return []

    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[str] = []
    buf = ""

    for para in paragraphs:
        if len(buf) + len(para) + 2 <= chunk_size:
            buf = (buf + "\n\n" + para).lstrip()
        else:
            if buf:
                chunks.append(buf)
                # Overlap: keep tail of previous buffer
                buf = buf[-overlap:] + "\n\n" + para
            else:
                # Single paragraph exceeds chunk_size, force-split
                while len(para) > chunk_size:
                    chunks.append(para[:chunk_size])
                    para = para[chunk_size - overlap:]
                buf = para

    if buf.strip():
        chunks.append(buf.strip())

    return chunks
