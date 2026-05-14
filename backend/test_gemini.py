"""Quick Gemini API diagnostic -- run with: python test_gemini.py"""
import asyncio, httpx, os, sys
from pathlib import Path

# Load .env from project root
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[1] / ".env")
except ImportError:
    pass

API_KEY = os.getenv("GEMINI_API_KEY", "")
EMBED_MODEL = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2")
CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")

print("\n" + "="*50)
print(f"  API Key : {API_KEY[:12]}...{API_KEY[-4:] if len(API_KEY) > 16 else '(too short)'}")
print(f"  Embed   : {EMBED_MODEL}")
print(f"  Chat    : {CHAT_MODEL}")
print("="*50 + "\n")

BASE = "https://generativelanguage.googleapis.com/v1beta/models"

async def test_embedding():
    print(">> Testing EMBEDDING model...")
    url = f"{BASE}/{EMBED_MODEL}:embedContent?key={API_KEY}"
    payload = {
        "model": f"models/{EMBED_MODEL}",
        "content": {"parts": [{"text": "hello world"}]}
    }
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(url, json=payload)
    if r.status_code == 200:
        vec = r.json().get("embedding", {}).get("values", [])
        print(f"  [OK] Embedding OK -- got vector of length {len(vec)}\n")
        return True
    else:
        print(f"  [FAIL] Embedding FAILED -- HTTP {r.status_code}")
        print(f"     {r.text[:400]}\n")
        return False

async def test_chat():
    print(">> Testing CHAT model...")
    url = f"{BASE}/{CHAT_MODEL}:generateContent?key={API_KEY}"
    payload = {"contents": [{"parts": [{"text": "Say hello in one word."}]}]}
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(url, json=payload)
    if r.status_code == 200:
        text = (r.json().get("candidates", [{}])[0]
                .get("content", {}).get("parts", [{}])[0].get("text", ""))
        print(f"  [OK] Chat OK -- response: {text.strip()[:80]}\n")
        return True
    else:
        print(f"  [FAIL] Chat FAILED -- HTTP {r.status_code}")
        print(f"     {r.text[:400]}\n")
        return False

async def main():
    if not API_KEY:
        print("[FAIL] No GEMINI_API_KEY found in .env!")
        sys.exit(1)
    e = await test_embedding()
    c = await test_chat()
    print("=" * 50)
    if e and c:
        print("[OK] All systems working! The bot should use AI answers.\n")
    else:
        print("[FAIL] One or more models failed. Fix the issues above.\n")

asyncio.run(main())
