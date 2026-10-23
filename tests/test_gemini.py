import pytest

import ddd_evaluator.llm as llm
from ddd_evaluator.llm import GeminiProvider, LLMError, build_providers, provider_key_status


class FakeResp:
    def __init__(self, status=200, body=None, text="", headers=None):
        self.status_code, self._body, self.headers = status, body, headers or {}
        self.text = text or str(body)

    def json(self):
        return self._body


def ok_body(text='{"dimensions": []}', **extra):
    return {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20, "thoughtsTokenCount": 30},
            "modelVersion": "gemini-x-001", **extra}


@pytest.fixture
def sleeps(monkeypatch):
    waited = []
    monkeypatch.setattr(llm.time, "sleep", lambda s: waited.append(s))
    return waited


def provider(**kw):
    return GeminiProvider("KEY", temperature=0, max_tokens=1234, retries=3, **kw)


def test_request_shape_and_response_parsing(monkeypatch):
    seen = {}

    def post(url, headers, json, timeout):
        seen.update(url=url, headers=headers, body=json)
        return FakeResp(200, ok_body())

    monkeypatch.setattr(llm.requests, "post", post)
    r = provider().complete(system="SYS", user="USER", model="gemini-test", role="rater A")
    assert seen["url"].endswith("/models/gemini-test:generateContent")
    assert seen["headers"]["x-goog-api-key"] == "KEY"
    body = seen["body"]
    assert body["systemInstruction"]["parts"][0]["text"] == "SYS"
    assert body["contents"][0]["parts"][0]["text"] == "USER"
    assert body["generationConfig"] == {"temperature": 0, "maxOutputTokens": 1234, "responseMimeType": "application/json"}
    assert r.text == '{"dimensions": []}' and r.model_version == "gemini-x-001"
    assert (r.prompt_tokens, r.completion_tokens) == (100, 50)  # thinking tokens are counted


def test_thought_parts_are_not_part_of_the_answer(monkeypatch):
    body = {"candidates": [{"content": {"parts": [{"text": "private reasoning", "thought": True}, {"text": '{"a": 1}'}]},
                            "finishReason": "STOP"}]}
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: FakeResp(200, body))
    assert provider().complete(system="s", user="u", model="m", role="r").text == '{"a": 1}'


def test_truncated_reply_is_an_error(monkeypatch):
    body = {"candidates": [{"content": {"parts": [{"text": '{"a":'}]}, "finishReason": "MAX_TOKENS"}]}
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: FakeResp(200, body))
    with pytest.raises(LLMError, match="cut off"):
        provider().complete(system="s", user="u", model="m", role="r")


def test_blocked_prompt_is_an_error(monkeypatch):
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: FakeResp(200, {"promptFeedback": {"blockReason": "SAFETY"}}))
    with pytest.raises(LLMError, match="SAFETY"):
        provider().complete(system="s", user="u", model="m", role="r")


def test_per_minute_429_waits_as_long_as_google_asks_then_succeeds(monkeypatch, sleeps):
    replies = iter([FakeResp(429, text='{"error": {"details": [{"retryDelay": "7s"}]}, "message": "per minute"}'),
                    FakeResp(200, ok_body())])
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: next(replies))
    assert provider().complete(system="s", user="u", model="m", role="r").text
    assert sleeps == [8.0]


def test_daily_quota_stops_at_once(monkeypatch, sleeps):
    calls = []
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: calls.append(1) or FakeResp(429, text="Quota exceeded: GenerateRequestsPerDayPerProjectPerModel"))
    with pytest.raises(LLMError, match="daily free quota"):
        provider().complete(system="s", user="u", model="m", role="r")
    assert len(calls) == 1 and sleeps == []


def test_bad_key_or_unknown_model_is_not_retried(monkeypatch, sleeps):
    calls = []
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: calls.append(1) or FakeResp(404, text="model not found"))
    with pytest.raises(LLMError, match="404"):
        provider().complete(system="s", user="u", model="nope", role="r")
    assert len(calls) == 1


def test_gives_up_after_the_retries(monkeypatch, sleeps):
    calls = []
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: calls.append(1) or FakeResp(503, text="busy"))
    with pytest.raises(LLMError, match="gave up"):
        provider().complete(system="s", user="u", model="m", role="r")
    assert len(calls) == 4


def test_list_models_keeps_only_generate_content(monkeypatch):
    pages = iter([FakeResp(200, {"models": [{"name": "models/a", "supportedGenerationMethods": ["generateContent"]},
                                            {"name": "models/emb", "supportedGenerationMethods": ["embedContent"]}],
                                 "nextPageToken": "t"}),
                  FakeResp(200, {"models": [{"name": "models/b", "supportedGenerationMethods": ["generateContent"]}]})])
    monkeypatch.setattr(llm.requests, "get", lambda *a, **k: next(pages))
    assert [m["name"] for m in provider().list_models()] == ["models/a", "models/b"]


def test_missing_key_is_reported_by_name(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY_T", raising=False)
    cfg = {"provider": "gemini", "providers": {"gemini": {"type": "gemini", "api_key_env": "GEMINI_API_KEY_T"}}}
    assert provider_key_status(cfg) == {"gemini": False}
    with pytest.raises(LLMError, match="GEMINI_API_KEY_T"):
        build_providers(cfg, mock=False)
    monkeypatch.setenv("GEMINI_API_KEY_T", "abc")
    assert provider_key_status(cfg) == {"gemini": True}
    assert isinstance(build_providers(cfg, mock=False).for_model({"model": "m"}), GeminiProvider)
