"""Loopback FastAPI wrapper for in-process Student Housing runs."""
from __future__ import annotations

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import SessionState, run_react_agent, sanitize
from mcp_server import MCPHousingServer
from providers import get_llm_provider


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    session_id: str | None = None


class RunStore:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.sessions: Dict[str, SessionState] = {}
        self.runs: Dict[str, Dict[str, Any]] = {}
        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="housing-run")
        self.server = MCPHousingServer()
        self.mode = os.getenv("WEB_LLM_MODE", "mock").lower()

    def create(self, message: str, session_id: str | None) -> Dict[str, Any]:
        with self.lock:
            if session_id is None:
                session = SessionState(); self.sessions[session.session_id] = session
            else:
                session = self.sessions.get(session_id)
                if session is None: raise LookupError("SESSION_NOT_FOUND")
                if any(r["session_id"] == session_id and r["status"] == "RUNNING" for r in self.runs.values()): raise RuntimeError("SESSION_BUSY")
            run_id = f"run-{uuid.uuid4().hex[:12]}"
            record = {"run_id": run_id, "session_id": session.session_id, "status": "RUNNING", "last_seq": 0, "events": [], "result": None, "error": None}
            self.runs[run_id] = record
        self.executor.submit(self._execute, run_id, message, session)
        return {"run_id": run_id, "session_id": session.session_id, "status": "RUNNING"}

    def _execute(self, run_id: str, message: str, session: SessionState) -> None:
        def on_event(event: Dict[str, Any]) -> None:
            with self.lock:
                record = self.runs[run_id]; record["events"].append(event); record["last_seq"] = event["seq"]
        try:
            provider = get_llm_provider(self.mode)
            completed = run_react_agent(message, provider, self.server, session=session, event_callback=on_event, run_id=run_id)
            with self.lock:
                record = self.runs[run_id]; record["status"] = completed["status"]; record["result"] = completed["result"]; record["error"] = completed["error"]
        except Exception as exc:
            with self.lock:
                record = self.runs[run_id]; record["status"] = "FAILED"; record["error"] = {"code": "RUN_FAILED", "message": sanitize(f"Run thất bại: {type(exc).__name__}")}

    def snapshot(self, run_id: str, after_seq: int) -> Dict[str, Any]:
        with self.lock:
            record = self.runs.get(run_id)
            if record is None: raise LookupError("RUN_NOT_FOUND")
            return {"run_id": record["run_id"], "session_id": record["session_id"], "status": record["status"], "last_seq": record["last_seq"], "events": [event for event in record["events"] if event["seq"] > after_seq], "result": record["result"], "error": record["error"]}


store = RunStore()
app = FastAPI(title="Student Housing ReAct API", version="1.0")


def api_error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})


@app.exception_handler(Exception)
async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    return api_error(500, "INTERNAL_ERROR", f"Lỗi máy chủ đã được che ({type(exc).__name__}).")


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
    return api_error(422, "INVALID_REQUEST", "Request không đúng schema hoặc message ngoài giới hạn 1–8000 ký tự.")


@app.post("/api/runs", status_code=202)
def create_run(body: RunRequest):
    try: return store.create(body.message, body.session_id)
    except LookupError: return api_error(404, "SESSION_NOT_FOUND", "Session không tồn tại hoặc đã mất sau khi server khởi động lại.")
    except RuntimeError: return api_error(409, "SESSION_BUSY", "Session đang có một run hoạt động.")


@app.get("/api/runs/{run_id}")
def get_run(run_id: str, after_seq: int = Query(default=0, ge=0)):
    try: return store.snapshot(run_id, after_seq)
    except LookupError: return api_error(404, "RUN_NOT_FOUND", "Không tìm thấy run.")


WEB_DIR = Path(__file__).resolve().parent.parent / "web"
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web_api:app", host="127.0.0.1", port=int(os.getenv("PORT", "8000")), reload=False)
