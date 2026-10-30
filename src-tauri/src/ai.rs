//! AI 请求：密钥、连通性测试、流式转发。
//!
//! Key 只留在 Rust（Windows 凭据管理器），前端拿不到明文；
//! 流式 chunk 通过 `ai://delta` 事件推给前端，避免把 Key 交给 WebView。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::library;
use crate::usage;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    /// 模板标识，也用作 keyring 的账号后缀。
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

/// 一次调用里从响应拿到的用量，供应商没给就是 None。
#[derive(Debug, Clone, Copy, Default)]
pub struct ChatUsage {
    pub prompt: u64,
    pub completion: u64,
    pub total: u64,
    pub cache_hit: u64,
    pub cache_miss: u64,
    pub cached: u64,
}

fn parse_usage(value: &Value) -> Option<ChatUsage> {
    let usage = value.get("usage")?.as_object()?;
    let number = |key: &str| usage.get(key).and_then(Value::as_u64);
    let prompt = number("prompt_tokens")?;
    let completion = number("completion_tokens").unwrap_or(0);
    let total = number("total_tokens").unwrap_or(prompt + completion);
    let cached = usage
        .get("prompt_tokens_details")
        .and_then(|detail| detail.get("cached_tokens"))
        .and_then(Value::as_u64);
    let cache_hit = number("prompt_cache_hit_tokens").or(cached).unwrap_or(0);
    let cache_miss = number("prompt_cache_miss_tokens").unwrap_or(prompt.saturating_sub(cache_hit));
    Some(ChatUsage {
        prompt,
        completion,
        total,
        cache_hit,
        cache_miss,
        cached: cached.unwrap_or(cache_hit),
    })
}

/// 正在运行或已取消的请求。abort 只置位，读循环看到后自行收尾。
static AI_RUNNING: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn keyring_entry(app: &AppHandle, provider: &str) -> Result<keyring::Entry, String> {
    let provider = provider.trim();
    if provider.is_empty()
        || provider.len() > 40
        || !provider
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("AI 服务标识不合法".into());
    }
    let service = app.config().identifier.clone();
    keyring::Entry::new(&service, &format!("ai-key-{provider}"))
        .map_err(|e| format!("无法访问凭据管理器：{e}"))
}

fn read_secret(app: &AppHandle, provider: &str) -> Result<Option<String>, String> {
    let entry = keyring_entry(app, provider)?;
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取密钥失败：{err}")),
    }
}

fn needs_key(provider: &str) -> bool {
    !provider.eq_ignore_ascii_case("ollama")
}

#[tauri::command]
pub fn set_secret(app: AppHandle, provider: String, value: String) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("密钥不能为空".into());
    }
    let entry = keyring_entry(&app, &provider)?;
    entry
        .set_password(value.trim())
        .map_err(|e| format!("保存密钥失败：{e}"))
}

#[tauri::command]
pub fn get_secret_status(app: AppHandle, provider: String) -> Result<bool, String> {
    Ok(read_secret(&app, &provider)?.is_some())
}

#[tauri::command]
pub fn clear_secret(app: AppHandle, provider: String) -> Result<(), String> {
    let entry = keyring_entry(&app, &provider)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("删除密钥失败：{err}")),
    }
}

fn chat_endpoint(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

fn build_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))
}

fn map_reqwest(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "网络超时，请检查网络或 Base URL".to_string()
    } else if err.is_connect() {
        "无法连接 AI 服务，请检查网络或 Base URL".to_string()
    } else {
        format!("网络请求失败：{err}")
    }
}

fn extract_error(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(message) = value["error"]["message"]
            .as_str()
            .or_else(|| value["message"].as_str())
            .or_else(|| value["error"].as_str())
        {
            return message.chars().take(300).collect();
        }
    }
    body.chars().take(300).collect()
}

fn map_status(status: reqwest::StatusCode, body: &str) -> String {
    let detail = extract_error(body);
    match status.as_u16() {
        401 | 403 => {
            if detail.is_empty() {
                "密钥无效或无权限（401/403）".to_string()
            } else {
                format!("密钥无效或无权限（401/403）：{detail}")
            }
        }
        429 => "请求过于频繁（429），请稍后再试".to_string(),
        404 => "接口或模型不存在（404）".to_string(),
        code => {
            if detail.is_empty() {
                format!("请求失败（{code}）")
            } else {
                format!("请求失败（{code}）：{detail}")
            }
        }
    }
}

fn emit_delta(app: &AppHandle, request_id: &str, text: &str) {
    let _ = app.emit(
        "ai://delta",
        json!({ "requestId": request_id, "text": text }),
    );
}

/// 发送一轮对话。成功时通过 `ai://delta` 推送增量文本，返回 Ok(()) 表示流结束。
#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    request_id: String,
    doc_id: Option<String>,
    doc_title: Option<String>,
    config: AiConfig,
    messages: Vec<AiMessage>,
) -> Result<(), String> {
    // Rust 侧二次校验：禁止读取的文档即使前端绕过也发不出去。
    let mut title = doc_title.unwrap_or_else(|| "临时文档".to_string());
    if let Some(id) = doc_id.as_deref() {
        let (_, index) = library::load_index(&app)?;
        let doc = index
            .docs
            .iter()
            .find(|item| item.id == id)
            .ok_or("文档不存在")?;
        if !doc.ai_readable {
            return Err("该文档已禁止 AI 读取，请求已取消".into());
        }
        title = doc.title.clone();
    }

    if config.base_url.trim().is_empty() {
        return Err("Base URL 为空，请先在设置中填写".into());
    }
    if config.model.trim().is_empty() {
        return Err("模型为空，请先在设置中填写".into());
    }
    if messages.is_empty() {
        return Err("没有可发送的内容".into());
    }

    let secret = read_secret(&app, &config.provider)?;
    if secret.is_none() && needs_key(&config.provider) {
        return Err("未配置 API Key，请先在设置中填写".into());
    }

    let cancel = Arc::new(AtomicBool::new(false));
    AI_RUNNING
        .lock()
        .map_err(|_| "内部状态异常".to_string())?
        .insert(request_id.clone(), cancel.clone());

    let started = Instant::now();
    let result = stream_chat(&app, &request_id, &config, secret, &messages, &cancel).await;
    let duration_ms = started.elapsed().as_millis() as u64;

    if let Ok(mut running) = AI_RUNNING.lock() {
        running.remove(&request_id);
    }

    // 调用记录：拿不到用量也记一行，方便回看提示词。
    if let Ok(usage) = &result {
        let usage = usage.unwrap_or_default();
        let prompt_preview: String = messages
            .iter()
            .rev()
            .find(|message| message.role == "user")
            .map(|message| message.content.chars().take(500).collect())
            .unwrap_or_default();
        usage::append(
            &app,
            &usage::UsageRecord {
                ts: usage::now_ms(),
                provider: config.provider.clone(),
                model: config.model.clone(),
                doc_id: doc_id.clone(),
                doc_title: title,
                prompt_tokens: usage.prompt,
                completion_tokens: usage.completion,
                total_tokens: usage.total,
                cache_hit_tokens: usage.cache_hit,
                cache_miss_tokens: usage.cache_miss,
                cached_tokens: usage.cached,
                duration_ms,
                prompt_preview,
            },
        );
    }

    result.map(|_| ())
}

async fn stream_chat(
    app: &AppHandle,
    request_id: &str,
    config: &AiConfig,
    secret: Option<String>,
    messages: &[AiMessage],
    cancel: &Arc<AtomicBool>,
) -> Result<Option<ChatUsage>, String> {
    stream_chat_with(config, secret, messages, cancel, |text| {
        emit_delta(app, request_id, text);
    })
    .await
}

async fn stream_chat_with<F>(
    config: &AiConfig,
    secret: Option<String>,
    messages: &[AiMessage],
    cancel: &Arc<AtomicBool>,
    emit: F,
) -> Result<Option<ChatUsage>, String>
where
    F: Fn(&str) + Send + Sync,
{
    if cancel.load(Ordering::Relaxed) {
        return Ok(None);
    }

    let client = build_client(180)?;
    let url = chat_endpoint(&config.base_url);
    let send = |include_usage: bool| {
        let client = client.clone();
        let url = url.clone();
        let secret = secret.clone();
        let mut payload = json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "stream": true,
        });
        if include_usage {
            payload["stream_options"] = json!({ "include_usage": true });
        }
        async move {
            let mut request = client
                .post(&url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .json(&payload);
            if let Some(key) = secret {
                request = request.bearer_auth(key);
            }
            request.send().await.map_err(map_reqwest)
        }
    };

    // 先按 OpenAI 规范要 usage；个别网关不认 stream_options，400 时去掉重试一次。
    let mut response = send(true).await?;
    if response.status().as_u16() == 400 {
        let body = response.text().await.unwrap_or_default();
        if body.contains("stream_options") || body.contains("include_usage") {
            response = send(false).await?;
        } else {
            return Err(map_status(
                reqwest::StatusCode::BAD_REQUEST,
                &body,
            ));
        }
    }

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(map_status(status, &body));
    }

    let is_sse = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.contains("text/event-stream"))
        .unwrap_or(false);

    let mut response = response;

    if !is_sse {
        let text = response.text().await.map_err(map_reqwest)?;
        let value: Value =
            serde_json::from_str(&text).map_err(|e| format!("响应解析失败：{e}"))?;
        if let Some(content) = value["choices"][0]["message"]["content"].as_str() {
            if !content.is_empty() {
                emit(content);
                return Ok(parse_usage(&value));
            }
        }
        return Err(extract_error(&text));
    }

    let mut usage: Option<ChatUsage> = None;
    let mut buffer: Vec<u8> = Vec::new();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(usage);
        }
        let chunk = response.chunk().await.map_err(map_reqwest)?;
        let Some(chunk) = chunk else {
            break;
        };
        buffer.extend_from_slice(&chunk);

        while let Some(position) = buffer.iter().position(|byte| *byte == b'\n') {
            if cancel.load(Ordering::Relaxed) {
                return Ok(usage);
            }
            let line: Vec<u8> = buffer.drain(..=position).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim_end_matches(['\r', '\n']);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                return Ok(usage);
            }
            if let Ok(value) = serde_json::from_str::<Value>(data) {
                if let Some(message) = value["error"]["message"].as_str() {
                    return Err(message.to_string());
                }
                if let Some(parsed) = parse_usage(&value) {
                    usage = Some(parsed);
                }
                if let Some(text) = value["choices"][0]["delta"]["content"].as_str() {
                    if !text.is_empty() {
                        emit(text);
                    }
                }
            }
        }
    }

    Ok(usage)
}

#[tauri::command]
pub fn ai_abort(request_id: String) -> Result<(), String> {
    if let Ok(running) = AI_RUNNING.lock() {
        if let Some(flag) = running.get(&request_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

/// 发一条最小请求测连通性，返回往返延迟（毫秒）。
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_endpoint_appends_only_once() {
        assert_eq!(
            chat_endpoint("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("https://x.test/v1/chat/completions"),
            "https://x.test/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("http://localhost:11434/v1/"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn openai_error_message_is_extracted() {
        let body = r#"{"error":{"message":"Incorrect API key provided"}}"#;
        assert_eq!(extract_error(body), "Incorrect API key provided");
        assert_eq!(extract_error("plain failure"), "plain failure");
    }

    #[test]
    fn status_maps_to_readable_text() {
        let body = r#"{"error":{"message":"bad key"}}"#;
        assert!(map_status(reqwest::StatusCode::UNAUTHORIZED, body).contains("密钥无效"));
        assert!(map_status(reqwest::StatusCode::TOO_MANY_REQUESTS, "").contains("请求过于频繁"));
    }

    #[test]
    fn streams_sse_deltas_from_local_server() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::Mutex as StdMutex;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0u8; 8192];
            let _ = socket.read(&mut request);
            let body = concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n",
                "data: [DONE]\n\n"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).unwrap();
            socket.flush().unwrap();
        });

        let config = AiConfig {
            provider: "ollama".into(),
            base_url: format!("http://127.0.0.1:{port}/v1"),
            model: "test".into(),
            temperature: 0.0,
        };
        let messages = vec![AiMessage {
            role: "user".into(),
            content: "hi".into(),
        }];
        let cancel = Arc::new(AtomicBool::new(false));
        let collected: StdMutex<Vec<String>> = StdMutex::new(Vec::new());

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            stream_chat_with(&config, None, &messages, &cancel, |text| {
                collected.lock().unwrap().push(text.to_string());
            })
            .await
            .unwrap();
        });

        server.join().unwrap();
        assert_eq!(
            collected.into_inner().unwrap(),
            vec!["你".to_string(), "好".to_string()]
        );
    }
}

#[tauri::command]
pub async fn ai_test_connection(app: AppHandle, config: AiConfig) -> Result<u64, String> {
    if config.base_url.trim().is_empty() {
        return Err("Base URL 为空".into());
    }
    if config.model.trim().is_empty() {
        return Err("模型为空".into());
    }

    let secret = read_secret(&app, &config.provider)?;
    if secret.is_none() && needs_key(&config.provider) {
        return Err("未配置 API Key".into());
    }

    let started = Instant::now();
    let client = build_client(30)?;
    let mut request = client
        .post(chat_endpoint(&config.base_url))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": config.model,
            "messages": [{ "role": "user", "content": "ping" }],
            "temperature": config.temperature,
            "max_tokens": 1,
            "stream": false,
        }));
    if let Some(key) = secret {
        request = request.bearer_auth(key);
    }

    let response = request.send().await.map_err(map_reqwest)?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_status(status, &body));
    }

    Ok(started.elapsed().as_millis() as u64)
}

fn models_endpoint(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let base = base.trim_end_matches("/chat/completions").trim_end_matches('/');
    format!("{base}/models")
}

/// 拉取 OpenAI 兼容的模型列表：GET {base}/models，Key 仍然只在 Rust 里。
/// `api_key` 只在设置页还没保存 Key 时临时传进来，不落库。
#[tauri::command]
pub async fn ai_list_models(
    app: AppHandle,
    provider: String,
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() {
        return Err("Base URL 为空".into());
    }

    let secret = match api_key.map(|key| key.trim().to_string()) {
        Some(key) if !key.is_empty() => Some(key),
        _ => read_secret(&app, &provider)?,
    };
    if secret.is_none() && needs_key(&provider) {
        return Err("未配置 API Key".into());
    }

    let client = build_client(20)?;
    let mut request = client
        .get(models_endpoint(&base_url))
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(key) = secret {
        request = request.bearer_auth(key);
    }

    let response = request.send().await.map_err(map_reqwest)?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(map_status(status, &body));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|_| "模型列表解析失败，接口可能不是 OpenAI 兼容格式".to_string())?;
    let mut ids: Vec<String> = value["data"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row["id"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Err("接口没有返回可用模型".into());
    }
    Ok(ids)
}
