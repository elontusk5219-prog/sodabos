import time
from jose import jwt, JWTError
from config import JWT_SECRET, JWT_ACCESS_EXPIRE, JWT_REFRESH_EXPIRE

ALGORITHM = "HS256"


def create_access_token(user_id: int, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "exp": int(time.time()) + JWT_ACCESS_EXPIRE,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def create_refresh_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": int(time.time()) + JWT_REFRESH_EXPIRE,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None
