"""Run an isolated demo on localhost; Ctrl+C stops both child processes."""
import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))


def available_port(port):
    with socket.socket() as connection:
        if os.name == "nt":
            connection.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        connection.bind(("127.0.0.1", port))


def main():
    parser = argparse.ArgumentParser(description="Запустить тестовый проект на http://127.0.0.1:3001")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    node = shutil.which("node")
    cached_node = ROOT / ".cache" / "runtime" / "node-v22.17.0-win-x64" / "node.exe"
    if not node and cached_node.is_file():
        node = str(cached_node)
    vite = ROOT / "frontend" / "node_modules" / "vite" / "bin" / "vite.js"
    if not node or not vite.is_file():
        parser.exit(1, "Нужны Node.js 20+ и зависимости frontend (выполните npm ci в frontend).\n")
    try:
        available_port(3001)
        available_port(8001)
    except OSError:
        parser.exit(1, "Порт 3001 или 8001 уже занят. Остановите предыдущий демозапуск.\n")

    from seed_demo import build_demo

    directory = ROOT / ".cache" / "demo"
    directory.mkdir(parents=True, exist_ok=True)
    database = directory / "printer_dashboard.db"
    result = build_demo(database, if_missing=True)
    print("Демобаза:", database, "(данные от", result["as_of"] + ")", flush=True)
    environment = os.environ.copy()
    environment.update({
        "DATABASE_URL": "sqlite:///" + database.as_posix(),
        "ADMIN_LOGIN": "demo", "ADMIN_PASSWORD": "demo-printer-2026",
        "SECRET_KEY": "demo-only-local-testing-change-for-any-real-deployment",
        "OCS_AD_IMPORT_TOKEN": "demo-only-import-token",
        "PHOTO_DIRECTORY": str(directory / "photos"),
        "REPAIR_INVOICE_DIRECTORY": str(directory / "repair_invoices"),
        "VITE_API_PROXY_TARGET": "http://127.0.0.1:8001",
        "PYTHONPATH": str(ROOT / "backend"),
    })
    processes, logs = [], []
    try:
        for name, command, cwd in (
            ("api", [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"], ROOT / "backend"),
            ("frontend", [node, str(vite), "--host", "127.0.0.1", "--port", "3001", "--strictPort"], ROOT / "frontend"),
        ):
            log = (directory / f"{name}.log").open("w", encoding="utf-8")
            logs.append(log)
            processes.append(subprocess.Popen(command, cwd=cwd, env=environment,
                stdout=log, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
        deadline = time.monotonic() + 60
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while True:
            if any(process.poll() is not None for process in processes):
                raise RuntimeError("Сервис остановился. Смотрите логи в .cache/demo.")
            try:
                for url in ("http://127.0.0.1:8001/api/health", "http://127.0.0.1:3001"):
                    with opener.open(url, timeout=2) as response:
                        if response.status != 200:
                            raise OSError("Сервис ещё не готов")
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise RuntimeError("Превышено время запуска. Смотрите логи в .cache/demo.")
                time.sleep(0.3)
        print("Открыть: http://127.0.0.1:3001\nЛогин: demo\nПароль: demo-printer-2026\n"
              "API: http://127.0.0.1:8001/docs\nОстановка: Ctrl+C. Изменения в демобазе сохраняются.", flush=True)
        if not args.no_browser:
            webbrowser.open("http://127.0.0.1:3001")
        while all(process.poll() is None for process in processes):
            time.sleep(0.5)
        raise RuntimeError("Сервис остановился. Смотрите логи в .cache/demo.")
    except KeyboardInterrupt:
        print("\nДемо остановлено.")
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for log in logs:
            log.close()


if __name__ == "__main__":
    main()
