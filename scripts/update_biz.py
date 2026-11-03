"""남양주시 「옥외광고업 현황」 자동 갱신 스크립트

남양주시 누리집 사전행정정보 게시판에서 최신 「○○년 옥외광고업 현황」 게시글을 찾아
첨부 엑셀을 내려받고, 민원인 검색용 data/biz.json 으로 변환합니다.
새 게시글이 없으면 아무것도 바꾸지 않습니다.

사용법:
  python scripts/update_biz.py            # 누리집에서 확인 후 갱신
  python scripts/update_biz.py --file x.xls --ntt 548563 --title "..."   # 내려받은 파일로 변환
"""
import argparse
import datetime as dt
import html
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

BASE = "https://www.nyj.go.kr/www/"
LIST_URL = (BASE + "selectBbsNttList.do?key=2406&bbsNo=35&pageUnit=10"
            "&searchCnd=SJ&searchKrwd=%EC%98%A5%EC%99%B8%EA%B4%91%EA%B3%A0%EC%97%85")
VIEW_URL = BASE + "selectBbsNttView.do?key=2406&bbsNo=35&nttNo={ntt}"
OUT = Path(__file__).resolve().parent.parent / "data" / "biz.json"
UA = {"User-Agent": "Mozilla/5.0 (compatible; nyj-ad-guide/1.0; +https://nyj-ad.github.io/ad-guide/)"}
MIN_ROWS = 20  # 이보다 적으면 잘못 읽은 것으로 보고 갱신하지 않음


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def latest_post():
    """목록에서 가장 최근의 「옥외광고업 현황」 게시글 (nttNo, 제목)"""
    page = get(LIST_URL).decode("utf-8", "replace")
    posts = []
    for m in re.finditer(r'selectBbsNttView\.do\?[^"]*?nttNo=(\d+)[^"]*"[^>]*>(.*?)</a>', page, re.S):
        title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", m.group(2)))).strip()
        if "옥외광고업" in title and "현황" in title:
            posts.append((int(m.group(1)), title))
    if not posts:
        raise SystemExit("목록에서 옥외광고업 현황 게시글을 찾지 못했습니다.")
    return max(posts)


def attachment_url(ntt: int) -> str:
    page = get(VIEW_URL.format(ntt=ntt)).decode("utf-8", "replace")
    links = re.findall(r'(downloadBbsFile\.do\?[^"]+)"', page)
    if not links:
        raise SystemExit("게시글에서 첨부파일을 찾지 못했습니다.")
    return BASE + html.unescape(links[0])


def read_rows(data: bytes):
    """xls / xlsx 모두 읽어서 행 목록 반환"""
    if data[:2] == b"PK":
        import openpyxl
        ws = openpyxl.load_workbook(io.BytesIO(data), data_only=True).worksheets[0]
        return [[("" if v is None else v) for v in row] for row in ws.iter_rows(values_only=True)]
    import xlrd
    sh = xlrd.open_workbook(file_contents=data).sheet_by_index(0)
    return [sh.row_values(r) for r in range(sh.nrows)]


def pick(header, *names):
    for i, h in enumerate(header):
        h = re.sub(r"\s", "", str(h))
        if any(n in h for n in names):
            return i
    return None


def area_of(addr: str) -> str:
    m = re.search(r"남양주시\s+(\S+?[읍면])(?:\s|$)", addr) or re.search(r"\((\S+?동)[,)\s]", addr)
    return m.group(1) if m else "기타"


def convert(data: bytes):
    rows = read_rows(data)
    hi = next((i for i, r in enumerate(rows[:15]) if pick(r, "업소명", "상호", "사업장명") is not None), None)
    if hi is None:
        raise SystemExit("엑셀에서 업소명 머리글을 찾지 못했습니다.")
    head = rows[hi]
    c_name = pick(head, "업소명", "상호", "사업장명")
    c_addr = pick(head, "도로명주소", "소재지", "주소")
    c_biz = pick(head, "영업내용", "업종", "업태")
    items = []
    for r in rows[hi + 1:]:
        name = str(r[c_name]).strip() if c_name is not None else ""
        if not name:
            continue
        addr = str(r[c_addr]).strip() if c_addr is not None else ""
        biz = str(r[c_biz]).strip() if c_biz is not None else ""
        items.append({"name": name, "addr": addr, "area": area_of(addr), "biz": biz})
    return items


def asof_of(title: str) -> str:
    m = re.search(r"(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*기준", title)
    return f"{m.group(1)}. {int(m.group(2))}. {int(m.group(3))}." if m else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--ntt", type=int)
    ap.add_argument("--title", default="")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}

    if a.file:
        ntt, title, data, file_url = a.ntt, a.title, Path(a.file).read_bytes(), ""
    else:
        ntt, title = latest_post()
        print(f"최신 게시글: {ntt} {title}")
        if old.get("ntt") == ntt and not a.force:
            print("새 게시글이 없습니다. 갱신하지 않습니다.")
            return
        file_url = attachment_url(ntt)
        data = get(file_url)

    items = convert(data)
    if len(items) < MIN_ROWS:
        raise SystemExit(f"읽은 업체 수가 {len(items)}건으로 너무 적어 갱신을 중단합니다.")

    out = {
        "title": title,
        "asof": asof_of(title),
        "ntt": ntt,
        "source": VIEW_URL.format(ntt=ntt) if ntt else "",
        "file": file_url,
        "provider": "남양주시 기반조성과(사전행정정보 공개자료)",
        "updated": dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"),
        "count": len(items),
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"갱신 완료: {len(items)}건 → {OUT}")


if __name__ == "__main__":
    sys.exit(main())
