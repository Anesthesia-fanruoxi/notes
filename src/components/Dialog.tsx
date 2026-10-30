import { useEffect, useRef, useState } from "react";

import styles from "../styles/app.module.css";

interface InputDialogProps {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  onConfirm: (value: string) => Promise<void> | void;
  onClose: () => void;
}

export function InputDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  confirmText = "确定",
  onConfirm,
  onClose,
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    if (!value.trim()) {
      setError("名称不能为空");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      setBusy(false);
    }
  };

  return (
    <div className={styles.scrim} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`${styles.modal} ${styles.modalSmall}`}>
        <div className={styles.mHd}>
          <b>{title}</b>
          <span className={styles.mHdSpacer} />
          <button type="button" className={styles.mClose} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.mBd}>
          <div className={styles.field}>
            {label && <label className={styles.fieldLabel}>{label}</label>}
            <input
              ref={inputRef}
              className={styles.input}
              value={value}
              placeholder={placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
                if (event.key === "Escape") onClose();
              }}
            />
          </div>
          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.mFt}>
          <span className={styles.mFtSpacer} />
          <button type="button" className={styles.btn} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmText = "确定",
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      setBusy(false);
    }
  };

  return (
    <div className={styles.scrim} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`${styles.modal} ${styles.modalSmall}`}>
        <div className={styles.mHd}>
          <b>{title}</b>
          <span className={styles.mHdSpacer} />
          <button type="button" className={styles.mClose} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles.mBd}>
          <div className={styles.dialogText}>{message}</div>
          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.mFt}>
          <span className={styles.mFtSpacer} />
          <button type="button" className={styles.btn} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.btn} ${danger ? styles.btnDanger : styles.btnPrimary}`}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
