import { pickAndOpenFiles } from "../lib/documents";
import { addTempTab } from "../lib/scratch";
import styles from "../styles/app.module.css";

export default function WelcomePane() {
  return (
    <section className={styles.welcome}>
      <div className={styles.welcomeBrand}>
        <div className={styles.welcomeLogo} aria-hidden="true">
          N
        </div>
        <h1 className={styles.welcomeTitle}>Note</h1>
        <p className={styles.welcomeSub}>打开已有文件，或从一张空白页开始。</p>
      </div>

      <div className={styles.welcomeActions}>
        <button
          type="button"
          className={styles.welcomeCard}
          onClick={() => void pickAndOpenFiles()}
        >
          <span className={styles.welcomeIcon} aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z" />
            </svg>
          </span>
          <span className={styles.welcomeCardTitle}>打开文件</span>
          <span className={styles.welcomeShortcut}>Ctrl+O</span>
        </button>

        <button
          type="button"
          className={styles.welcomeCard}
          onClick={() => addTempTab()}
        >
          <span className={styles.welcomeIcon} aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5Z" />
              <path d="M14 3.5V8.5H19" />
              <path d="M12 11v6M9 14h6" />
            </svg>
          </span>
          <span className={styles.welcomeCardTitle}>新建空白文档</span>
          <span className={styles.welcomeShortcut}>.txt</span>
        </button>
      </div>
    </section>
  );
}
