

import os
import json
import urllib.request
import urllib.error
from groq import Groq

from pathlib import Path

from contextlib import asynccontextmanager

import psycopg

from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, Response

from pydantic import BaseModel, Field

from psycopg.rows import dict_row


from pypdf import PdfReader

from sentence_transformers import SentenceTransformer

import io
import base64
import hashlib
import hmac
import secrets
import time
import smtplib
from email.message import EmailMessage
import jwt

from fastapi.middleware.cors import CORSMiddleware

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

load_dotenv(dotenv_path=ENV_FILE, override=false)

DATABASE_URL = os.getenv("DATABASE_URL")


GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
AUTH_SECRET = os.getenv("AUTH_SECRET", "change-this-local-development-secret-before-deploying")
AUTH_TOKEN_TTL_SECONDS = 60 * 30
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes"}
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").strip().lower()
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
AUTH_COOKIE_NAME = "adaptive_access"
REFRESH_COOKIE_NAME = "adaptive_refresh"
REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7
CSRF_COOKIE_NAME = "adaptive_csrf"


# ---------- PDF processing and embeddings ----------

EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

_embedding_model = None

def get_embedding_model():

    """Load the embedding model only when it is first needed."""

    global _embedding_model

    if _embedding_model is None:

        _embedding_model = SentenceTransformer(

            EMBEDDING_MODEL_NAME

        )

    return _embedding_model

def retrieve_relevant_chunks(

    question: str,

    student_id: int,

    chat_id: int,

    top_k: int = 5,

) -> list[dict]:

    """Retrieve relevant PDF chunks attached to this specific chat."""

    model = get_embedding_model()
    
    query_embedding = model.encode(

        question,

        normalize_embeddings=True,

        show_progress_bar=False,

    )

    vector_literal = (

        "["

        + ",".join(str(float(value)) for value in query_embedding)

        + "]"

    )

    with get_connection() as connection:

        rows = connection.execute(

            """

            SELECT

                dc.chunk_text,

                dc.page_number,

                dc.chunk_index,

                d.id AS document_id,

                d.document_name,

                1 - (dc.embedding <=> %s::vector) AS similarity

            FROM public.document_chunks dc

            JOIN public.documents d

                ON d.id = dc.document_id

            WHERE d.student_id = %s

              AND d.chat_id = %s

              AND d.status = 'processed'

            ORDER BY dc.embedding <=> %s::vector

            LIMIT %s

            """,

            (

                vector_literal,

                student_id,

                chat_id,

                vector_literal,

                top_k,

            ),

        ).fetchall()

    return [

        {

            **row,

            "similarity": float(row["similarity"]),

        }

        for row in rows

    ]

def retrieve_chat_document_chunks(
    student_id: int,
    chat_id: int,
    limit: int = 80,
) -> list[dict]:
    """Retrieve stored PDF chunks in document/page order for summarization."""

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                dc.chunk_text,
                dc.page_number,
                dc.chunk_index,
                d.id AS document_id,
                d.document_name,
                0.0::float AS similarity
            FROM public.document_chunks dc
            JOIN public.documents d
                ON d.id = dc.document_id
            WHERE d.student_id = %s
              AND d.chat_id = %s
              AND d.status = 'processed'
            ORDER BY d.id, dc.page_number, dc.chunk_index
            LIMIT %s
            """,
            (student_id, chat_id, limit),
        ).fetchall()

    return [dict(row) for row in rows]

def split_text_into_chunks(

    text: str,

    chunk_size: int = 1000,

    overlap: int = 150,

) -> list[str]:

    """Split text near sentence and paragraph boundaries with overlap."""

    import re

    if not text or not text.strip():

        return []

    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:

        raise ValueError(

            "chunk_size must be positive and overlap must be "

            "non-negative and smaller than chunk_size"

        )

    # Preserve paragraph boundaries before normalizing whitespace.

    paragraphs = [

        re.sub(r"\s+", " ", paragraph).strip()

        for paragraph in re.split(r"\n\s*\n", text)

        if paragraph.strip()

    ]

    # Split long paragraphs into sentences.

    sentences = []

    for paragraph in paragraphs:

        parts = re.split(r"(?<=[.!?])\s+", paragraph)

        sentences.extend(part.strip() for part in parts if part.strip())

    # Keep short paragraphs/sentences together where possible.

    units = []

    for sentence in sentences:

        if len(sentence) <= chunk_size:

            units.append(sentence)

        else:

            # Extremely long sentence: split at word boundaries.

            words = sentence.split()

            current = ""

            for word in words:

                candidate = f"{current} {word}".strip()

                if len(candidate) > chunk_size and current:

                    units.append(current)

                    current = word

                else:

                    current = candidate

            if current:

                units.append(current)

    chunks = []

    current = ""

    for unit in units:

        candidate = f"{current} {unit}".strip()

        if len(candidate) <= chunk_size:

            current = candidate

            continue

        if current:

            chunks.append(current)

        # Carry complete trailing sentences/words into the next chunk.

        if overlap and current:

            tail = current[-overlap:]

            # Avoid starting the next chunk in the middle of a word.

            tail = tail.split(" ", 1)[-1] if " " in tail else ""

            current = f"{tail} {unit}".strip() if tail else unit

        else:

            current = unit

    if current:

        chunks.append(current)

    return chunks

def get_connection():

    if not DATABASE_URL:

        raise RuntimeError("DATABASE_URL is missing from .env")

    return psycopg.connect(

        DATABASE_URL,

        row_factory=dict_row,

        connect_timeout=5,

    )

@asynccontextmanager

async def lifespan(app: FastAPI):
    # Additive/idempotent migrations: existing rows and the Docker volume are preserved.
    with get_connection() as connection:
        connection.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS password_hash TEXT")
        connection.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT")
        connection.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ")
        connection.execute("ALTER TABLE attempts ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NOT NULL DEFAULT 0")
        connection.execute("SELECT 1")
    yield

app = FastAPI(

    title="Adaptive Learning Platform API",

    description="Assessment and adaptive learning backend",

    version="1.0.0",

    lifespan=lifespan,

)

app.add_middleware(

    CORSMiddleware,

    allow_origins=[

        "http://localhost:5173",

        "http://127.0.0.1:5173",

        "http://localhost:5174",

        "http://127.0.0.1:5174",

    ],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],

)

# Authentication: standard JWT in an HttpOnly cookie + double-submit CSRF protection.
def _issue_token(student_id: int, token_type: str = "access") -> str:
    now = int(time.time())
    ttl = REFRESH_TOKEN_TTL_SECONDS if token_type == "refresh" else AUTH_TOKEN_TTL_SECONDS
    return jwt.encode(
        {"sub": str(student_id), "iat": now, "exp": now + ttl, "iss": "adaptive-learning-platform", "token_type": token_type},
        AUTH_SECRET,
        algorithm="HS256",
    )


def _verify_token(token: str, expected_type: str = "access") -> dict | None:
    try:
        claims = jwt.decode(token, AUTH_SECRET, algorithms=["HS256"], issuer="adaptive-learning-platform", options={"require": ["sub", "exp", "iat", "iss", "token_type"]})
        return claims if claims.get("token_type") == expected_type else None
    except jwt.PyJWTError:
        return None


def _set_auth_cookies(response: Response, student_id: int, include_refresh: bool = True) -> None:
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        AUTH_COOKIE_NAME, _issue_token(student_id, "access"), httponly=True, secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, max_age=AUTH_TOKEN_TTL_SECONDS, path="/",
    )
    if include_refresh:
        response.set_cookie(
            REFRESH_COOKIE_NAME, _issue_token(student_id, "refresh"), httponly=True, secure=COOKIE_SECURE,
            samesite=COOKIE_SAMESITE, max_age=REFRESH_TOKEN_TTL_SECONDS, path="/",
        )
    response.set_cookie(
        CSRF_COOKIE_NAME, csrf_token, httponly=False, secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, max_age=REFRESH_TOKEN_TTL_SECONDS, path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(AUTH_COOKIE_NAME, path="/", secure=COOKIE_SECURE, httponly=True, samesite=COOKIE_SAMESITE)
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/", secure=COOKIE_SECURE, httponly=True, samesite=COOKIE_SAMESITE)
    response.delete_cookie(CSRF_COOKIE_NAME, path="/", secure=COOKIE_SECURE, httponly=False, samesite=COOKIE_SAMESITE)


@app.middleware("http")
async def require_authentication(request: Request, call_next):
    path = request.url.path
    public_exact = {
        "/", "/health", "/db-health", "/auth/csrf", "/auth/signin", "/auth/signup",
        "/auth/forgot-password", "/auth/reset-password", "/auth/refresh", "/topics", "/assessments",
        "/test-catalog", "/openapi.json", "/docs", "/redoc",
    }
    if request.method == "OPTIONS" or path in public_exact or path.startswith("/docs/"):
        # CSRF is still required on all unsafe methods, including public auth forms.
        if request.method not in {"GET", "HEAD", "OPTIONS"} and path not in {"/auth/csrf"}:
            csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME, "")
            csrf_header = request.headers.get("x-csrf-token", "")
            if not csrf_cookie or not csrf_header or not hmac.compare_digest(csrf_cookie, csrf_header):
                from starlette.responses import JSONResponse
                return JSONResponse(status_code=403, content={"detail": "CSRF validation failed. Refresh the page and try again."})
        return await call_next(request)

    token = request.cookies.get(AUTH_COOKIE_NAME, "")
    claims = _verify_token(token) if token else None
    if not claims:
        from starlette.responses import JSONResponse
        return JSONResponse(status_code=401, content={"detail": "Please sign in to continue."})

    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME, "")
        csrf_header = request.headers.get("x-csrf-token", "")
        if not csrf_cookie or not csrf_header or not hmac.compare_digest(csrf_cookie, csrf_header):
            from starlette.responses import JSONResponse
            return JSONResponse(status_code=403, content={"detail": "CSRF validation failed. Refresh the page and try again."})

    try:
        authenticated_student_id = int(claims["sub"])
        request.state.student_id = authenticated_student_id
    except (KeyError, ValueError, TypeError):
        from starlette.responses import JSONResponse
        return JSONResponse(status_code=401, content={"detail": "Invalid authentication token."})

    # Prevent a signed-in student from substituting another student's ID
    # in URL paths, query parameters, JSON bodies, or multipart form fields.
    requested_ids = list(request.query_params.getlist("student_id"))
    student_path_match = re.match(r"^/students/(\d+)(?:/|$)", path)
    if student_path_match:
        requested_ids.append(student_path_match.group(1))
    for requested_id in requested_ids:
        try:
            if int(requested_id) != authenticated_student_id:
                from starlette.responses import JSONResponse
                return JSONResponse(status_code=403, content={"detail": "You can only access your own student data."})
        except (ValueError, TypeError):
            from starlette.responses import JSONResponse
            return JSONResponse(status_code=400, content={"detail": "Invalid student_id."})

    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        content_type = request.headers.get("content-type", "").lower()
        if "application/json" in content_type:
            raw_body = await request.body()
            try:
                payload = json.loads(raw_body) if raw_body else None
            except (json.JSONDecodeError, UnicodeDecodeError):
                payload = None
            if isinstance(payload, dict) and payload.get("student_id") is not None:
                try:
                    if int(payload["student_id"]) != authenticated_student_id:
                        from starlette.responses import JSONResponse
                        return JSONResponse(status_code=403, content={"detail": "You can only access your own student data."})
                except (ValueError, TypeError):
                    from starlette.responses import JSONResponse
                    return JSONResponse(status_code=400, content={"detail": "Invalid student_id."})
            async def receive_json_body():
                return {"type": "http.request", "body": raw_body, "more_body": False}
            request._receive = receive_json_body
        elif "multipart/form-data" in content_type:
            raw_body = await request.body()
            match = re.search(rb'name="student_id"\r?\n\r?\n([^\r\n-]+)', raw_body)
            if match:
                try:
                    if int(match.group(1).decode().strip()) != authenticated_student_id:
                        from starlette.responses import JSONResponse
                        return JSONResponse(status_code=403, content={"detail": "You can only access your own student data."})
                except (ValueError, UnicodeDecodeError):
                    from starlette.responses import JSONResponse
                    return JSONResponse(status_code=400, content={"detail": "Invalid student_id."})
            async def receive_multipart_body():
                return {"type": "http.request", "body": raw_body, "more_body": False}
            request._receive = receive_multipart_body

    return await call_next(request)


class SignUpBody(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)


class SignInBody(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class ProfileUpdateBody(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class ForgotPasswordBody(BaseModel):
    email: str = Field(min_length=5, max_length=255)


class ResetPasswordBody(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    password: str = Field(min_length=8, max_length=128)


def _password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return f"pbkdf2_sha256$310000${base64.urlsafe_b64encode(salt).decode().rstrip('=')}${base64.urlsafe_b64encode(derived).decode().rstrip('=')}"


def _password_matches(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algorithm, rounds, salt_text, expected = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        actual = base64.urlsafe_b64encode(hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))).decode().rstrip("=")
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _student_payload(student: dict) -> dict:
    return {"student": {"id": int(student["id"]), "name": student["name"], "email": student["email"]}}


@app.get("/auth/csrf")
def get_csrf_token(response: Response, request: Request):
    token = request.cookies.get(CSRF_COOKIE_NAME)
    if not token:
        token = secrets.token_urlsafe(32)
        response.set_cookie(CSRF_COOKIE_NAME, token, httponly=False, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, max_age=AUTH_TOKEN_TTL_SECONDS, path="/")
    return {"csrf_token": token}


@app.post("/auth/signup", status_code=201)
def sign_up(body: SignUpBody, response: Response):
    name = body.name.strip()
    email = body.email.strip().lower()
    if not name or "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid name and email address.")
    try:
        with get_connection() as connection:
            student = connection.execute(
                "INSERT INTO students (name, email, password_hash) VALUES (%s, %s, %s) RETURNING id, name, email",
                (name, email, _password_hash(body.password)),
            ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    _set_auth_cookies(response, int(student["id"]))
    return _student_payload(student)


@app.post("/auth/signin")
def sign_in(body: SignInBody, response: Response):
    with get_connection() as connection:
        student = connection.execute(
            "SELECT id, name, email, password_hash FROM students WHERE LOWER(email) = %s",
            (body.email.strip().lower(),),
        ).fetchone()
    if not student or not _password_matches(body.password, student.get("password_hash")):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    _set_auth_cookies(response, int(student["id"]))
    return _student_payload(student)


@app.post("/auth/refresh")
def refresh_authentication(request: Request, response: Response):
    claims = _verify_token(request.cookies.get(REFRESH_COOKIE_NAME, ""), "refresh")
    if not claims:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    _set_auth_cookies(response, int(claims["sub"]), include_refresh=False)
    return {"message": "Session refreshed."}


@app.post("/auth/signout")
def sign_out(response: Response):
    _clear_auth_cookies(response)
    return {"message": "Signed out successfully."}


@app.get("/auth/me")
def auth_me(request: Request):
    with get_connection() as connection:
        student = connection.execute("SELECT id, name, email FROM students WHERE id = %s", (request.state.student_id,)).fetchone()
    if not student:
        raise HTTPException(status_code=401, detail="Account not found. Please sign in again.")
    return _student_payload(student)


@app.get("/auth/profile")
def get_profile(request: Request):
    with get_connection() as connection:
        student = connection.execute("SELECT id, name, email, created_at FROM students WHERE id = %s", (request.state.student_id,)).fetchone()
    if not student:
        raise HTTPException(status_code=404, detail="Student account not found.")
    return {"student": student}


@app.patch("/auth/profile")
def update_profile(body: ProfileUpdateBody, request: Request):
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Name must contain at least 2 characters.")
    with get_connection() as connection:
        student = connection.execute("UPDATE students SET name = %s WHERE id = %s RETURNING id, name, email, created_at", (name, request.state.student_id)).fetchone()
    if not student:
        raise HTTPException(status_code=404, detail="Student account not found.")
    return {"student": student}


def _send_reset_email(email: str, token: str) -> None:
    host = os.getenv("SMTP_HOST")
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM", username or "")
    if not host or not sender:
        raise RuntimeError("SMTP is not configured")
    port = int(os.getenv("SMTP_PORT", "587"))
    reset_url = f"{FRONTEND_URL}/reset-password?token={token}"
    message = EmailMessage()
    message["Subject"] = "Reset your Adaptive Learning Platform password"
    message["From"] = sender
    message["To"] = email
    message.set_content(f"We received a request to reset your password. Use this one-time link within 60 minutes:\n\n{reset_url}\n\nIf you did not request this, you can ignore this email.")
    if os.getenv("SMTP_SSL", "false").lower() in {"1", "true", "yes"}:
        with smtplib.SMTP_SSL(host, port, timeout=15) as server:
            if username and password:
                server.login(username, password)
            server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.starttls()
            if username and password:
                server.login(username, password)
            server.send_message(message)


@app.post("/auth/forgot-password")
def forgot_password(body: ForgotPasswordBody):
    email = body.email.strip().lower()
    generic = {"message": "If an account exists for that email, password reset instructions will be sent."}
    with get_connection() as connection:
        student = connection.execute("SELECT id, email FROM students WHERE LOWER(email) = %s", (email,)).fetchone()
    if not student:
        return generic
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with get_connection() as connection:
        connection.execute("UPDATE students SET password_reset_token_hash = %s, password_reset_expires_at = NOW() + INTERVAL '60 minutes' WHERE id = %s", (token_hash, student["id"]))
    try:
        _send_reset_email(student["email"], token)
    except Exception as exc:
        # Do not return the token to the browser or reveal whether an account exists.
        print(f"Password reset email could not be sent ({type(exc).__name__}). Configure SMTP settings.")
    return generic


@app.post("/auth/reset-password")
def reset_password(body: ResetPasswordBody, response: Response):
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    with get_connection() as connection:
        student = connection.execute(
            "UPDATE students SET password_hash = %s, password_reset_token_hash = NULL, password_reset_expires_at = NULL WHERE password_reset_token_hash = %s AND password_reset_expires_at > NOW() RETURNING id",
            (_password_hash(body.password), token_hash),
        ).fetchone()
    if not student:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired. Request a new one.")
    _clear_auth_cookies(response)
    return {"message": "Password reset successfully. Please sign in with your new password."}

class AnswerSubmission(BaseModel):

    student_id: int = Field(gt=0)

    answers: dict[int, str]

@app.get("/")

def root():

    return {

        "message": "Adaptive Learning Platform API",

        "status": "running",

    }

@app.get("/health")

def health():

    return {"status": "healthy"}

@app.get("/db-health")

def database_health():

    try:

        with get_connection() as connection:

            result = connection.execute(

                "SELECT current_database() AS database, version() AS postgresql_version"

            ).fetchone()

        return {

            "status": "connected",

            "database": result["database"],

            "postgresql_version": result["postgresql_version"],

        }

    except Exception:

        raise HTTPException(

            status_code=503,

            detail="Database connection failed.",

        )

@app.get("/topics")

def get_topics():

    with get_connection() as connection:

        topics = connection.execute(

            "SELECT id, name, subject, description FROM topics ORDER BY id"

        ).fetchall()

    return {"topics": topics}

@app.get("/assessments")

def get_assessments():

    with get_connection() as connection:

        assessments = connection.execute(

            """

            SELECT a.id, a.title, a.topic_id, t.name AS topic_name,

                   COUNT(q.id) AS question_count

            FROM assessments a

            LEFT JOIN topics t ON t.id = a.topic_id

            LEFT JOIN questions q ON q.topic_id = a.topic_id

            GROUP BY a.id, a.title, a.topic_id, t.name

            ORDER BY a.id

            """

        ).fetchall()

    return {"assessments": assessments}

@app.get("/assessments/{assessment_id}/questions")

def get_assessment_questions(assessment_id: int):

    with get_connection() as connection:

        assessment = connection.execute(

            "SELECT id, title, topic_id FROM assessments WHERE id = %s",

            (assessment_id,),

        ).fetchone()

        if not assessment:

            raise HTTPException(status_code=404, detail="Assessment not found")

        questions = connection.execute(

            """

            SELECT id, question_text, options, difficulty

            FROM questions

            WHERE topic_id = %s

            ORDER BY id

            """,

            (assessment["topic_id"],),

        ).fetchall()

    return {

        "assessment": assessment,

        "questions": questions,

    }

@app.post("/assessments/{assessment_id}/submit")

def submit_assessment(

    assessment_id: int,

    submission: AnswerSubmission,

):

    with get_connection() as connection:

        with connection.transaction():

            assessment = connection.execute(

                "SELECT id, title, topic_id FROM assessments WHERE id = %s",

                (assessment_id,),

            ).fetchone()

            if not assessment:

                raise HTTPException(

                    status_code=404,

                    detail="Assessment not found",

                )

            student = connection.execute(

                "SELECT id FROM students WHERE id = %s",

                (submission.student_id,),

            ).fetchone()

            if not student:

                raise HTTPException(

                    status_code=404,

                    detail="Student not found. Create a student first.",

                )

            questions = connection.execute(

                """

                SELECT id, correct_option, explanation

                FROM questions

                WHERE topic_id = %s

                ORDER BY id

                """,

                (assessment["topic_id"],),

            ).fetchall()

            if not questions:

                raise HTTPException(

                    status_code=400,

                    detail="This assessment has no questions",

                )

            question_by_id = {q["id"]: q for q in questions}

            if len(submission.answers) != len(set(submission.answers)):

                raise HTTPException(

                    status_code=400,

                    detail="Duplicate question IDs are not allowed",

                )

            unknown_ids = set(submission.answers) - set(question_by_id)

            if unknown_ids:

                raise HTTPException(

                    status_code=400,

                    detail=f"Invalid question IDs: {sorted(unknown_ids)}",

                )

            attempt = connection.execute(

                """

                INSERT INTO attempts (student_id, assessment_id, total_questions)

                VALUES (%s, %s, %s)

                RETURNING id

                """,

                (

                    submission.student_id,

                    assessment_id,

                    len(questions),

                ),

            ).fetchone()

            attempt_id = attempt["id"]

            correct_count = 0

            results = []

            for question in questions:

                question_id = question["id"]

                selected = submission.answers.get(question_id)

                is_correct = (

                    selected is not None

                    and selected.strip().upper()

                    == question["correct_option"].upper()

                )

                if is_correct:

                    correct_count += 1

                connection.execute(

                    """

                    INSERT INTO answers

                        (attempt_id, question_id, selected_option, is_correct)

                    VALUES (%s, %s, %s, %s)

                    """,

                    (attempt_id, question_id, selected, is_correct),

                )

                results.append(

                    {

                        "question_id": question_id,

                        "selected_option": selected,

                        "is_correct": is_correct,

                        "correct_option": question["correct_option"],

                        "explanation": question["explanation"],

                    }

                )

            score = round(correct_count / len(questions) * 100, 2)

            connection.execute(

                """

               UPDATE attempts
SET score = %s,
    completed_at = NOW(),
    duration_seconds = %s
WHERE id = %s

                """,

                (score, submission.duration_seconds, attempt["id"]),

            )

    return {

        "attempt_id": attempt_id,

        "assessment_id": assessment_id,

        "score": score,

        "correct_answers": correct_count,

        "total_questions": len(questions),

        "results": results,

    }

@app.get("/students/{student_id}/adaptive-questions")

def get_adaptive_questions(student_id: int, topic_id: int):

    with get_connection() as connection:

        student = connection.execute(

            "SELECT id FROM students WHERE id = %s",

            (student_id,),

        ).fetchone()

        if not student:

            raise HTTPException(status_code=404, detail="Student not found")

        # Calculate the student's historical accuracy for this topic.

        performance = connection.execute(

            """

            SELECT

                COUNT(ans.id) AS total_answered,

                COUNT(*) FILTER (WHERE ans.is_correct) AS correct_answers

            FROM answers ans

            JOIN attempts att ON att.id = ans.attempt_id

            JOIN questions q ON q.id = ans.question_id

            WHERE att.student_id = %s

              AND q.topic_id = %s

              AND att.completed_at IS NOT NULL

            """,

            (student_id, topic_id),

        ).fetchone()

        total = performance["total_answered"]

        correct = performance["correct_answers"]

        if total == 0:

            accuracy = None

            target_difficulty = "medium"

        else:

            accuracy = round(correct / total * 100, 2)

            if accuracy < 50:

                target_difficulty = "easy"

            elif accuracy < 80:

                target_difficulty = "medium"

            else:

                target_difficulty = "hard"

        # Prefer questions the student has not answered before.

        questions = connection.execute(

            """

            SELECT q.id, q.question_text, q.options, q.difficulty

            FROM questions q

            WHERE q.topic_id = %s

              AND q.difficulty = %s

              AND NOT EXISTS (

                  SELECT 1

                  FROM answers ans

                  JOIN attempts att ON att.id = ans.attempt_id

                  WHERE att.student_id = %s

                    AND ans.question_id = q.id

              )

            ORDER BY q.id

            LIMIT 5

            """,

            (topic_id, target_difficulty, student_id),

        ).fetchall()

        # If no new questions exist at the target level, use other

        # unanswered questions from the same topic.

        if not questions:

            questions = connection.execute(

                """

                SELECT q.id, q.question_text, q.options, q.difficulty

                FROM questions q

                WHERE q.topic_id = %s

                  AND NOT EXISTS (

                      SELECT 1

                      FROM answers ans

                      JOIN attempts att ON att.id = ans.attempt_id

                      WHERE att.student_id = %s

                        AND ans.question_id = q.id

                  )

                ORDER BY q.id

                LIMIT 5

                """,

                (topic_id, student_id),

            ).fetchall()

    return {

        "student_id": student_id,

        "topic_id": topic_id,

        "previous_accuracy": accuracy,

        "target_difficulty": target_difficulty,

        "questions": questions,

        "message": (

            "No unanswered questions are available for this topic."

            if not questions

            else "Questions selected based on your performance."

        ),

    }

@app.get("/students/{student_id}/weak-topics")

def get_weak_topics(student_id: int):

    with get_connection() as connection:

        student = connection.execute(

            "SELECT id FROM students WHERE id = %s",

            (student_id,),

        ).fetchone()

        if not student:

            raise HTTPException(status_code=404, detail="Student not found")

        topics = connection.execute(

            """

            SELECT

                t.id AS topic_id,

                t.name AS topic_name,

                COUNT(ans.id) AS total_answered,

                COUNT(*) FILTER (WHERE ans.is_correct) AS correct_answers,

                ROUND(

                    100.0 * COUNT(*) FILTER (WHERE ans.is_correct)

                    / NULLIF(COUNT(ans.id), 0),

                    2

                ) AS accuracy

            FROM topics t

            JOIN assessments a ON a.topic_id = t.id

            JOIN attempts att ON att.assessment_id = a.id

            JOIN answers ans ON ans.attempt_id = att.id

            WHERE att.student_id = %s

              AND att.completed_at IS NOT NULL

            GROUP BY t.id, t.name

            HAVING COUNT(ans.id) > 0

            ORDER BY accuracy ASC, total_answered DESC

            """,

            (student_id,),

        ).fetchall()

    return {

        "student_id": student_id,

        "weak_topics": [

            topic for topic in topics

            if topic["accuracy"] is not None and topic["accuracy"] < 60

        ],

        "topic_performance": topics,

    }

@app.get("/students/{student_id}/recommendations")

def get_learning_recommendations(student_id: int):

    with get_connection() as connection:

        student = connection.execute(

            "SELECT id FROM students WHERE id = %s",

            (student_id,),

        ).fetchone()

        if not student:

            raise HTTPException(

                status_code=404,

                detail="Student not found",

            )

        topic_performance = connection.execute(

            """

            SELECT

                t.id AS topic_id,

                t.name AS topic_name,

                t.subject,

                COUNT(ans.id) AS total_answered,

                COUNT(*) FILTER (

                    WHERE ans.is_correct = TRUE

                ) AS correct_answers,

                ROUND(

                    100.0 * COUNT(*) FILTER (

                        WHERE ans.is_correct = TRUE

                    ) / NULLIF(COUNT(ans.id), 0),

                    2

                ) AS accuracy

            FROM topics t

            JOIN assessments a ON a.topic_id = t.id

            JOIN attempts att ON att.assessment_id = a.id

            JOIN answers ans ON ans.attempt_id = att.id

            WHERE att.student_id = %s

              AND att.completed_at IS NOT NULL

            GROUP BY t.id, t.name, t.subject

            ORDER BY accuracy ASC

            """,

            (student_id,),

        ).fetchall()

        recommendations = []

        for topic in topic_performance:

            accuracy = float(topic["accuracy"] or 0)

            if accuracy < 60:

                action = "revise"

                priority = "high"

                message = (

                    f"Revise {topic['topic_name']} and review "

                    "the explanations for incorrect answers."

                )

            elif accuracy < 80:

                action = "practice"

                priority = "medium"

                message = (

                    f"Practice more questions on "

                    f"{topic['topic_name']} to improve accuracy."

                )

            else:

                action = "advance"

                priority = "low"

                message = (

                    f"You are performing well in {topic['topic_name']}. "

                    "Try harder questions to strengthen your skills."

                )

            recommendations.append({

                "topic_id": topic["topic_id"],

                "topic_name": topic["topic_name"],

                "subject": topic["subject"],

                "accuracy": accuracy,

                "questions_answered": topic["total_answered"],

                "action": action,

                "priority": priority,

                "recommendation": message,

            })

    if not recommendations:

        return {

            "student_id": student_id,

            "recommendations": [],

            "message": (

                "Complete an assessment to receive personalized "

                "learning recommendations."

            ),

        }

    return {

        "student_id": student_id,

        "recommendations": recommendations,

    }

class TutorQuestion(BaseModel):

    question: str = Field(min_length=3, max_length=4000)

    subject: str = Field(default="General", max_length=100)

    # Identifies which saved conversation to remember

    chat_id: int | None = Field(default=None, gt=0)

    student_id: int | None = Field(default=None, gt=0)

    # Temporary compatibility with the current prompt

    history: list[dict[str, str]] = Field(

        default_factory=list,

        max_length=20,

    )

@app.post("/ai-tutor/ask")

def ask_ai_tutor(request: TutorQuestion):

    if not GROQ_API_KEY:

        raise HTTPException(

            status_code=503,

            detail="AI tutor is not configured. Set GROQ_API_KEY in your .env file.",

        )

    history_text = ""

    # 1. Retrieve saved conversation history.

    if request.chat_id is not None or request.student_id is not None:

        if request.chat_id is None or request.student_id is None:

            raise HTTPException(

                status_code=400,

                detail="Both chat_id and student_id are required.",

            )

        with get_connection() as connection:

            chat = connection.execute(

                """

                SELECT id

                FROM conversations

                WHERE id = %s AND student_id = %s

                """,

                (request.chat_id, request.student_id),

            ).fetchone()

            if not chat:

                raise HTTPException(

                    status_code=404,

                    detail="Chat not found.",

                )

            messages = connection.execute(

                """

                SELECT role, content

                FROM chat_messages

                WHERE conversation_id = %s

                ORDER BY created_at ASC, id ASC

                """,

                (request.chat_id,),

            ).fetchall()

        history_text = "\n".join(

            f"{'Student' if message['role'] == 'user' else 'Tutor'}: "

            f"{message['content']}"

            for message in messages

            if message["role"] in ("user", "assistant")

        )

    else:

        # Compatibility with requests that supply history directly.

        history_text = "\n".join(

            f"{'Student' if message.get('role') == 'user' else 'Tutor'}: "

            f"{message.get('content', '').strip()}"

            for message in request.history

            if message.get("role") in ("user", "assistant")

            and message.get("content", "").strip()

        )

    # 2. Retrieve relevant passages from the student's documents.

   
    # 2. Detect broad document-summary requests.
    question_lower = request.question.lower()

    summary_request = bool(
        re.search(
            r"\b(summarize|summarise|summary|overview|"
            r"what is in|what's in|what is there in|"
            r"what's inside|contents of|"
            r"explain this pdf|describe this document)\b",
            question_lower,
        )
    )

    retrieved_chunks = []

    if request.student_id is not None:
        if request.chat_id is None:
            raise HTTPException(
                status_code=400,
                detail="A chat ID is required to retrieve its documents.",
            )

        try:
            if summary_request:
                # Summaries should use document content in page order.
                retrieved_chunks = retrieve_chat_document_chunks(
                    student_id=request.student_id,
                    chat_id=request.chat_id,
                )
            else:
                # Normal questions continue using semantic search.
                retrieved_chunks = retrieve_relevant_chunks(
                    question=request.question,
                    student_id=request.student_id,
                    chat_id=request.chat_id,
                    top_k=5,
                )
        except Exception as exc:
            print(
                "Document retrieval failed:",
                type(exc).__name__,
                str(exc),
            )
            raise HTTPException(
                status_code=500,
                detail="Document retrieval failed. Check backend logs.",
            ) from exc

    if summary_request:
        # Do not discard document passages using a similarity threshold.
        relevant_chunks = retrieved_chunks
    else:
    
    # Use the best matching passages returned by semantic search.
    # Do not discard every passage just because its score is below 0.30.
        relevant_chunks = retrieved_chunks

    # Initial threshold; tune it after evaluating retrieval quality.

    

    # 3. Build evidence and structured sources from retrieved chunks.

    document_context_parts = []

    sources = []

    seen_sources = set()

    for chunk in relevant_chunks:

        document_context_parts.append(

            f"""

Document: {chunk["document_name"]}

Page: {chunk["page_number"]}

Passage:

{chunk["chunk_text"]}

"""

        )

        source_key = (

            chunk["document_id"],

            chunk["page_number"],

        )

        if source_key not in seen_sources:

            seen_sources.add(source_key)

            sources.append({

                "document_id": chunk["document_id"],

                "document_name": chunk["document_name"],

                "page_number": chunk["page_number"],

                "similarity": round(chunk["similarity"], 4),

            })

    document_context = (

        "\n".join(document_context_parts)

        if document_context_parts

        else "No sufficiently relevant passages were retrieved."

    )

    # 4. Ask Gemini to answer using evidence without inventing citations.
    prompt = f"""
You are StudyMind AI, a friendly and intelligent learning assistant.

PERSONALITY AND STYLE:
- Be natural, clear, supportive, and conversational.
- Answer the student's actual question directly.
- Avoid unnecessary introductions such as "I'd be happy to help".
- Do not repeat the question before answering.
- Use simple language and explain technical concepts with examples.
- Keep simple answers short; provide detail when the question requires it.
- Adapt the response to the student's intent and level of understanding.

FORMATTING:
- Use Markdown formatting only when it improves readability.
- Use short headings for long answers.
- Use bullet points for lists and numbered steps for procedures.
- Use bold text sparingly to highlight important terms.
- Avoid excessive headings, separators, blockquotes, and long paragraphs.
- Never display raw Markdown escape sequences unnecessarily.
- For code questions, provide readable code and explain the important parts.
- For interview preparation, provide natural answers that are easy to speak aloud.

DOCUMENT EVIDENCE:
- Use retrieved PDF passages when answering questions about the uploaded material.
- For document-based answers, cite supported claims as
  [document_name, p. page_number].
- Never invent quotations, facts, filenames, or page references.
- If the PDF contains the answer, prioritize its information.
- If the question asks for a summary, summarize the available passages
  in a logical order.
- If the question asks for an answer based on a résumé, use the résumé
  to personalize the answer and do not invent qualifications or experience.
- If the retrieved passages do not support an answer, explain that clearly.
- When using general knowledge beyond the PDF, distinguish it from
  information found in the document.

SUBJECT: {request.subject}

RETRIEVED DOCUMENT PASSAGES:
{document_context}

SAVED CONVERSATION HISTORY:
{history_text if history_text else "No previous conversation."}

STUDENT'S LATEST QUESTION:
{request.question}

Write the answer now. Make it directly useful to the student.
"""
    try:
        client = Groq(api_key=GROQ_API_KEY)

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a helpful AI tutor. Follow the "
                        "instructions and evidence in the user prompt."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_completion_tokens=1800,
        )

        answer = (
            response.choices[0].message.content or ""
        ).strip()

        if not answer:
            raise HTTPException(
                status_code=502,
                detail="Groq did not return a text answer.",
            )

        return {
            "subject": request.subject,
            "question": request.question,
            "answer": answer,
            "sources": sources,
            "model": GROQ_MODEL,
        }

    except HTTPException:
        raise

    except Exception as exc:
        print(f"Groq tutor request failed: {type(exc).__name__}: {exc}")

        raise HTTPException(
            status_code=502,
            detail="The AI tutor could not generate a response. Check the backend logs.",
        ) from exc

        raise HTTPException(

            status_code=502,

            detail=(

                "Gemini request failed. Check the API key, model "

                "availability, network, and usage limits."

            ),

        ) from exc

# ---------- Test experience APIs (added without removing existing endpoints) ----------

from typing import Literal

import json

import random

import re

from pydantic import BaseModel, Field

class GenerateTestRequest(BaseModel):

    mode: Literal["full", "topic"]

    subject_names: list[str] = Field(default_factory=list, max_length=3)

    topic_id: int | None = None

    duration_minutes: int = Field(ge=5, le=180)

    difficulty: Literal["easy", "medium", "hard", "recommended"] = "recommended"

    question_count: int = Field(default=10, ge=5, le=60)

    student_id: int | None = Field(default=None, gt=0)

class TestAnswerSubmission(BaseModel):

    student_id: int = Field(gt=0)

    assessment_id: int = Field(gt=0)

    question_ids: list[int] = Field(min_length=1)

    answers: dict[int, str]

    duration_seconds: int = Field(ge=0, le=10800)

@app.get("/test-catalog")

def get_test_catalog():

    """Return subjects/topics and existing assessments, including question counts."""

    with get_connection() as connection:

        topics = connection.execute(

            "SELECT id, name, subject, description FROM topics ORDER BY subject, name"

        ).fetchall()

        assessments = connection.execute(

            """

            SELECT a.id, a.title, a.topic_id, t.name AS topic_name,

                   t.subject, COUNT(q.id) AS question_count

            FROM assessments a

            LEFT JOIN topics t ON t.id = a.topic_id

            LEFT JOIN questions q ON q.topic_id = a.topic_id

            GROUP BY a.id, a.title, a.topic_id, t.name, t.subject

            ORDER BY a.id

            """

        ).fetchall()

    return {"topics": topics, "assessments": assessments}

@app.get("/demo-student")

def get_demo_student():

    """MVP-only demo identity so the test flow can be exercised without login."""

    with get_connection() as connection:

        student = connection.execute(

            """

            INSERT INTO students (name, email)

            VALUES ('Demo Student', 'adaptivelearning-demo@local.test')

            ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name

            RETURNING id, name, email

            """

        ).fetchone()

    return {"student": student}

def _normalise_options(options):

    if isinstance(options, str):

        try:

            options = json.loads(options)

        except json.JSONDecodeError:

            return {}

    if isinstance(options, list):

        return {chr(65 + i): value for i, value in enumerate(options)}

    return options if isinstance(options, dict) else {}

def _difficulty_mix(mode: str, count: int, previous_accuracy: float | None = None):

    if mode == "easy":

        return ["easy"] * count

    if mode == "medium":

        return ["medium"] * count

    if mode == "hard":

        return ["hard"] * count

    # Recommended: balance for a new learner; adapt for returning learners.

    if previous_accuracy is None:

        pattern = ["easy", "easy", "medium", "medium", "medium", "hard"]

    elif previous_accuracy < 50:

        pattern = ["easy", "easy", "easy", "medium", "medium", "medium"]

    elif previous_accuracy < 80:

        pattern = ["easy", "medium", "medium", "medium", "hard", "hard"]

    else:

        pattern = ["medium", "medium", "hard", "hard", "hard", "hard"]

    return [pattern[i % len(pattern)] for i in range(count)]

@app.post("/ai-tests/generate")

def generate_ai_test(request: GenerateTestRequest):

    """Generate and persist an AI test, returning questions without answer keys."""

    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="AI question generation is not configured. Set GROQ_API_KEY in your backend .env file.",
        )

    with get_connection() as connection:

        if request.mode == "topic":

            topic = connection.execute(

                "SELECT id, name, subject FROM topics WHERE id = %s",

                (request.topic_id,),

            ).fetchone()

            if not topic:

                raise HTTPException(status_code=404, detail="Topic not found")

            selected_topics = [topic]

        else:

            if not request.subject_names:

                raise HTTPException(status_code=400, detail="Select at least one subject")

            placeholders = ",".join(["%s"] * len(request.subject_names))

            selected_topics = connection.execute(

                f"SELECT id, name, subject FROM topics WHERE subject IN ({placeholders}) ORDER BY subject, name",

                tuple(request.subject_names),

            ).fetchall()

            if not selected_topics:

                raise HTTPException(status_code=400, detail="No topics found for the selected subjects")

        topic_ids = [t["id"] for t in selected_topics]

        topic_names = [f'{t["subject"]}: {t["name"]}' for t in selected_topics]

        previous_accuracy = None

        if request.difficulty == "recommended":

            # Average historical accuracy across this student's topic(s), if attempts exist.

            row = connection.execute(

                """

                SELECT AVG(ans.is_correct::int) * 100 AS accuracy

                FROM answers ans

                JOIN attempts at ON at.id = ans.attempt_id

                JOIN questions q ON q.id = ans.question_id

                WHERE at.completed_at IS NOT NULL

                  AND q.topic_id = ANY(%s)

                  AND (%s IS NULL OR at.student_id = %s)

                """,

                (topic_ids, request.student_id, request.student_id),

            ).fetchone()

            if row and row["accuracy"] is not None:

                previous_accuracy = float(row["accuracy"])

        question_count = request.question_count

        mix = _difficulty_mix(request.difficulty, question_count, previous_accuracy)

        # Rotate topic coverage for a full mock, one chosen topic for a topic test.

        assignments = [selected_topics[i % len(selected_topics)] for i in range(question_count)]

        requested_plan = [

            {"topic_id": assignments[i]["id"], "topic": assignments[i]["name"],

             "subject": assignments[i]["subject"], "difficulty": mix[i]}

            for i in range(question_count)

        ]

     
        prompt = f"""
You are an expert exam-question generator for an adaptive learning platform.

Generate exactly {question_count} multiple-choice questions using this plan:
{json.dumps(requested_plan, ensure_ascii=False)}

Requirements:
- Generate exactly one question for each plan entry, in the same order.
- Use the planned topic_id and difficulty for each question.
- Each question must have four options: A, B, C, and D.
- Exactly one option must be correct.
- Include a concise explanation.
- Return valid JSON only, without Markdown fences.

Use this JSON structure:
{{
  "questions": [
    {{
      "topic_id": 1,
      "question_text": "Example question?",
      "options": {{
        "A": "Option one",
        "B": "Option two",
        "C": "Option three",
        "D": "Option four"
      }},
      "correct_option": "A",
      "difficulty": "easy",
      "explanation": "Why option A is correct."
    }}
  ]
}}
"""


    def parse_generated_questions(raw_text: str) -> list[dict]:
        """Parse provider output and require the expected JSON object shape."""
        cleaned = re.sub(
            r"^```(?:json)?\s*|\s*```$", "", (raw_text or "").strip(), flags=re.IGNORECASE
        )
        payload = json.loads(cleaned)
        questions = payload.get("questions") if isinstance(payload, dict) else None
        if not isinstance(questions, list) or not questions:
            raise ValueError("The AI response did not contain a non-empty questions array.")
        if len(questions) != question_count:
            raise ValueError(
                f"The AI returned {len(questions)} questions; expected {question_count}."
            )
        return questions

    # Use Groq directly; Gemini is intentionally not used for question generation.
    try:
        groq_client = Groq(api_key=GROQ_API_KEY)
        groq_response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You generate exam questions. Follow the requested schema exactly "
                        "and return a valid JSON object only, without Markdown fences."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_completion_tokens=8192,
        )
        groq_text = groq_response.choices[0].message.content or ""
        items = parse_generated_questions(groq_text)
        print(f"AI question generation succeeded with Groq model {GROQ_MODEL}.")
    except Exception as groq_error:
        print(
            f"Groq question generation failed: {type(groq_error).__name__}: {groq_error}"
        )
        raise HTTPException(
            status_code=502,
            detail="Question generation failed with Groq. Check the Groq model, API key, and API usage.",
        ) from groq_error

    if len(items) != question_count:

        raise HTTPException(status_code=502, detail=f"AI returned {len(items)} questions; expected {question_count}. Please try again.")

    with get_connection() as connection:

        with connection.transaction():

            title = (

                f"AI Full Mock - {', '.join(request.subject_names)}"

                if request.mode == "full"

                else f"AI Practice - {selected_topics[0]['name']}"

            )

            assessment = connection.execute(

                "INSERT INTO assessments (title, topic_id) VALUES (%s, %s) RETURNING id, title",

                (title, selected_topics[0]["id"] if request.mode == "topic" else None),

            ).fetchone()

            saved = []

            for i, item in enumerate(items):

                plan = requested_plan[i]

                try:

                    topic_id = int(item.get("topic_id", plan["topic_id"]))

                    if topic_id not in topic_ids:

                        topic_id = plan["topic_id"]

                    options = _normalise_options(item.get("options"))

                    if set(options.keys()) != {"A", "B", "C", "D"}:

                        raise ValueError("Invalid options")

                    correct = str(item.get("correct_option", "")).upper()

                    difficulty = str(item.get("difficulty", plan["difficulty"])).lower()

                    if correct not in {"A", "B", "C", "D"} or difficulty not in {"easy", "medium", "hard"}:

                        raise ValueError("Invalid answer/difficulty")

                    row = connection.execute(

    """

    INSERT INTO questions (

        topic_id,

        question_text,

        options,

        correct_answer,

        correct_option,

        explanation,

        difficulty

    )

    VALUES (%s, %s, %s::jsonb, %s, %s, %s, %s)

    RETURNING id, topic_id, question_text, options, difficulty

    """,

    (

        topic_id,

        str(item["question_text"]),

        json.dumps(options),

        correct,

        correct,

        str(item.get("explanation", "Review the underlying concept.")),

        difficulty,

    ),

                    ).fetchone()

                    saved.append(row)

                except (KeyError, TypeError, ValueError):

                    raise HTTPException(status_code=502, detail=f"AI generated an invalid question at position {i + 1}. Please generate the test again.")

    return {

        "assessment": assessment,

        "mode": request.mode,

        "duration_minutes": request.duration_minutes,

        "difficulty": request.difficulty,

        "questions": [

            {**q, "options": _normalise_options(q["options"])}

            for q in saved

        ],

    }

@app.get("/assessments/{assessment_id}/test-questions")

def get_test_questions(assessment_id: int):

    """Return a prepared topic assessment's questions, never exposing answer keys."""

    with get_connection() as connection:

        assessment = connection.execute(

            "SELECT id, title, topic_id FROM assessments WHERE id = %s",

            (assessment_id,),

        ).fetchone()

        if not assessment:

            raise HTTPException(status_code=404, detail="Assessment not found")

        if assessment["topic_id"] is None:

            raise HTTPException(status_code=400, detail="This is a full mock assessment; start it from the mock-test flow.")

        questions = connection.execute(

            """

            SELECT id, topic_id, question_text, options, difficulty

            FROM questions WHERE topic_id = %s ORDER BY id

            """,

            (assessment["topic_id"],),

        ).fetchall()

    return {

        "assessment": assessment,

        "questions": [{**q, "options": _normalise_options(q["options"])} for q in questions],

    }

@app.get("/students/{student_id}/test-history")
def get_test_history(student_id: int, limit: int = 50):
    """Get a student's recent test attempts."""

    if limit < 1 or limit > 100:
        raise HTTPException(
            status_code=400,
            detail="Limit must be between 1 and 100."
        )

    with get_connection() as connection:
        student = connection.execute(
            "SELECT id FROM students WHERE id = %s",
            (student_id,)
        ).fetchone()

        if not student:
            raise HTTPException(
                status_code=404,
                detail="Student not found."
            )

        rows = connection.execute(
            """
            SELECT
                at.id AS attempt_id,
                at.assessment_id,
                a.title AS test_name,
                at.total_questions,
                at.score,
                at.started_at,
                at.completed_at,
                at.duration_seconds
            FROM attempts AS at
            JOIN assessments AS a
                ON a.id = at.assessment_id
            WHERE at.student_id = %s
            ORDER BY at.started_at DESC, at.id DESC
            LIMIT %s
            """,
            (student_id, limit)
        ).fetchall()

    history = []

    for row in rows:
        item = dict(row)
        item["status"] = (
            "completed"
            if item["completed_at"] is not None
            else "in_progress"
        )
        history.append(item)

    return {
        "student_id": student_id,
        "total_returned": len(history),
        "history": history
    }

@app.post("/tests/submit")

def submit_test(submission: TestAnswerSubmission):

    """Score only the exact questions delivered to the frontend, then persist results."""

    question_ids = list(dict.fromkeys(submission.question_ids))

    if len(question_ids) != len(submission.question_ids):

        raise HTTPException(status_code=400, detail="Duplicate question IDs are not allowed")

    if set(submission.answers.keys()) - set(question_ids):

        raise HTTPException(status_code=400, detail="Answers contain question IDs not in this test")

    with get_connection() as connection:

        with connection.transaction():

            assessment = connection.execute(

                "SELECT id, title, topic_id FROM assessments WHERE id = %s",

                (submission.assessment_id,),

            ).fetchone()

            if not assessment:

                raise HTTPException(status_code=404, detail="Assessment not found")

            student = connection.execute(

                "SELECT id FROM students WHERE id = %s", (submission.student_id,)

            ).fetchone()

            if not student:

                raise HTTPException(status_code=404, detail="Student not found. Refresh and try again.")

            placeholders = ",".join(["%s"] * len(question_ids))

            questions = connection.execute(

                f"""

                SELECT q.id, q.topic_id, q.question_text, q.options, q.correct_option,

                       q.explanation, q.difficulty, t.name AS topic_name, t.subject

                FROM questions q JOIN topics t ON t.id = q.topic_id

                WHERE q.id IN ({placeholders})

                """,

                tuple(question_ids),

            ).fetchall()

            if len(questions) != len(question_ids):

                raise HTTPException(status_code=400, detail="One or more questions no longer exist")

            by_id = {q["id"]: q for q in questions}

            attempt = connection.execute(

                """

                INSERT INTO attempts (student_id, assessment_id, total_questions)

                VALUES (%s, %s, %s) RETURNING id, started_at

                """,

                (submission.student_id, submission.assessment_id, len(question_ids)),

            ).fetchone()

            results = []

            correct_count = 0

            for qid in question_ids:

                q = by_id[qid]

                selected = submission.answers.get(qid)

                correct = bool(selected) and selected.strip().upper() == q["correct_option"].upper()

                correct_count += int(correct)

                connection.execute(

                    """

                    INSERT INTO answers (attempt_id, question_id, selected_option, is_correct)

                    VALUES (%s, %s, %s, %s)

                    """,

                    (attempt["id"], qid, selected, correct),

                )

                results.append({

                    "question_id": qid,

                    "question_text": q["question_text"],

                    "options": _normalise_options(q["options"]),

                    "selected_option": selected,

                    "is_correct": correct,

                    "correct_option": q["correct_option"],

                    "explanation": q["explanation"],

                    "difficulty": q["difficulty"],

                    "topic_name": q["topic_name"],

                    "subject": q["subject"],

                })

            score = round(correct_count / len(question_ids) * 100, 2)

            connection.execute(

                "UPDATE attempts SET score = %s, completed_at = NOW() WHERE id = %s",

                (score, attempt["id"]),

            )

    unanswered = len(question_ids) - len(submission.answers)

    return {

        "attempt_id": attempt["id"],

        "assessment_id": submission.assessment_id,

        "title": assessment["title"],

        "score": score,

        "correct_answers": correct_count,

        "incorrect_answers": len(submission.answers) - correct_count,

        "unanswered": unanswered,

        "total_questions": len(question_ids),

        "duration_seconds": submission.duration_seconds,

        "results": results,

    }

@app.get("/full-mock-test")

def get_existing_full_mock():

    """Return one prepared full mock assembled from existing questions."""

    with get_connection() as connection:

        assessment = connection.execute(

            """

            SELECT id, title FROM assessments

            WHERE topic_id IS NULL AND title = 'Full Mock Test'

            ORDER BY id LIMIT 1

            """

        ).fetchone()

        if not assessment:

            assessment = connection.execute(

                "INSERT INTO assessments (title, topic_id) VALUES ('Full Mock Test', NULL) RETURNING id, title"

            ).fetchone()

        questions = connection.execute(

            """

            SELECT q.id, q.topic_id, q.question_text, q.options, q.difficulty,

                   t.name AS topic_name, t.subject

            FROM questions q

            JOIN topics t ON t.id = q.topic_id

            ORDER BY q.id

            LIMIT 30

            """

        ).fetchall()

    if not questions:

        return {"assessment": assessment, "questions": [], "message": "No saved questions are available yet."}

    return {

        "assessment": assessment,

        "questions": [{**q, "options": _normalise_options(q["options"])} for q in questions],

    }

# ---------- Persistent AI Tutor Chat History ----------

class CreateChatRequest(BaseModel):

    student_id: int = Field(gt=0)

    title: str = Field(default="New chat", min_length=1, max_length=200)

class SaveChatMessageRequest(BaseModel):

    student_id: int = Field(gt=0)

    role: str

    content: str = Field(min_length=1)

class SaveChatExchangeRequest(BaseModel):
    student_id: int = Field(gt=0)
    question: str = Field(min_length=1, max_length=4000)
    answer: str = Field(min_length=1, max_length=20000)
    attachment: dict[str, object] | None = None

@app.post("/chats")

def create_chat(request: CreateChatRequest):

    with get_connection() as connection:

        student = connection.execute(

            "SELECT id FROM students WHERE id = %s",

            (request.student_id,),

        ).fetchone()

        if not student:

            raise HTTPException(status_code=404, detail="Student not found")

        chat = connection.execute(

            """

            INSERT INTO conversations (student_id, title)

            VALUES (%s, %s)

            RETURNING id, student_id, title, created_at, updated_at

            """,

            (request.student_id, request.title.strip() or "New chat"),

        ).fetchone()

    return {"chat": chat}

@app.get("/chats")

def list_chats(student_id: int):

    with get_connection() as connection:

        student = connection.execute(

            "SELECT id FROM students WHERE id = %s",

            (student_id,),

        ).fetchone()

        if not student:

            raise HTTPException(status_code=404, detail="Student not found")

        chats = connection.execute(

            """

            SELECT id, title, created_at, updated_at

            FROM conversations

            WHERE student_id = %s

            ORDER BY updated_at DESC, id DESC

            """,

            (student_id,),

        ).fetchall()

    return {"chats": chats}

@app.get("/chats/{chat_id}")

def get_chat(chat_id: int, student_id: int):

    with get_connection() as connection:

        chat = connection.execute(

            """

            SELECT id, student_id, title, created_at, updated_at

            FROM conversations

            WHERE id = %s AND student_id = %s

            """,

            (chat_id, student_id),

        ).fetchone()

        if not chat:

            raise HTTPException(status_code=404, detail="Chat not found")

        messages = connection.execute(

            """

            SELECT id, role, content, metadata, created_at

            FROM chat_messages

            WHERE conversation_id = %s

            ORDER BY created_at ASC, id ASC

            """,

            (chat_id,),

        ).fetchall()

    return {"chat": chat, "messages": messages}

@app.post("/chats/{chat_id}/messages")

def save_chat_exchange(chat_id: int, request: SaveChatExchangeRequest):

    with get_connection() as connection:

        with connection.transaction():

            chat = connection.execute(

                """

                SELECT id, title

                FROM conversations

                WHERE id = %s AND student_id = %s

                FOR UPDATE

                """,

                (chat_id, request.student_id),

            ).fetchone()

            if not chat:

                raise HTTPException(status_code=404, detail="Chat not found")

            user_metadata = {"attachment": request.attachment} if request.attachment else {}
            connection.execute(
                """
                INSERT INTO chat_messages
                    (conversation_id, role, content, metadata)
                VALUES (%s, 'user', %s, %s::jsonb),
                       (%s, 'assistant', %s, '{}'::jsonb)
                """,
                (chat_id, request.question, json.dumps(user_metadata), chat_id, request.answer),
            )

            title = chat["title"]

            if title == "New chat":

                title = request.question.strip().replace("\n", " ")[:60]

                if not title:

                    title = "New chat"

            connection.execute(

                """

                UPDATE conversations

                SET title = %s, updated_at = NOW()

                WHERE id = %s

                """,

                (title, chat_id),

            )

    return {"message": "Chat exchange saved", "chat_id": chat_id}

@app.delete("/chats/{chat_id}")

def delete_chat(chat_id: int, student_id: int):

    with get_connection() as connection:

        result = connection.execute(

            """

            DELETE FROM conversations

            WHERE id = %s AND student_id = %s

            RETURNING id

            """,

            (chat_id, student_id),

        ).fetchone()

        if not result:

            raise HTTPException(status_code=404, detail="Chat not found")

    return {"message": "Chat deleted", "chat_id": chat_id}

# ---------- PDF Upload and Embedding Storage ----------

# ---------- PDF Upload and Embedding Storage ----------

@app.post("/documents/upload")

def upload_document(

    student_id: int = Form(..., gt=0),

    chat_id: int = Form(..., gt=0),

    file: UploadFile = File(...),

):

    if not file.filename or not file.filename.lower().endswith(".pdf"):

        raise HTTPException(

            status_code=400,

            detail="Please upload a PDF file.",

        )

    pdf_bytes = file.file.read()

    if not pdf_bytes:

        raise HTTPException(

            status_code=400,

            detail="The uploaded PDF is empty.",

        )

    # Verify that the student exists.

      # Verify that the student and chat exist and belong together.

        # Verify that the student and chat belong together.

    with get_connection() as connection:

        student = connection.execute(

            "SELECT id FROM students WHERE id = %s",

            (student_id,),

        ).fetchone()

        if not student:

            raise HTTPException(

                status_code=404,

                detail="Student not found.",

            )

        chat = connection.execute(

            """

            SELECT id

            FROM public.conversations

            WHERE id = %s AND student_id = %s

            """,

            (chat_id, student_id),

        ).fetchone()

        if not chat:

            raise HTTPException(

                status_code=404,

                detail="Chat not found for this student.",

            )

    # Extract text page by page to preserve source page numbers.

    try:

        reader = PdfReader(io.BytesIO(pdf_bytes))

        if reader.is_encrypted:

            raise HTTPException(

                status_code=400,

                detail="Encrypted PDFs are not supported.",

            )

        total_pages = len(reader.pages)

        page_chunks = []

        for page_number, page in enumerate(reader.pages, start=1):

            page_text = page.extract_text() or ""

            chunks = split_text_into_chunks(page_text)

            for chunk in chunks:

                page_chunks.append({

                    "page_number": page_number,

                    "chunk_text": chunk,

                })

    except HTTPException:

        raise

    except Exception as exc:

        raise HTTPException(

            status_code=400,

            detail="Could not read this PDF file.",

        ) from exc

    if not page_chunks:

        raise HTTPException(

            status_code=400,

            detail="No readable text was found in this PDF.",

        )

    # Generate 384-dimensional embeddings.

    try:

        model = get_embedding_model()

        chunks = [item["chunk_text"] for item in page_chunks]

        embeddings = model.encode(

            chunks,

            normalize_embeddings=True,

            show_progress_bar=False,

        )

    except Exception as exc:

        raise HTTPException(

            status_code=500,

            detail="Could not generate document embeddings.",

        ) from exc

    # Save the document and all its chunks in one transaction.

    # Save the document and all its chunks in one transaction.

    try:

        with get_connection() as connection:

            with connection.transaction():

                document = connection.execute(

                    """

                    INSERT INTO public.documents (

                        student_id,

                        chat_id,

                        document_name,

                        file_size_bytes,

                        total_pages,

                        status

                    )

                    VALUES (%s, %s, %s, %s, %s, 'processing')

                    RETURNING id

                    """,

                    (

                        student_id,

                        chat_id,

                        file.filename,

                        len(pdf_bytes),

                        total_pages,

                    ),

                ).fetchone()

                document_id = document["id"]

                for chunk_index, (item, embedding) in enumerate(

                    zip(page_chunks, embeddings)

                ):

                    vector_literal = (

                        "["

                        + ",".join(

                            str(float(value)) for value in embedding

                        )

                        + "]"

                    )

                    connection.execute(

                        """

                        INSERT INTO public.document_chunks (

                            document_id,

                            chunk_index,

                            page_number,

                            chunk_text,

                            embedding,

                            metadata

                        )

                        VALUES (

                            %s, %s, %s, %s, %s::vector, %s::jsonb

                        )

                        """,

                        (

                            document_id,

                            chunk_index,

                            item["page_number"],

                            item["chunk_text"],

                            vector_literal,

                            json.dumps({

                                "student_id": student_id,

                                "chunk_size": len(item["chunk_text"]),

                            }),

                        ),

                    )

                connection.execute(

                    """

                    UPDATE public.documents

                    SET status = 'processed'

                    WHERE id = %s

                    """,

                    (document_id,),

                )

    except Exception as exc:

        raise HTTPException(

            status_code=500,

            detail=(

                "Could not save the document and its chunks. "

                "Check the database schema and server logs."

            ),

        ) from exc

    return {

        "message": "PDF processed successfully.",

        "document_id": document_id,

        "document_name": file.filename,

        "total_pages": total_pages,

        "chunks_created": len(page_chunks),

        "embedding_dimensions": int(embeddings.shape[1]),

        "status": "processed",

    }

# ---------- Document Management APIs ----------

@app.get("/documents")

@app.get("/documents")

def list_documents(student_id: int, chat_id: int):

    """List PDFs attached to a specific chat."""

    with get_connection() as connection:

        chat = connection.execute(

            """

            SELECT id

            FROM public.conversations

            WHERE id = %s AND student_id = %s

            """,

            (chat_id, student_id),

        ).fetchone()

        if not chat:

            raise HTTPException(

                status_code=404,

                detail="Chat not found for this student.",

            )

        documents = connection.execute(

            """

            SELECT

                id,

                document_name,

                file_size_bytes,

                total_pages,

                status,

                created_at

            FROM public.documents

            WHERE student_id = %s AND chat_id = %s

            ORDER BY created_at DESC, id DESC

            """,

            (student_id, chat_id),

        ).fetchall()

    return {

        "student_id": student_id,

        "chat_id": chat_id,

        "documents": documents,

        "total_documents": len(documents),

    }

@app.delete("/documents/{document_id}")

def delete_document(document_id: int, student_id: int):

    """Delete a student's PDF and its associated chunks."""

    with get_connection() as connection:

        document = connection.execute(

            """

            SELECT id, document_name

            FROM public.documents

            WHERE id = %s AND student_id = %s

            """,

            (document_id, student_id),

        ).fetchone()

        if not document:

            raise HTTPException(

                status_code=404,

                detail="Document not found for this student.",

            )

        connection.execute(

            """

            DELETE FROM public.documents

            WHERE id = %s AND student_id = %s

            """,

            (document_id, student_id),

        )

    return {

        "message": "Document deleted successfully.",

        "document_id": document_id,

        "document_name": document["document_name"],

    }
# Add this endpoint to backend/main.py after the existing test APIs.
# It reads existing assessment records; no new tables are needed.

@app.get("/students/{student_id}/dashboard")
def get_student_dashboard(student_id: int):
    with get_connection() as connection:
        student = connection.execute(
            "SELECT id, name FROM students WHERE id = %s",
            (student_id,),
        ).fetchone()

        if not student:
            raise HTTPException(status_code=404, detail="Student not found")

        stats = connection.execute(
            """
            SELECT
                ROUND(AVG(att.score)::numeric, 2) AS average_accuracy,
                COUNT(att.id)::int AS tests_completed,
                COALESCE(SUM(att.duration_seconds), 0)::bigint AS study_time_seconds
            FROM attempts att
            WHERE att.student_id = %s
              AND att.completed_at IS NOT NULL
            """,
            (student_id,),
        ).fetchone()

        topics = connection.execute(
            """
            SELECT COUNT(DISTINCT q.topic_id)::int AS topics_practiced
            FROM answers ans
            JOIN attempts att ON att.id = ans.attempt_id
            JOIN questions q ON q.id = ans.question_id
            WHERE att.student_id = %s
              AND att.completed_at IS NOT NULL
            """,
            (student_id,),
        ).fetchone()

        recent_tests = connection.execute(
            """
            SELECT
                att.id,
                a.title AS name,
                COALESCE(att.score, 0)::float AS score,
                att.total_questions,
                att.completed_at AS date
            FROM attempts att
            JOIN assessments a ON a.id = att.assessment_id
            WHERE att.student_id = %s
              AND att.completed_at IS NOT NULL
            ORDER BY att.completed_at DESC, att.id DESC
            LIMIT 10
            """,
            (student_id,),
        ).fetchall()

        subject_performance = connection.execute(
            """
            SELECT
                t.subject,
                ROUND(
                    100.0 * COUNT(*) FILTER (WHERE ans.is_correct)
                    / NULLIF(COUNT(*), 0),
                    2
                )::float AS accuracy,
                COUNT(*)::int AS questions_answered
            FROM answers ans
            JOIN attempts att ON att.id = ans.attempt_id
            JOIN questions q ON q.id = ans.question_id
            JOIN topics t ON t.id = q.topic_id
            WHERE att.student_id = %s
              AND att.completed_at IS NOT NULL
            GROUP BY t.subject
            ORDER BY t.subject
            """,
            (student_id,),
        ).fetchall()

    return {
        "student": {"id": student["id"], "name": student["name"]},
        "stats": {
            "average_accuracy": (
                float(stats["average_accuracy"])
                if stats["average_accuracy"] is not None
                else None
            ),
            "tests_completed": stats["tests_completed"] or 0,
            "topics_practiced": topics["topics_practiced"] or 0,
            "study_time_seconds": stats["study_time_seconds"] or 0,
        },
        "recent_tests": [
            {
                "id": row["id"],
                "name": row["name"],
                "score": float(row["score"] or 0),
                "total_questions": row["total_questions"],
                "date": row["date"].isoformat() if row["date"] else "",
            }
            for row in recent_tests
        ],
        "subject_performance": [
            {
                "subject": row["subject"] or "Uncategorized",
                "accuracy": (
                    float(row["accuracy"])
                    if row["accuracy"] is not None
                    else None
                ),
                "questions_answered": row["questions_answered"],
            }
            for row in subject_performance
        ],
    }
