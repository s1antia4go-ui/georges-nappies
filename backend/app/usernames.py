"""Username rules and impersonation protection.

Usernames are a single ASCII word: a letter, then letters, digits or underscores, 3-20 chars.
Restricting to ASCII removes Unicode homoglyph attacks (Cyrillic "а" vs Latin "a").
On top of that, every name is folded to a *canonical skeleton* that merges characters people
confuse (0/o, 1/l/i, rn/m, vv/w, underscores...). The skeleton is unique in the database, so
"Ge0rge", "george_" and "GEORGE" can't be registered once "george" exists.
"""
import re

USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{2,19}$")

_MULTI = [("rn", "m"), ("vv", "w"), ("cl", "d")]
_SINGLE = str.maketrans({"0": "o", "1": "l", "i": "l", "|": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "2": "z"})

# Names that would let someone pose as the platform or its staff.
_RESERVED = {
    "admin", "administrator", "root", "system", "support", "help", "helpdesk", "moderator", "mod", "mods",
    "staff", "official", "security", "safety", "trust", "team", "georgesnappies", "georgenappies",
    "nappies", "nappiesteam", "noreply", "postmaster", "abuse", "billing", "verified", "everyone", "here",
    "null", "undefined", "anonymous", "deleted", "deleteduser", "api", "www", "settings", "login", "logout",
}
_RESERVED_SUBSTRINGS = ("admin", "moderator", "official", "support", "georgesnappies", "staff")

# Short list of slurs/abusive terms rejected as substrings (kept intentionally conservative,
# matched against the canonical skeleton so leetspeak doesn't bypass it).
_ABUSIVE = ("nigger", "nigga", "faggot", "retard", "kike", "spic", "chink", "tranny", "rape", "nazi", "hitler", "kkk", "cunt")


def canonical(username: str) -> str:
    s = username.lower().replace("_", "")
    s = s.translate(_SINGLE)
    for a, b in _MULTI:
        s = s.replace(a, b)
    # collapse repeated characters so "georgee" ~ "george"
    s = re.sub(r"(.)\1+", r"\1", s)
    return s


def validate(username: str) -> str | None:
    """Return an error message, or None if the name is acceptable."""
    if not USERNAME_RE.match(username):
        if len(username) < 3:
            return "Usernames need at least 3 characters."
        if len(username) > 20:
            return "Usernames can be at most 20 characters."
        if not username[:1].isalpha():
            return "Usernames must start with a letter."
        return "Use one word: letters, numbers and underscores only."
    canon = canonical(username)
    plain = username.lower().replace("_", "")
    if plain in _RESERVED or canon in {canonical(r) for r in _RESERVED}:
        return "That username is reserved."
    if any(sub in plain or canonical(sub) in canon for sub in _RESERVED_SUBSTRINGS):
        return "That username could be mistaken for an official account."
    for w in _ABUSIVE:
        # Long terms are matched anywhere; short ones only as the whole name, to avoid
        # rejecting innocent names ("grape", "spice") that merely contain them.
        hit = (w in plain or canonical(w) in canon) if len(w) >= 5 else (plain == w or canon == canonical(w))
        if hit:
            return "That username isn't allowed."
    return None
