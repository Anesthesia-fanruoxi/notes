import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

import { costOf, loadAiSettings, priceOf } from "../lib/ai";
import { ipc } from "../lib/ipc";
import type { AiUsagePage, AiUsagePoint, AiUsageRecord } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import styles from "../styles/app.module.css";

type Granularity = "day" | "week" | "month";

const GRANULARITY: { value: Granularity; label: string }[] = [
  { value: "day", label: "按日" },
  { value: "week", label: "按周" },
  { value: "month", label: "按月" },
];

const PAGE_SIZE = 50;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** 周从周一开始，key 用那一天的日期。 */
function weekKey(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return dayKey(monday);
}

interface Bucket {
  key: string;
  label: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cost: number;
  hasPrice: boolean;
}

function buildBuckets(granularity: Granularity, now: Date): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (granularity === "day") {
    for (let i = 29; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push({ key: dayKey(date), label: `${pad(date.getMonth() + 1)}-${pad(date.getDate())}` });
    }
    return out;
  }
  if (granularity === "week") {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(monday);
      date.setDate(date.getDate() - i * 7);
      out.push({ key: dayKey(date), label: `${pad(date.getMonth() + 1)}-${pad(date.getDate())}` });
    }
    return out;
  }
  for (let i = 11; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: monthKey(date), label: monthKey(date) });
  }
  return out;
}

function fmtTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

function fmtCost(value: number | null): string {
  if (value === null) return "—";
  if (value > 0 && value < 0.01) return `¥${value.toFixed(4)}`;
  return `¥${value.toFixed(2)}`;
}

function fmtTime(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Totals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cost: number;
  hasPrice: boolean;
}

function emptyTotals(): Totals {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheHitTokens: 0,
    cost: 0,
    hasPrice: false,
  };
}

export default function UsagePanel() {
  const version = useAppStore((state) => state.aiSettingsVersion);
  const settings = useMemo(() => loadAiSettings(), [version]);

  const [granularity, setGranularity] = useState<Granularity>("day");
  const [points, setPoints] = useState<AiUsagePoint[]>([]);
  const [page, setPage] = useState<AiUsagePage>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const now = new Date();
  const today = dayKey(now);
  const thisMonth = monthKey(now);

  useEffect(() => {
    let cancelled = false;
    const since = new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime();
    void (async () => {
      setLoading(true);
      try {
        const [scanned, first] = await Promise.all([
          ipc.aiUsageScan(since),
          ipc.aiUsageRecords(0, PAGE_SIZE),
        ]);
        if (cancelled) return;
        setPoints(scanned);
        setPage(first);
        setError("");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "读取用量失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buckets = useMemo(() => {
    const list = buildBuckets(granularity, now).map<Bucket>((item) => ({
      ...item,
      ...emptyTotals(),
    }));
    const index = new Map(list.map((bucket) => [bucket.key, bucket]));
    for (const point of points) {
      const date = new Date(point.ts);
      const key =
        granularity === "day" ? dayKey(date) : granularity === "week" ? weekKey(date) : monthKey(date);
      const bucket = index.get(key);
      if (!bucket) continue;
      bucket.requests += 1;
      bucket.promptTokens += point.promptTokens;
      bucket.completionTokens += point.completionTokens;
      bucket.cacheHitTokens += point.cacheHitTokens;
      const cost = costOf(point, priceOf(settings, point.provider));
      if (cost !== null) {
        bucket.cost += cost;
        bucket.hasPrice = true;
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, granularity, settings]);

  const totals = useMemo(() => {
    const result = emptyTotals();
    for (const point of points) {
      result.requests += 1;
      result.promptTokens += point.promptTokens;
      result.completionTokens += point.completionTokens;
      result.cacheHitTokens += point.cacheHitTokens;
      const cost = costOf(point, priceOf(settings, point.provider));
      if (cost !== null) {
        result.cost += cost;
        result.hasPrice = true;
      }
    }
    return result;
  }, [points, settings]);

  const todayTotals = useMemo(() => {
    const result = emptyTotals();
    for (const point of points) {
      const date = new Date(point.ts);
      if (dayKey(date) !== today) continue;
      result.requests += 1;
      result.promptTokens += point.promptTokens;
      result.completionTokens += point.completionTokens;
      result.cacheHitTokens += point.cacheHitTokens;
      const cost = costOf(point, priceOf(settings, point.provider));
      if (cost !== null) {
        result.cost += cost;
        result.hasPrice = true;
      }
    }
    return result;
  }, [points, settings, today]);

  const monthTotals = useMemo(() => {
    const result = emptyTotals();
    for (const point of points) {
      if (monthKey(new Date(point.ts)) !== thisMonth) continue;
      result.requests += 1;
      result.promptTokens += point.promptTokens;
      result.completionTokens += point.completionTokens;
      result.cacheHitTokens += point.cacheHitTokens;
      const cost = costOf(point, priceOf(settings, point.provider));
      if (cost !== null) {
        result.cost += cost;
        result.hasPrice = true;
      }
    }
    return result;
  }, [points, settings, thisMonth]);

  const peak = Math.max(1, ...buckets.map((bucket) => bucket.promptTokens + bucket.completionTokens));

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await ipc.aiUsageRecords(page.items.length, PAGE_SIZE);
      setPage(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取更多记录失败");
    } finally {
      setLoadingMore(false);
    }
  };

  const cacheRate = (value: Totals) =>
    value.promptTokens > 0 ? `${((value.cacheHitTokens / value.promptTokens) * 100).toFixed(1)}%` : "—";

  const cards = [
    { title: "今日", data: todayTotals },
    { title: "本月", data: monthTotals },
    { title: "最近 12 个月", data: totals },
  ];

  return (
    <div className={styles.usagePanel}>
      <div className={styles.usageCards}>
        {cards.map((card) => (
          <div key={card.title} className={styles.usageCard}>
            <span className={styles.usageCardTitle}>{card.title}</span>
            <b>{fmtTokens(card.data.promptTokens + card.data.completionTokens)} tokens</b>
            <span className={styles.usageCardSub}>
              {card.data.requests} 次 · 输入 {fmtTokens(card.data.promptTokens)} / 输出{" "}
              {fmtTokens(card.data.completionTokens)} · 缓存命中 {cacheRate(card.data)}
              {card.data.hasPrice ? ` · ${fmtCost(card.data.cost)}` : ""}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.usageHead}>
        <div className={styles.seg}>
          {GRANULARITY.map((item) => (
            <button
              key={item.value}
              type="button"
              className={clsx(styles.segBtn, granularity === item.value && styles.segActive)}
              onClick={() => setGranularity(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className={styles.usageLegend}>
          <i className={clsx(styles.legendDot, styles.legendPrompt)} /> 输入
          <i className={clsx(styles.legendDot, styles.legendCompletion)} /> 输出
        </span>
      </div>

      {loading ? (
        <div className={styles.desc}>正在读取用量…</div>
      ) : (
        <>
          <div className={styles.usageChart}>
            {buckets.map((bucket, index) => {
              const total = bucket.promptTokens + bucket.completionTokens;
              const height = total > 0 ? Math.max(3, (total / peak) * 100) : 0;
              const promptShare = total > 0 ? (bucket.promptTokens / total) * 100 : 0;
              const showLabel =
                granularity !== "day" || index % 5 === 0 || index === buckets.length - 1;
              const isLast = index === buckets.length - 1;
              return (
                <div key={bucket.key} className={styles.usageBarCol}>
                  <div
                    className={styles.usageBarTrack}
                    title={`${bucket.key}\n${bucket.requests} 次 · 输入 ${fmtTokens(
                      bucket.promptTokens,
                    )} · 输出 ${fmtTokens(bucket.completionTokens)} · 缓存命中 ${cacheRate(bucket)}${
                      bucket.hasPrice ? `\n${fmtCost(bucket.cost)}` : ""
                    }`}
                  >
                    <div className={styles.usageBar} style={{ height: `${height}%` }}>
                      <div className={styles.usageBarPrompt} style={{ flexGrow: promptShare }} />
                      <div
                        className={styles.usageBarCompletion}
                        style={{ flexGrow: 100 - promptShare }}
                      />
                    </div>
                  </div>
                  <span
                    className={clsx(styles.usageBarLabel, isLast && styles.usageBarLabelEnd)}
                  >
                    {showLabel ? bucket.label : ""}
                  </span>
                </div>
              );
            })}
          </div>

          {totals.hasPrice ? null : (
            <div className={styles.desc}>
              没配单价时只统计 tokens；在 AI 页填「计费」后这里会显示费用。
            </div>
          )}

          <div className={styles.usageTable}>
            <div className={clsx(styles.usageRow, styles.usageRowHead)}>
              <span>时间</span>
              <span>模型</span>
              <span>输入</span>
              <span>输出</span>
              <span>缓存命中</span>
              <span>耗时</span>
              <span>费用</span>
            </div>
            {page.items.length === 0 && <div className={styles.desc}>还没有 AI 调用记录。</div>}
            {page.items.map((record) => (
              <UsageRow
                key={`${record.ts}-${record.model}`}
                record={record}
                price={priceOf(settings, record.provider)}
                expanded={expanded === `${record.ts}-${record.model}`}
                onToggle={() =>
                  setExpanded((current) =>
                    current === `${record.ts}-${record.model}` ? null : `${record.ts}-${record.model}`,
                  )
                }
              />
            ))}
          </div>
          {page.items.length < page.total && (
            <button type="button" className={styles.btn} disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "加载中…" : `加载更多（已 ${page.items.length}/${page.total}）`}
            </button>
          )}
        </>
      )}

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

function UsageRow({
  record,
  price,
  expanded,
  onToggle,
}: {
  record: AiUsageRecord;
  price: ReturnType<typeof priceOf>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cost = costOf(record, price);
  return (
    <>
      <button type="button" className={styles.usageRow} onClick={onToggle}>
        <span>{fmtTime(record.ts)}</span>
        <span className={styles.usageModel} title={record.provider}>
          {record.model || "—"}
        </span>
        <span>{fmtTokens(record.promptTokens)}</span>
        <span>{fmtTokens(record.completionTokens)}</span>
        <span>{fmtTokens(record.cacheHitTokens)}</span>
        <span>{(record.durationMs / 1000).toFixed(1)}s</span>
        <span>{fmtCost(cost)}</span>
      </button>
      {expanded && (
        <div className={styles.usageDetail}>
          <div className={styles.usageDetailMeta}>
            {record.docTitle || "临时文档"} · {record.provider}
            {record.cacheMissTokens ? ` · 缓存未命中 ${fmtTokens(record.cacheMissTokens)}` : ""}
          </div>
          <pre className={styles.usagePrompt}>{record.promptPreview || "（没有记录提示词）"}</pre>
        </div>
      )}
    </>
  );
}
