"""
Validate every LinkedIn Page URL from Customers.xlsx (Active sheet).

Heuristics, in order:
  1. Empty / missing URL                       → flag MISSING
  2. Non-linkedin.com host                      → flag NON-LINKEDIN
  3. /search/results/ URL                       → flag SEARCH-PLACEHOLDER
  4. HTTP fetch with browser UA, follow redirects:
       - final URL contains /company/<slug>/    → OK
       - final URL is /signup, /authwall,
         /uas/login                             → OK (page exists, just gated)
       - status 4xx                             → BROKEN (HTTP <code>)
       - response title 'Page Not Found'        → BROKEN (deadlink)
       - else                                   → INSPECT (with details)

Also reports rows whose URLs are duplicates of another row.
"""
import sys
from urllib.parse import urlparse, unquote
import pandas as pd
import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}


def check(url: str) -> tuple[str, str]:
    """Returns (verdict, detail)."""
    if pd.isna(url) or not str(url).strip():
        return "MISSING", "no url provided"
    u = str(url).strip()
    host = urlparse(u).netloc.lower()

    if "linkedin.com" not in host:
        return "NON-LINKEDIN", f"host={host}"

    if "/search/results/" in u:
        return "SEARCH-PLACEHOLDER", "this is a LinkedIn search URL, not a company page"

    try:
        r = requests.get(
            u,
            headers=HEADERS,
            allow_redirects=True,
            timeout=15,
            stream=True,
        )
    except requests.RequestException as e:
        return "INSPECT", f"network: {type(e).__name__}: {str(e)[:100]}"

    code = r.status_code
    final = r.url
    # Pull first 8KB only — enough to see title
    body = ""
    try:
        body = next(r.iter_content(chunk_size=8192, decode_unicode=True)) or ""
        body = body.lower() if isinstance(body, str) else body.decode("utf-8", "ignore").lower()
    except Exception:
        pass
    r.close()

    if code == 999:
        # LinkedIn anti-bot — uninformative, treat as inspect with note
        return "INSPECT", f"HTTP 999 (LinkedIn bot block) — manual check needed; URL = {u}"
    if code == 404 or code == 410:
        return "BROKEN", f"HTTP {code}"
    if 400 <= code < 500:
        return "BROKEN", f"HTTP {code}"
    if 500 <= code < 600:
        return "INSPECT", f"HTTP {code} (server error)"

    # 2xx / 3xx
    final_l = final.lower()
    if any(x in final_l for x in ["/signup", "/authwall", "/uas/login", "/login"]):
        # LinkedIn gated — page likely exists
        return "OK", f"gated → {final}"
    if "page not found" in body or "this page doesn’t exist" in body or "this page doesn't exist" in body:
        return "BROKEN", "LinkedIn served 'Page not found'"
    if "/company/" in final_l or "/school/" in final_l:
        return "OK", f"final={final}"
    # Redirected away — usually means slug not found
    if final_l.rstrip("/") in ("https://www.linkedin.com", "https://linkedin.com"):
        return "BROKEN", f"redirected to LinkedIn homepage ({final})"
    return "INSPECT", f"HTTP {code} → {final}"


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/amitf/Downloads/Customers.xlsx"
    df = pd.read_excel(path, sheet_name="Active")

    # Track duplicates
    url_counts: dict[str, list[str]] = {}
    for _, row in df.iterrows():
        u = str(row["LinkedIn Page"]).strip() if pd.notna(row["LinkedIn Page"]) else ""
        if u:
            url_counts.setdefault(u, []).append(str(row["Customer"]))

    print(f"checking {len(df)} customer rows…\n")
    rows = []
    for idx, row in df.iterrows():
        name = str(row["Customer"]).strip()
        url = row["LinkedIn Page"]
        verdict, detail = check(url)
        rows.append((idx + 1, name, str(url).strip() if pd.notna(url) else "", verdict, detail))
        print(f"  [{verdict:<18}] #{idx+1:>2} {name[:38]:<40} {detail[:80]}")

    print("\n" + "=" * 80)
    print("ISSUES BY CATEGORY\n")

    by_verdict: dict[str, list] = {}
    for r in rows:
        by_verdict.setdefault(r[3], []).append(r)

    for v in ["BROKEN", "SEARCH-PLACEHOLDER", "NON-LINKEDIN", "MISSING", "INSPECT"]:
        if v not in by_verdict:
            continue
        print(f"\n── {v} ({len(by_verdict[v])}) ──")
        for r in by_verdict[v]:
            print(f"  #{r[0]:>2} {r[1]:<40} {r[2]}")
            print(f"       {r[4]}")

    # Duplicates
    dup_urls = {u: names for u, names in url_counts.items() if len(names) > 1}
    if dup_urls:
        print(f"\n── DUPLICATE URLS ({len(dup_urls)}) ──")
        for u, names in dup_urls.items():
            print(f"  {u}")
            for n in names:
                print(f"    · {n}")

    print(f"\nOK: {len(by_verdict.get('OK', []))} of {len(rows)}")


if __name__ == "__main__":
    main()
