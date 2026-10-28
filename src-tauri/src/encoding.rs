//! 编码探测与写回（PROMPT §5.2）。
//! 关键原则：用户没主动改，保存时编码 / BOM / 换行必须与读入时一致。

use std::borrow::Cow;
use std::fs;
use std::path::Path;

use encoding_rs::{Encoding, GB18030, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
const UTF16LE_BOM: [u8; 2] = [0xFF, 0xFE];
const UTF16BE_BOM: [u8; 2] = [0xFE, 0xFF];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDoc {
    pub content: String,
    pub encoding: String,
    pub has_bom: bool,
    pub line_ending: String,
    pub size_bytes: u64,
    pub truncated: bool,
}

struct Decoded {
    content: String,
    encoding: &'static Encoding,
    has_bom: bool,
}

pub fn read(path: &Path, max_bytes: Option<u64>) -> Result<FileDoc, String> {
    let meta = fs::metadata(path).map_err(|e| format!("无法读取文件信息：{e}"))?;
    let size = meta.len();
    let mut bytes = fs::read(path).map_err(|e| format!("无法读取文件：{e}"))?;

    let mut truncated = false;
    if let Some(limit) = max_bytes {
        if size > limit {
            bytes.truncate(limit as usize);
            trim_partial_utf8(&mut bytes);
            truncated = true;
        }
    }

    let decoded = decode(&bytes);
    let line_ending = detect_line_ending(&decoded.content);

    Ok(FileDoc {
        content: decoded.content,
        encoding: decoded.encoding.name().to_string(),
        has_bom: decoded.has_bom,
        line_ending,
        size_bytes: size,
        truncated,
    })
}

pub fn write(
    path: &Path,
    content: &str,
    encoding: &str,
    has_bom: bool,
    line_ending: &str,
) -> Result<(), String> {
    let bytes = encode(content, encoding, has_bom, line_ending);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建目录：{e}"))?;
    }
    fs::write(path, bytes).map_err(|e| format!("无法写入文件：{e}"))
}

pub fn encode(content: &str, encoding: &str, has_bom: bool, line_ending: &str) -> Vec<u8> {
    let normalized = content.replace("\r\n", "\n");
    let text = if line_ending.eq_ignore_ascii_case("CRLF") {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };

    let enc = Encoding::for_label(encoding.trim().as_bytes()).unwrap_or(UTF_8);
    let (body, _, _) = enc.encode(&text);
    let mut out = body.into_owned();

    if has_bom {
        if enc == UTF_8 {
            out.splice(0..0, UTF8_BOM);
        } else if enc == UTF_16LE {
            out.splice(0..0, UTF16LE_BOM);
        } else if enc == UTF_16BE {
            out.splice(0..0, UTF16BE_BOM);
        }
    }

    out
}

fn decode(bytes: &[u8]) -> Decoded {
    if bytes.starts_with(&UTF8_BOM) {
        return finish(&bytes[3..], UTF_8, true);
    }
    if bytes.starts_with(&UTF16LE_BOM) {
        return finish(&bytes[2..], UTF_16LE, true);
    }
    if bytes.starts_with(&UTF16BE_BOM) {
        return finish(&bytes[2..], UTF_16BE, true);
    }

    // 无 BOM：先让 chardetng 猜，猜出来的必须真的能解码才算数。
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let guessed = detector.guess(None, true);

    if let Some(content) = try_decode(bytes, guessed) {
        return Decoded {
            content,
            encoding: guessed,
            has_bom: false,
        };
    }

    // 回退顺序：GB18030 → UTF-8（GB18030 覆盖 GBK / GB2312）。
    for candidate in [GB18030, UTF_8] {
        if let Some(content) = try_decode(bytes, candidate) {
            return Decoded {
                content,
                encoding: candidate,
                has_bom: false,
            };
        }
    }

    // 仍然失败：宁可显示替换字符，也不让文件打不开。
    let (content, actual, _) = UTF_8.decode(bytes);
    Decoded {
        content: content.into_owned(),
        encoding: if actual == UTF_8 { UTF_8 } else { actual },
        has_bom: false,
    }
}

fn finish(bytes: &[u8], encoding: &'static Encoding, has_bom: bool) -> Decoded {
    let (content, _, _) = encoding.decode(bytes);
    Decoded {
        content: content.into_owned(),
        encoding,
        has_bom,
    }
}

fn try_decode(bytes: &[u8], encoding: &'static Encoding) -> Option<String> {
    let (text, _, had_errors): (Cow<'_, str>, &'static Encoding, bool) = encoding.decode(bytes);
    if had_errors {
        None
    } else {
        Some(text.into_owned())
    }
}

fn detect_line_ending(content: &str) -> String {
    let crlf = content.matches("\r\n").count();
    let lf_total = content.matches('\n').count();
    let lf_only = lf_total.saturating_sub(crlf);
    if crlf > 0 && crlf >= lf_only {
        "CRLF".to_string()
    } else {
        "LF".to_string()
    }
}

/// 截断大文件时别把多字节字符切成两半。
fn trim_partial_utf8(bytes: &mut Vec<u8>) {
    while let Some(last) = bytes.last() {
        if last & 0xC0 == 0x80 {
            bytes.pop();
        } else {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_utf8_bom_and_crlf() {
        let mut bytes = UTF8_BOM.to_vec();
        bytes.extend_from_slice("你好\r\n世界\r\n".as_bytes());
        let text = decode(&bytes);
        assert!(text.has_bom);
        assert_eq!(text.encoding.name(), "UTF-8");
        assert_eq!(detect_line_ending(&text.content), "CRLF");
    }

    #[test]
    fn detects_gbk_without_bom() {
        let (bytes, _, _) = GB18030.encode("中文编码测试");
        let text = decode(&bytes);
        assert_eq!(text.content, "中文编码测试");
        assert!(!text.has_bom);
    }

    #[test]
    fn write_roundtrip_keeps_encoding_and_line_ending() {
        let bytes = encode("第一行\r\n第二行", "UTF-8", true, "CRLF");
        assert_eq!(&bytes[..3], &UTF8_BOM);
        let text = decode(&bytes);
        assert_eq!(text.content, "第一行\r\n第二行");
        assert_eq!(detect_line_ending(&text.content), "CRLF");
    }

    #[test]
    fn mixed_newlines_pick_majority() {
        assert_eq!(detect_line_ending("a\r\nb\nc\r\n"), "CRLF");
        assert_eq!(detect_line_ending("a\nb\nc\r\n"), "LF");
    }
}
