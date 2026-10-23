"""LLM access: a Gemini client, a generic OpenAI-compatible client (for a second model family), and an offline mock."""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Optional, Protocol

import requests


class LLMError(Exception):
    pass


@dataclass
class LLMResponse:
    text: str
    model_version: str
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    elapsed_s: float = 0.0


class Provider(Protocol):
    def complete(self, *, system: str, user: str, model: str, role: str) -> LLMResponse: ...


RETRYABLE = (408, 409, 425, 429, 500, 502, 503, 504)
MAX_WAIT_S = 90


def _retry_wait(resp: "requests.Response", attempt: int) -> float:
    """How long to wait before trying again. Honours Retry-After and Gemini's 'retryDelay: 34s'."""
    header = resp.headers.get("Retry-After", "")
    if header.replace(".", "", 1).isdigit():
        return min(float(header) + 1, MAX_WAIT_S)
    m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', resp.text)
    if m:
        return min(float(m.group(1)) + 1, MAX_WAIT_S)
    return min(10 * (attempt + 1), MAX_WAIT_S) if resp.status_code == 429 else min(2 ** (attempt + 1), 30)


def _daily_quota_hit(resp: "requests.Response") -> bool:
    return resp.status_code == 429 and bool(re.search(r"PerDay|per day|daily", resp.text, re.I))


class _HTTPProvider:
    """Shared retry loop. Subclasses build the request and read the reply."""

    name = "provider"

    def __init__(self, api_key: str, *, temperature: float = 0.0, max_tokens: int = 32000,
                 timeout_s: int = 600, retries: int = 4):
        self.api_key = api_key
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout_s = timeout_s
        self.retries = retries

    def _request(self, system: str, user: str, model: str) -> tuple[str, dict, dict]:
        raise NotImplementedError

    def _parse(self, data: dict, model: str, role: str) -> LLMResponse:
        raise NotImplementedError

    def complete(self, *, system: str, user: str, model: str, role: str) -> LLMResponse:
        url, headers, body = self._request(system, user, model)
        last = ""
        for attempt in range(self.retries + 1):
            started = time.time()
            wait = 2.0 * (attempt + 1)
            try:
                resp = requests.post(url, headers=headers, json=body, timeout=self.timeout_s)
            except requests.RequestException as exc:
                last = f"network error: {exc}"
            else:
                if resp.status_code == 200:
                    out = self._parse(resp.json(), model, role)
                    out.elapsed_s = round(time.time() - started, 2)
                    return out
                last = f"HTTP {resp.status_code}: {resp.text[:400]}"
                if _daily_quota_hit(resp):
                    raise LLMError(f"{role}/{model}: the daily free quota for this model looks used up. {last}")
                if resp.status_code not in RETRYABLE:
                    raise LLMError(f"{role}/{model}: {last}")  # bad key or unknown model will not fix itself
                wait = _retry_wait(resp, attempt)
            if attempt < self.retries:
                time.sleep(wait)
        raise LLMError(f"{role}/{model}: gave up after {self.retries + 1} tries. {last}")


class GeminiProvider(_HTTPProvider):
    """Google Gemini API, native generateContent. JSON output is requested so replies parse cleanly."""

    name = "gemini"

    def __init__(self, api_key: str, *, base_url: str = "https://generativelanguage.googleapis.com/v1beta", **kw):
        super().__init__(api_key, **kw)
        self.base_url = base_url.rstrip("/")

    def _request(self, system: str, user: str, model: str):
        model_path = model if model.startswith("models/") else f"models/{model}"
        url = f"{self.base_url}/{model_path}:generateContent"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": self.temperature,
                "maxOutputTokens": self.max_tokens,
                "responseMimeType": "application/json",
            },
        }
        return url, headers, body

    def _parse(self, data: dict, model: str, role: str) -> LLMResponse:
        candidates = data.get("candidates") or []
        if not candidates:
            reason = (data.get("promptFeedback") or {}).get("blockReason", "no candidates returned")
            raise LLMError(f"{role}/{model}: Gemini returned no answer ({reason}).")
        cand = candidates[0]
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []) if not p.get("thought"))
        finish = cand.get("finishReason", "")
        if finish == "MAX_TOKENS":
            raise LLMError(f"{role}/{model}: the reply was cut off at the output limit ({self.max_tokens} tokens, "
                           "thinking included). Raise max_tokens in config.yaml.")
        if not text.strip():
            raise LLMError(f"{role}/{model}: empty reply (finishReason {finish or 'unknown'}).")
        usage = data.get("usageMetadata") or {}
        return LLMResponse(text=text, model_version=str(data.get("modelVersion", model)),
                           prompt_tokens=usage.get("promptTokenCount"),
                           completion_tokens=(usage.get("candidatesTokenCount") or 0) + (usage.get("thoughtsTokenCount") or 0))

    def list_models(self) -> list[dict]:
        """Models this key can call with generateContent, so the config can be checked against reality."""
        out, token = [], ""
        while True:
            params = {"pageSize": 200, **({"pageToken": token} if token else {})}
            resp = requests.get(f"{self.base_url}/models", headers={"x-goog-api-key": self.api_key},
                                params=params, timeout=60)
            if resp.status_code != 200:
                raise LLMError(f"could not list models: HTTP {resp.status_code}: {resp.text[:300]}")
            data = resp.json()
            out += [m for m in data.get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
            token = data.get("nextPageToken", "")
            if not token:
                return out


class OpenAICompatibleProvider(_HTTPProvider):
    """Any endpoint that speaks /chat/completions (OpenRouter, Groq, Mistral, ...). Kept for adding a second family."""

    name = "openai_compatible"

    def __init__(self, api_key: str, *, base_url: str, extra_headers: Optional[dict] = None, **kw):
        super().__init__(api_key, **kw)
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.extra_headers = extra_headers or {}

    def _request(self, system: str, user: str, model: str):
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json", **self.extra_headers}
        body = {"model": model, "temperature": self.temperature, "max_tokens": self.max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        return self.url, headers, body

    def _parse(self, data: dict, model: str, role: str) -> LLMResponse:
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError(f"{role}/{model}: unexpected response shape: {str(data)[:300]}") from exc
        usage = data.get("usage") or {}
        return LLMResponse(text=text, model_version=str(data.get("model", model)),
                           prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"))


class Providers:
    """The providers named in config.yaml. Each rater and the consolidator says which one it uses."""

    def __init__(self, by_name: dict[str, Provider], default: str):
        self.by_name = by_name
        self.default = default

    def for_model(self, spec: dict) -> Provider:
        name = spec.get("provider", self.default)
        if name not in self.by_name:
            raise LLMError(f"model {spec.get('model')} names provider '{name}', which is not in config.yaml providers.")
        return self.by_name[name]

    def names_used(self, specs: list[dict]) -> list[str]:
        return sorted({s.get("provider", self.default) for s in specs})


def provider_key_status(cfg: dict) -> dict[str, bool]:
    """Which configured providers have a key available. Never returns the key."""
    return {name: bool(os.environ.get(p.get("api_key_env", ""), "")) for name, p in (cfg.get("providers") or {}).items()}


def build_providers(cfg: dict, *, mock: bool, only: Optional[list[str]] = None) -> Providers:
    default = cfg.get("provider", "gemini")
    if mock:
        return Providers({n: MockProvider() for n in (cfg.get("providers") or {default: {}})}, default)
    built: dict[str, Provider] = {}
    for name, p in (cfg.get("providers") or {}).items():
        if only is not None and name not in only:
            continue
        key_env = p.get("api_key_env", "")
        key = os.environ.get(key_env, "")
        if not key:
            raise LLMError(f"environment variable {key_env} is not set (provider '{name}'). "
                           "Put it in .env, or run with --mock.")
        common = dict(temperature=float(cfg.get("temperature", 0)), max_tokens=int(cfg.get("max_tokens", 32000)),
                      timeout_s=int(cfg.get("timeout_s", 600)), retries=int(cfg.get("retries", 4)))
        kind = p.get("type", name)
        if kind == "gemini":
            built[name] = GeminiProvider(key, **({"base_url": p["base_url"]} if p.get("base_url") else {}), **common)
        elif kind == "openai_compatible":
            built[name] = OpenAICompatibleProvider(key, base_url=p["base_url"], extra_headers=p.get("extra_headers"), **common)
        else:
            raise LLMError(f"provider '{name}' has unknown type '{kind}'. Use gemini or openai_compatible.")
    return Providers(built, default)


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of a reply, tolerating code fences and chatter."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in the reply")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("JSON object in the reply is not closed")


# --------------------------------------------------------------------------- offline mock
class MockProvider:
    """Deterministic stand-in so the whole pipeline can run with no API key.

    It reads the markers that prompts.py writes ('<<DIM id=...>>' and '<<RATER_RESULT ...>>'),
    so its output is plausible and its evidence quotes are real lines of the artifact.
    The scores mean nothing. A mock run is stamped as such in the report.
    """

    def complete(self, *, system: str, user: str, model: str, role: str) -> LLMResponse:
        if role.startswith("rater"):
            text = json.dumps(self._rate(user, model))
        else:
            text = json.dumps(self._consolidate(user))
        return LLMResponse(text=text, model_version=f"mock:{model}")

    @staticmethod
    def _seed(*parts: str) -> int:
        return int(hashlib.sha256("|".join(parts).encode()).hexdigest()[:8], 16)

    def _rate(self, user: str, model: str) -> dict:
        dim_ids = re.findall(r"<<DIM id=(\w+)>>", user)
        artifact = re.search(r"<<ARTIFACT_BEGIN>>(.*?)<<ARTIFACT_END>>", user, re.S)
        lines = [ln.strip() for ln in (artifact.group(1) if artifact else "").splitlines() if len(ln.strip()) > 40]
        dims = []
        for did in dim_ids:
            seed = self._seed(model, did)
            score = 2 + seed % 4  # 2 to 5
            quote = lines[seed % len(lines)][:70] if lines else ""
            finding_quote = lines[(seed // 7) % len(lines)][:70] if lines else ""
            findings = []
            if score <= 4:
                findings.append({
                    "severity": ["LOW", "MEDIUM", "HIGH"][seed % 3] if score <= 3 else "LOW",
                    "text": f"[mock] Example finding for {did}.",
                    "fix": "[mock] Example fix.",
                    "location": "mock location",
                    "quote": finding_quote,
                    "return_to": "Define D1",
                })
            dims.append({
                "dimension_id": did,
                "score": score,
                "not_measurable": False,
                "rationale": f"[mock] Score {score} for {did}.",
                "evidence": [{"location": "mock location", "quote": quote}],
                "findings": findings,
            })
        return {"dimensions": dims}

    def _consolidate(self, user: str) -> dict:
        blocks = re.findall(r"<<RATER_RESULT id=(\w+)>>(.*?)<<RATER_RESULT_END>>", user, re.S)
        per_dim: dict[str, list[int]] = {}
        findings, strengths = [], []
        for rid, raw in blocks:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            for d in data.get("dimensions", []):
                if d.get("score") is not None:
                    per_dim.setdefault(d["dimension_id"], []).append(int(d["score"]))
                for f in d.get("findings", []):
                    findings.append({**f, "dimension_id": d["dimension_id"], "raised_by": [rid]})
                if d.get("score") == 5 and d.get("evidence"):
                    strengths.append({"dimension_id": d["dimension_id"], "text": "[mock] Strong.",
                                      "location": d["evidence"][0].get("location", ""),
                                      "quote": d["evidence"][0].get("quote", "")})
        dims = []
        for did, scores in per_dim.items():
            spread = max(scores) - min(scores)
            score = sorted(scores)[len(scores) // 2] if spread <= 1 else min(scores)
            dims.append({
                "dimension_id": did,
                "score": score,
                "basis": "agreed" if spread <= 1 else "lower_stands",
                "rationale": f"[mock] Raters gave {sorted(scores)}.",
                "flagged_for_person": spread > 1,
            })
        return {"dimensions": dims, "findings": findings, "strengths": strengths}
