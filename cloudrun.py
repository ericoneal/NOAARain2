import os
from typing import Any, Dict
from datetime import datetime, timedelta
import traceback
from google.cloud import datastore

# ---- CORS ----
CORS_ORIGIN = "*"
CORS_HEADERS = "Content-Type, X-Requested-With, X-API-Key"
CORS_METHODS = "GET,OPTIONS"

# ---- DATASTORE ----
PROJECT_ID = "noaarain"
NAMESPACE = None
ds = datastore.Client(project=PROJECT_ID, namespace=NAMESPACE)


def _dt_str_ampm(dt: datetime) -> str:
    """
    Format datetime using 12-hour clock with AM/PM.
    No timezone conversion is performed.
    Example: 08/09/2021 01:42:50 PM
    """
    if not isinstance(dt, datetime):
        return None
    return dt.strftime("%m/%d/%Y %I:%M:%S %p")


def _json(data, status=200, headers=None):
    import json
    base = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Headers": CORS_HEADERS,
        "Access-Control-Allow-Methods": CORS_METHODS,
    }
    if headers:
        base.update(headers)
    return (json.dumps(data, default=str), status, base)


def handler(request):
    try:
        method = request.method.upper()
        path = (request.path or "/").rstrip("/") or "/"

        # CORS preflight
        if method == "OPTIONS":
            return ("", 204, {
                "Access-Control-Allow-Origin": CORS_ORIGIN,
                "Access-Control-Allow-Headers": CORS_HEADERS,
                "Access-Control-Allow-Methods": CORS_METHODS,
                "Access-Control-Max-Age": "3600",
            })

        # Home
        if method == "GET" and path == "/":
            return _json({
                "ok": True,
                "routes": [
                    "GET /v1/nexrain/points",
                    "GET /v1/nexrain/recent?point=...&limit=..."
                ]
            })

        # GET /v1/nexrain/points  (also allow /nexrain/points)
        if method == "GET" and path in ("/v1/nexrain/mtbpoints", "/nexrain/mtbpoints"):
            # Projection/distinct is efficient if supported
            try:
                q = ds.query(kind="RAINPOINTS")
                q.add_filter("POINTTYPE", "=", "MTB")
                q.projection = ["POINTNAME"]
                q.distinct_on = ["POINTNAME"]
                q.order = ["POINTNAME"]

                points = []
                for e in q.fetch():
                    p = e.get("POINTNAME")
                    if p:
                        points.append(p)

                points = sorted(set(points))
                return _json({"count": len(points), "items": points})

            except Exception:
                # Fallback: fetch projection + de-dupe client-side
                q = ds.query(kind="RAINPOINTS")
                q.add_filter("POINTTYPE", "=", "MTB")
                q.projection = ["POINTNAME"]

                s = set()
                for e in q.fetch():
                    p = e.get("POINTNAME")
                    if p:
                        s.add(p)

                points = sorted(s)
                return _json({"count": len(points), "items": points})

# GET /v1/nexrain/points  (also allow /nexrain/points)
        if method == "GET" and path in ("/v1/nexrain/allpoints", "/nexrain/allpoints"):
            # Projection/distinct is efficient if supported
            try:
                q = ds.query(kind="RAINPOINTS")
                q.projection = ["POINTNAME"]
                q.distinct_on = ["POINTNAME"]
                q.order = ["POINTNAME"]

                points = []
                for e in q.fetch():
                    p = e.get("POINTNAME")
                    if p:
                        points.append(p)

                points = sorted(set(points))
                return _json({"count": len(points), "items": points})

            except Exception:
                # Fallback: fetch projection + de-dupe client-side
                q = ds.query(kind="RAINPOINTS")
                q.projection = ["POINTNAME"]

                s = set()
                for e in q.fetch():
                    p = e.get("POINTNAME")
                    if p:
                        s.add(p)

                points = sorted(s)
                return _json({"count": len(points), "items": points})                

        # GET /v1/nexrain/recent?point=...  (last 7 days)
        if method == "GET" and path == "/v1/nexrain/recent":
            point = (request.args.get("point") if request.args else "") or ""
            point = point.strip()
            if not point:
                return _json({"error": "Missing required query param: point"}, 400)

            now_utc = datetime.utcnow()
            start_utc = now_utc - timedelta(days=7)

            q = ds.query(kind="NEXRAIN")
            q.add_filter("POINTNAME", "=", point)
            q.add_filter("DT", ">=", start_utc)
            q.add_filter("DT", "<=", now_utc)
            q.order = ["DT"]

            limit = int((request.args.get("limit") if request.args else "1000") or "1000")
            limit = max(1, min(limit, 10000))

            items = []
            for e in q.fetch(limit=limit):
                dtv = e.get("DT")
                items.append({
                    "POINTNAME": e.get("POINTNAME"),
                    "DT": _dt_str_ampm(dtv),
                    "DT_ISO": dtv.isoformat() if isinstance(dtv, datetime) else None,
                    "DBZ": e.get("DBZ"),
                })

            return _json({
                "point": point,
                "start": _dt_str_ampm(start_utc),
                "end": _dt_str_ampm(now_utc),
                "count": len(items),
                "items": items
            })

        # 404
        return _json({"error": "Not found", "path": path, "method": method}, 404)

    except Exception as ex:
        tb = traceback.format_exc()
        print(tb)
        return _json({"error": str(ex), "trace": tb}, 500)
