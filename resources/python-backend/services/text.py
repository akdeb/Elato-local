import re


def sanitize_spoken_text(text: str, *, allow_paralinguistic: bool = True) -> str:
    if not text:
        return text

    allowed_cues = {
        "laugh",
        "chuckle",
        "sigh",
        "gasp",
        "cough",
        "clear throat",
        "sniff",
        "groan",
        "shush",
    }

    text = text.replace("`", "")
    text = text.replace("**", "")
    text = text.replace("*", "")
    text = text.replace("__", "")
    text = text.replace("_", "")

    if allow_paralinguistic:
        def keep_or_drop(match: re.Match) -> str:
            tag = (match.group(1) or "").strip()
            tag_norm = " ".join(tag.lower().split())
            if tag_norm in allowed_cues:
                return f"[{tag_norm}]"
            return ""

        text = re.sub(r"\[([^\]]+)\]", keep_or_drop, text)
    else:
        text = re.sub(r"\[[^\]]+\]", "", text)

    text = re.sub(r"\s{2,}", " ", text).strip()
    return text
