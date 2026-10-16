import json
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

FRONTEND_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Project IDEA - Frontend Tier")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "tier": "frontend",
        "service": "project-idea-frontend",
    }


@app.get("/", response_class=HTMLResponse)
@app.get("/index.html", response_class=HTMLResponse)
def serve_index():
    index_path = FRONTEND_DIR / "index.html"
    html = index_path.read_text(encoding="utf-8")
    backend_api_url = os.getenv("BACKEND_API_URL", "http://localhost:8000")
    injected_script = (
        f"<script>window.BACKEND_API_URL = {json.dumps(backend_api_url)};</script>\n"
        '    <script src="/static/app.js"></script>'
    )
    html = html.replace('<script src="/static/app.js"></script>', injected_script, 1)
    return HTMLResponse(content=html)


@app.get("/app.js")
@app.get("/static/app.js")
def serve_app_js():
    return FileResponse(
        FRONTEND_DIR / "app.js",
        media_type="application/javascript",
    )


@app.get("/scene_physics.js")
@app.get("/static/scene_physics.js")
def serve_scene_physics_js():
    return FileResponse(
        FRONTEND_DIR / "scene_physics.js",
        media_type="application/javascript",
    )


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend-static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("FRONTEND_PORT", "3000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
