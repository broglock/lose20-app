"""Lose20 daily nag for Windows.

Run by Task Scheduler a few times a day. It pulls your synced data from the
private GitHub repo, works out how today is going, has Maya say something about
it in her neural voice, and opens her check-in window (the same app in desk mode).

Standard library only. Python 3.9+.

    pythonw nag.py --slot morning      (morning | midday | evening | night)
    python  nag.py --slot evening --test   (sample data, prints instead of opening)
"""
import argparse
import base64
import datetime as dt
import json
import os
import random
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
LOG = HERE / "nag.log"
LB_PER_KG = 2.20462
VERSION_FILE = HERE / "VERSION"
UPDATABLE = ("nag.py", "install_tasks.ps1", "config.example.json")   # never config.json


def log(msg):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def http(url, method="GET", headers=None, body=None, timeout=30):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ---------------------------------------------------------------- self-update
def check_for_update(cfg):
    """Download a newer release from the app site, verify SHA-256 hashes, swap files in.
    Returns True if files were replaced. Any failure leaves the current files untouched."""
    import hashlib
    if not cfg.get("app_url") or cfg.get("auto_update") is False:
        return False
    base = cfg["app_url"].split("?")[0].rsplit("/", 1)[0]
    manifest = json.loads(http(f"{base}/version.json?t={int(dt.datetime.now().timestamp())}", timeout=15))
    remote = manifest.get("version")
    local = VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else "0"
    files = manifest.get("windows", {})
    if not remote or remote == local or not files:
        return False
    staged = {}
    for name, want in files.items():
        if name not in UPDATABLE:
            raise ValueError(f"manifest lists unexpected file {name}")
        data = http(f"{base}/windows/{name}?v={remote}", timeout=30)
        got = hashlib.sha256(data).hexdigest()
        if got != want:
            raise ValueError(f"hash mismatch for {name}")
        staged[name] = data
    for name, data in staged.items():          # all verified, now replace
        tmp = HERE / (name + ".new")
        tmp.write_bytes(data)
        os.replace(tmp, HERE / name)
    VERSION_FILE.write_text(remote)
    log(f"updated {local} -> {remote}")
    return True


# ---------------------------------------------------------------- data
def pull_data(cfg):
    url = f"https://api.github.com/repos/{cfg['github_repo']}/contents/{cfg.get('github_path', 'data.json')}"
    raw = http(url, headers={"Authorization": "Bearer " + cfg["github_token"],
                             "Accept": "application/vnd.github+json",
                             "X-GitHub-Api-Version": "2022-11-28"})
    j = json.loads(raw)
    return json.loads(base64.b64decode(j["content"]).decode("utf-8"))


def live(rows):
    return [r for r in rows or [] if not r.get("deleted")]


def targets(p, lb):
    kg, cm = lb / LB_PER_KG, p["heightIn"] * 2.54
    bmr = 10 * kg + 6.25 * cm - 5 * p["age"] + (-161 if p.get("sex") == "female" else 5)
    tdee = bmr * p.get("activityFactor", 1.5)
    kcal = max(1200 if p.get("sex") == "female" else 1500,
               round((tdee - p.get("paceLbPerWeek", 1) * 500) / 10) * 10)
    return {"kcal": kcal, "protein": round(kg * 1.4)}


def trend_weight(state, today):
    ws = sorted(live(state["weights"]), key=lambda w: w["date"])
    if not ws:
        return state["profile"]["startWeight"], None
    by = {w["date"]: w["lb"] for w in ws}
    d = dt.date.fromisoformat(ws[0]["date"])
    t = ws[0]["lb"]
    while d <= today:
        if d.isoformat() in by:
            t += 0.1 * (by[d.isoformat()] - t)
        d += dt.timedelta(days=1)
    return round(t, 1), ws[-1]["date"]


def day_totals(state, date):
    ms = [m for m in live(state["meals"]) if m["date"] == date]
    return {"kcal": sum(m.get("kcal", 0) or 0 for m in ms),
            "protein": sum(m.get("protein", 0) or 0 for m in ms),
            "meals": len(ms)}


def summarize(state, now):
    p = state["profile"]
    today = now.date()
    weight, last_w = trend_weight(state, today)
    T = targets(p, weight)
    t = day_totals(state, today.isoformat())
    y = day_totals(state, (today - dt.timedelta(days=1)).isoformat())
    prev = [(today - dt.timedelta(days=i)).isoformat() for i in range(1, 7)]
    prev = [d for d in prev if d >= p.get("startDate", "0000")]
    logged = [day_totals(state, d) for d in prev]
    logged = [d for d in logged if d["meals"]]
    js_dow = (today.weekday() + 1) % 7          # JS getDay(): Sunday = 0
    gym_day = js_dow in p.get("gymDays", [1, 3, 5])
    gym_done = any(w["date"] == today.isoformat() and w.get("done", True) and (w.get("type") in ("weights", "run") or not w.get("extra")) for w in live(state["workouts"]))
    avg_protein = round(sum(d["protein"] for d in logged) / len(logged)) if logged else None
    return {
        "name": p.get("name", "David"), "coach": p.get("coachName", "Maya"), "coach_voice": p.get("coachVoice"),
        "coach_role": p.get("coachRole", ""), "coach_style": p.get("coachStyle", ""), "coach_lines": p.get("coachLines") or [],
        "weight": weight, "lost": round(p["startWeight"] - weight, 1),
        "goal_lb": p["startWeight"] - p["goalWeight"],
        "weighed_today": last_w == today.isoformat(),
        "days_since_weigh": (today - dt.date.fromisoformat(last_w)).days if last_w else None,
        "kcal_target": T["kcal"], "protein_target": T["protein"],
        "today_kcal": round(t["kcal"]), "today_protein": round(t["protein"]), "today_meals": t["meals"],
        "yesterday_kcal": round(y["kcal"]), "yesterday_meals": y["meals"],
        "days_logged": len(logged), "days_counted": len(prev), "avg_protein": avg_protein,
        "gym_day": gym_day, "gym_done": gym_done,
    }


def summary_text(s):
    return "\n".join([
        f"Trend weight {s['weight']} lb, lost {s['lost']} of {s['goal_lb']} lb.",
        f"Weighed in today: {'yes' if s['weighed_today'] else 'no'}"
        + (f" (last weigh-in {s['days_since_weigh']} days ago)" if s['days_since_weigh'] else ""),
        f"Today: {s['today_kcal']} of {s['kcal_target']} kcal, {s['today_protein']} of {s['protein_target']} g protein, {s['today_meals']} meals logged.",
        f"Yesterday: {s['yesterday_kcal']} kcal over {s['yesterday_meals']} meals.",
        f"Food logged on {s['days_logged']} of the last {s['days_counted']} days. Average protein {s['avg_protein']} g.",
        f"Gym day today: {'yes' if s['gym_day'] else 'no'}" + (f", done: {'yes' if s['gym_done'] else 'not yet'}" if s['gym_day'] else ""),
    ])


# ---------------------------------------------------------------- message
SLOT_BRIEF = {
    "morning": "It is morning. Push the weigh-in if not done, and a high-protein breakfast. Mention the gym if it is a gym day.",
    "midday": "It is lunchtime. Check whether breakfast was logged, push logging lunch with a photo, and protein.",
    "evening": "It is late afternoon before dinner. Say how many calories and grams of protein are left and steer dinner. Mention the gym if still not done on a gym day.",
    "night": "It is evening. Kitchen is closing. Review the day honestly: what went right, what went wrong, and make sure everything eaten got logged.",
}


def template_message(s, slot):
    n, left = s["name"], s["kcal_target"] - s["today_kcal"]
    if slot == "morning":
        parts = [f"Morning, {n}."]
        parts.append("Scale first, then breakfast." if not s["weighed_today"] else f"Trend is {s['weight']}. Nice work weighing in.")
        if s["gym_day"]:
            parts.append("Gym day today. Weights and your 5k.")
        parts.append("Aim for 30 grams of protein at breakfast.")
    elif slot == "midday":
        parts = [f"Lunch check, {n}.",
                 "Nothing logged yet today. Snap your lunch for me." if s["today_meals"] == 0
                 else f"You are at {s['today_kcal']} calories so far. Log lunch with a photo."]
    elif slot == "evening":
        parts = [f"Hey {n}. You have about {left} calories and {max(0, s['protein_target'] - s['today_protein'])} grams of protein left.",
                 "Make dinner lean protein and a big pile of vegetables."]
        if s["gym_day"] and not s["gym_done"]:
            parts.append("And the gym is still waiting for you.")
    else:
        parts = [f"Kitchen is closed, {n}."]
        if left < 0:
            parts.append(f"You came in {-left} over today. Tomorrow we reset.")
        elif left > 700:
            parts.append(f"You are {left} under target, which is too low or not fully logged. Log everything, and do not starve, it costs muscle.")
        else:
            parts.append(f"You finished {left} under target. That is how the pounds come off.")
        if s["days_logged"] < s["days_counted"]:
            parts.append("Make sure everything you ate today is logged.")
    return " ".join(parts)


def claude_message(cfg, s, slot):
    role_line = (f"You are a {s['coach_role'].lower()} character and you stay in character: {s['coach_style']} "
                 if s.get("coach_role") and s["coach_role"] != "Fitness coach" else "")
    if s.get("coach_lines"):
        role_line += ("Your catchphrases, spun on weight loss: " + " ".join(f'"{l}"' for l in s["coach_lines"])
                      + " Use one now and then, not every time, or invent a new one in the same spirit. ")
    system = (f"You are {s['coach']}, a quick-witted fitness and nutrition coach. You are doing a short "
              f"scheduled check-in with {s['name']}, 60, who is losing 20 lb, lifts weights and runs 5 km three times a week. "
              "Whatever the character, you are on his side: direct and a little playful. Point out the most important thing going wrong and one concrete fix. "
              "Evidence you rely on: log every meal, weigh daily and watch the trend, same eating on weekends, breakfast, "
              "high protein to keep muscle, vegetables for volume, few liquid calories. No crash dieting. "
              f"{role_line}"
              "Never scold. If he has missed days of logging, be warm, skip the guilt, and ask for one small action right now. "
              "Ask for only one thing per check-in. "
              "This is spoken aloud: 2 or 3 short sentences, no lists, no emoji, no markdown.")
    user = f"{SLOT_BRIEF[slot]}\n\nHis data:\n{summary_text(s)}"
    body = json.dumps({"model": cfg.get("claude_model", "claude-sonnet-5-5"), "max_tokens": 2000,
                       "system": system, "messages": [{"role": "user", "content": user}]}).encode()
    raw = http("https://api.anthropic.com/v1/messages", "POST",
               {"x-api-key": cfg["anthropic_key"], "anthropic-version": "2023-06-01", "content-type": "application/json"}, body)
    j = json.loads(raw)
    u = j.get("usage", {})
    USAGE.append({"kind": "windows check-in", "service": "claude", "input": u.get("input_tokens", 0), "output": u.get("output_tokens", 0),
                  "cacheRead": u.get("cache_read_input_tokens", 0), "cacheWrite": u.get("cache_creation_input_tokens", 0)})
    text = " ".join(c["text"] for c in j["content"] if c["type"] == "text").strip()
    if not text:
        raise ValueError("Claude returned no text")   # falls back to the template message
    return text


# ---------------------------------------------------------------- usage log
USAGE = []   # filled during this run, then added to the synced data so the app can show costs


def push_usage(cfg):
    """Add this run's token and voice usage to data.json (one record per day and kind, like the app)."""
    if not USAGE or not cfg.get("github_token"):
        return
    url = f"https://api.github.com/repos/{cfg['github_repo']}/contents/{cfg.get('github_path', 'data.json')}"
    hdr = {"Authorization": "Bearer " + cfg["github_token"], "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    for attempt in range(3):
        try:
            j = json.loads(http(url, headers=hdr))
            data = json.loads(base64.b64decode(j["content"]).decode("utf-8"))
            rows = data.setdefault("usage", [])
            today = dt.date.today().isoformat()
            now_ms = int(dt.datetime.now().timestamp() * 1000)
            for u in USAGE:
                rid = f"{today}|pc-checkin|{u['kind']}"
                r = next((x for x in rows if x.get("id") == rid), None)
                if not r:
                    r = {"id": rid, "date": today, "device": "pc-checkin", "kind": u["kind"], "service": u["service"],
                         "calls": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "chars": 0}
                    rows.append(r)
                r["calls"] += 1
                for k in ("input", "output", "cacheRead", "cacheWrite", "chars"):
                    r[k] = r.get(k, 0) + u.get(k, 0)
                r["updatedAt"] = now_ms
            body = json.dumps({"message": "usage from Windows check-in", "sha": j["sha"],
                               "content": base64.b64encode(json.dumps(data).encode("utf-8")).decode()}).encode()
            http(url, "PUT", dict(hdr, **{"Content-Type": "application/json"}), body)
            return
        except urllib.error.HTTPError as e:
            if e.code != 409 or attempt == 2:
                raise


# ---------------------------------------------------------------- voice and window
def speak(cfg, text, voice=None, rate=None, pitch=None, style=None):
    from xml.sax.saxutils import escape, quoteattr
    voice = voice or cfg.get("azure_voice") or "en-US-AvaMultilingualNeural"
    inner = f'<prosody rate={quoteattr(rate or "0%")} pitch={quoteattr(pitch or "0%")}>{escape(text)}</prosody>'
    if style:   # coach's Azure speaking style, e.g. the sergeant shouts
        inner = f'<mstts:express-as style={quoteattr(style)}>{inner}</mstts:express-as>'
    ssml = ('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" '
            f'xml:lang="en-US"><voice name={quoteattr(voice)}>{inner}</voice></speak>')
    audio = http(f"https://{cfg['azure_region']}.tts.speech.microsoft.com/cognitiveservices/v1", "POST",
                 {"Ocp-Apim-Subscription-Key": cfg["azure_key"], "Content-Type": "application/ssml+xml",
                  "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm", "User-Agent": "lose20"},
                 ssml.encode("utf-8"))
    USAGE.append({"kind": "voice", "service": "azure", "chars": len(text)})
    path = Path(tempfile.gettempdir()) / "lose20_maya.wav"
    path.write_bytes(audio)
    import winsound  # Windows only
    winsound.PlaySound(str(path), winsound.SND_FILENAME)


def find_edge():
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            p = Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if p.exists():
                return str(p)
    return None


def open_window(cfg, msg):
    url = cfg["app_url"].split("?")[0] + "?desk=1&msg=" + urllib.parse.quote(msg)
    # Hand the keys to the Edge window too (its storage is separate from the phone), so it shows your
    # synced data and talks in Maya's neural voice instead of the Windows text-to-speech voice.
    # The part after # never leaves this PC; the app saves it and clears it from the address bar.
    keys = {"key": cfg.get("anthropic_key"), "repo": cfg.get("github_repo"), "gh": cfg.get("github_token"),
            "az": cfg.get("azure_key"), "region": cfg.get("azure_region")}
    keys = {k: v for k, v in keys.items() if v and "..." not in v}
    if keys:
        url += "#setup&" + urllib.parse.urlencode(keys)
    edge = find_edge()
    if edge:
        subprocess.Popen([edge, f"--app={url}", "--window-size=1100,820"])
    else:
        import webbrowser
        webbrowser.open(url)


def pick_slot(now):
    h = now.hour
    return "morning" if h < 11 else "midday" if h < 15 else "evening" if h < 19 else "night"


# ---------------------------------------------------------------- main
def sample_state():
    today = dt.date.today()
    st = {"profile": {"name": "David", "coachName": "Maya", "sex": "male", "age": 60, "heightIn": 70,
                      "startWeight": 185, "goalWeight": 165, "startDate": (today - dt.timedelta(days=20)).isoformat(),
                      "paceLbPerWeek": 1, "gymDays": [1, 3, 5], "activityFactor": 1.5},
          "weights": [], "meals": [], "workouts": []}
    for i in range(20, 0, -1):
        d = (today - dt.timedelta(days=i)).isoformat()
        st["weights"].append({"id": f"w{i}", "date": d, "lb": round(185 - (20 - i) * 0.12 + random.uniform(-0.8, 0.8), 1)})
        st["meals"].append({"id": f"m{i}", "date": d, "time": "12:00", "kcal": random.choice([1800, 2100, 2400]), "protein": 90})
    st["meals"].append({"id": "t", "date": today.isoformat(), "time": "08:00", "kcal": 420, "protein": 28})
    return st


def main():
    ap = argparse.ArgumentParser(description="Lose20 daily nag")
    ap.add_argument("--slot", choices=list(SLOT_BRIEF), help="time-of-day message; default picks by the clock")
    ap.add_argument("--no-voice", action="store_true")
    ap.add_argument("--no-window", action="store_true")
    ap.add_argument("--test", action="store_true", help="sample data, print only")
    ap.add_argument("--update", action="store_true", help="check for an update now and exit")
    a = ap.parse_args()
    now = dt.datetime.now()
    slot = a.slot or pick_slot(now)
    if a.update:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
        try:
            print("updated" if check_for_update(cfg) else "already current")
        except Exception as e:
            print(f"update failed: {e}")
            log(f"update check failed: {e}")
        return
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}

    # Self-update before doing anything else, then restart once on the new code.
    if not a.test and not os.environ.get("LOSE20_UPDATED"):
        try:
            if check_for_update(cfg):
                env = dict(os.environ, LOSE20_UPDATED="1")
                subprocess.Popen([sys.executable, str(HERE / "nag.py")] + sys.argv[1:], cwd=str(HERE), env=env)
                return
        except Exception as e:
            log(f"update check failed: {e}")

    try:
        state = sample_state() if a.test else pull_data(cfg)
    except Exception as e:
        log(f"data pull failed: {e}")
        state = None

    if state:
        s = summarize(state, now)
        msg = None
        if cfg.get("anthropic_key") and not a.test:
            try:
                msg = claude_message(cfg, s, slot)
            except Exception as e:
                log(f"claude failed: {e}")
        msg = msg or template_message(s, slot)
    else:
        msg = "I could not reach your data, but I am still watching. Log your meals and step on the scale."

    log(f"{slot}: {msg}")
    if a.test:
        print(summary_text(s) if state else "", "\n\n" + msg)
        return
    if not a.no_window and cfg.get("app_url"):
        open_window(cfg, msg)
    if not a.no_voice and cfg.get("azure_key"):
        try:
            prefs = (state or {}).get("prefs") or {}     # voice picked in the app, synced from phone or PC
            tone = {} if prefs.get("voice") else (((state or {}).get("profile") or {}).get("coachTone") or {})
            rate = prefs.get("voiceRate") if prefs.get("voiceRate") not in (None, "", "0%") else tone.get("rate")
            speak(cfg, msg, prefs.get("voice") or (s.get("coach_voice") if state else None), rate, tone.get("pitch"), tone.get("style"))
        except Exception as e:
            log(f"voice failed: {e}")
    try:
        push_usage(cfg)
    except Exception as e:
        log(f"usage log failed: {e}")


if __name__ == "__main__":
    main()
