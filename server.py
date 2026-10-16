import os
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Project IDEA - Knowledge Assimilation Engine")

# Placeholder health check
@app.get("/health")
def health():
    return {"status": "ok", "service": "project-idea", "model": "gemini-4-argon"}

@app.get("/api/state")
def get_state():
    return {
        "status": "ready",
        "concepts": [],
        "relations": [],
        "changesets": []
    }

@app.get("/", response_class=HTMLResponse)
def index():
    return """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Project IDEA — Knowledge Assimilation Engine</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px; }
        .card { background: #1e293b; padding: 24px; border-radius: 12px; max-width: 800px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
        h1 { color: #38bdf8; margin-top: 0; }
        .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Project IDEA <span class="badge">gemini-4-argon</span></h1>
        <p>Autonomous Knowledge Assimilation Engine — Continuous Delivery Baseline</p>
        <p>Deployment successfully initialized on Google Cloud Run.</p>
    </div>
</body>
</html>"""
