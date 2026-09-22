import re
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from network import normalize_ip_address


COUNTER_PATH = "/js/jssrc/model/dvcinfo/dvccounter/DvcInfo_Counter_PrnCounter.model.htm"
MAX_RESPONSE_BYTES = 256 * 1024


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def parse_counter(source: str) -> int:
    values = []
    for field in ("copytotal", "printertotal", "faxTotal"):
        matches = re.findall(
            rf"_pp\.{field}\s*=\s*\(\s*['\"]([0-9]+)['\"]\s*\)\.toString\(\)\s*;",
            source,
        )
        if len(matches) != 1:
            raise ValueError("Принтер вернул неизвестный формат счётчика")
        values.append(int(matches[0]))
    return sum(values)


def calculate_counter_delta(start: int, end: int) -> int:
    if start is None:
        raise ValueError("Не зафиксирован счётчик на начало ремонта")
    if end < start:
        raise ValueError("Текущий счётчик меньше начального. Проверьте показания принтера")
    return end - start


def read_counter(address: str) -> int:
    address = normalize_ip_address(address)
    if not address:
        raise ValueError("У устройства не указан IP-адрес")
    host = f"[{address}]" if ":" in address else address
    base_url = f"http://{host}"
    request = Request(base_url + COUNTER_PATH, headers={
        "User-Agent": "Mozilla/5.0",
        "Cookie": "rtl=0; css=1",
        "Referer": base_url + "/dvcinfo/dvccounter/DvcInfo_Counter_PrnCounter.htm",
    })
    # Contact only the stored address, without system proxies or redirects.
    opener = build_opener(ProxyHandler({}), NoRedirects())
    with opener.open(request, timeout=8) as response:
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("Ответ принтера слишком большой")
    return parse_counter(body.decode("utf-8", errors="replace"))
