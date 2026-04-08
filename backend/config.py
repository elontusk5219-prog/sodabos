import os
import secrets
from dotenv import load_dotenv

load_dotenv()

DATABASE_PATH = os.getenv("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "demand_monitor.db"))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")

REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", "")
REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "DemandMonitor/1.0")

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "")

KIMI_API_KEY = os.getenv("KIMI_API_KEY", "")
KIMI_API_BASE = os.getenv("KIMI_API_BASE", "https://api.moonshot.cn/v1")
KIMI_MODEL = os.getenv("KIMI_MODEL", "moonshot-v1-auto")

# JWT Auth — persist secret so tokens survive restarts
_jwt_secret_file = os.path.join(os.path.dirname(__file__), "..", "data", ".jwt_secret")
def _get_jwt_secret():
    env_secret = os.getenv("JWT_SECRET")
    if env_secret:
        return env_secret
    # Try to read from file
    try:
        with open(_jwt_secret_file, "r") as f:
            return f.read().strip()
    except FileNotFoundError:
        pass
    # Generate and persist
    s = secrets.token_hex(32)
    os.makedirs(os.path.dirname(_jwt_secret_file), exist_ok=True)
    with open(_jwt_secret_file, "w") as f:
        f.write(s)
    return s

JWT_SECRET = _get_jwt_secret()
JWT_ACCESS_EXPIRE = int(os.getenv("JWT_ACCESS_EXPIRE", 1800))    # 30 minutes
JWT_REFRESH_EXPIRE = int(os.getenv("JWT_REFRESH_EXPIRE", 604800))  # 7 days
