/**
 * Локальное расписание плановых запусков для Telegram-бота (без секретов).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const SCHEDULE_MIN_MS = 15 * 60 * 1000;
export const SCHEDULE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

export interface ChatScheduleRecord {
  enabled: boolean;
  intervalMs: number;
  /** Unix ms */
  nextRunAt: number;
  lastRunAt?: number;
  lastTaskText?: string;
  /**
   * true — каждый плановый запуск подставляет новое ТЗ из scripts/wp-wordstat-queue-next.mjs
   * (lastTaskText должен быть маркером WORDSTAT_QUEUE_SENTINEL в telegram-bot.ts).
   */
  wordstatQueue?: boolean;
  /**
   * Профиль очереди Wordstat для изоляции второго сайта (фиксируется при /schedule_queue_every;
   * для старых записей подставляется из карты чата).
   */
  wordstatSite?: string;
}

export type SchedulesFile = Record<string, ChatScheduleRecord>;

export function clampIntervalMs(ms: number): number {
  return Math.min(SCHEDULE_MAX_MS, Math.max(SCHEDULE_MIN_MS, ms));
}

export function readSchedulesFile(filePath: string): SchedulesFile {
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf-8");
    const j = JSON.parse(raw) as SchedulesFile;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

export function writeSchedulesFile(filePath: string, data: SchedulesFile): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

const UNIT_MS: Record<string, number> = {
  m: 60 * 1000,
  min: 60 * 1000,
  мин: 60 * 1000,
  h: 60 * 60 * 1000,
  час: 60 * 60 * 1000,
  ч: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  дн: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

/** Парсинг аргумента вида «3h», «30m», «1d», «90мин». */
export function parseScheduleEveryArg(arg: string): number | null {
  const s = arg.trim().replace(",", ".").replace(/\s+/g, "");
  const m = s.match(
    /^(\d+(?:\.\d+)?)\s*(m|min|мин|h|час|ч|d|дн|day)s?$/iu,
  );
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2]!.toLowerCase();
  let unit = u;
  if (u.startsWith("мин")) unit = "мин";
  if (u.startsWith("час") || u === "ч") unit = "час";
  if (u.startsWith("дн") || u === "day") unit = "дн";
  const mult = UNIT_MS[unit];
  if (!mult) return null;
  return Math.round(n * mult);
}

interface NaturalHit {
  intervalMs: number;
  /** Фрагмент исходного текста для удаления */
  matchedRaw: string;
}

function hit(ms: number, raw: string): NaturalHit {
  return { intervalMs: ms, matchedRaw: raw };
}

/**
 * Ищет в тексте русские формулировки расписания; возвращает интервал и строку для вырезания.
 */
export function matchNaturalSchedule(fullText: string): NaturalHit | null {
  const t = fullText.trim();
  if (!t) return null;

  const patterns: Array<{ re: RegExp; fn: (m: RegExpExecArray) => number }> = [
    {
      re: /\bраз\s+в\s+день\b|\bежедневно\b|\bраз\s+в\s+сутки\b/giu,
      fn: () => 24 * 60 * 60 * 1000,
    },
    {
      re: /\bраз\s+в\s+час\b|\bежечасно\b/giu,
      fn: () => 60 * 60 * 1000,
    },
    {
      re: /\bкаждые\s+полчаса\b|\bраз\s+в\s+полчаса\b/giu,
      fn: () => 30 * 60 * 1000,
    },
    {
      re: /\b(?:публикаци[яи]|запуск|стать[яи])\s+раз\s+в\s+(\d+)\s*(час|часа|часов|ч)\b/giu,
      fn: (m) => Number(m[1]) * 60 * 60 * 1000,
    },
    {
      re: /\bзапускай\s+каждые\s+(\d+)\s*(час|часа|часов|ч)\b/giu,
      fn: (m) => Number(m[1]) * 60 * 60 * 1000,
    },
    {
      re: /\bделай\s+статью\s+раз\s+в\s+(\d+)\s*(час|часа|часов|ч)\b/giu,
      fn: (m) => Number(m[1]) * 60 * 60 * 1000,
    },
    {
      re: /\bраз\s+в\s+(\d+)\s*(час|часа|часов|ч)\b/giu,
      fn: (m) => Number(m[1]) * 60 * 60 * 1000,
    },
    {
      re: /\bкаждые\s+(\d+)\s*(час|часа|часов|ч)\b/giu,
      fn: (m) => Number(m[1]) * 60 * 60 * 1000,
    },
    {
      re: /\bраз\s+в\s+(\d+)\s*(мин|минут|минуты)\b/giu,
      fn: (m) => Number(m[1]) * 60 * 1000,
    },
    {
      re: /\bкаждые\s+(\d+)\s*(мин|минут|минуты)\b/giu,
      fn: (m) => Number(m[1]) * 60 * 1000,
    },
    {
      re: /\bраз\s+в\s+(\d+)\s*(день|дня|дней|суток)\b/giu,
      fn: (m) => Number(m[1]) * 24 * 60 * 60 * 1000,
    },
  ];

  for (const { re, fn } of patterns) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m && m[0]) {
      let ms = fn(m);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      ms = clampIntervalMs(ms);
      return hit(ms, m[0]);
    }
  }
  return null;
}

export function stripMatchedSchedule(text: string, matchedRaw: string): string {
  return text.replace(matchedRaw, " ").replace(/\s+/g, " ").trim();
}

export function formatIntervalRu(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} мин`;
  const h = Math.round(ms / (3600000));
  if (h < 48) return `${h} ч`;
  const d = Math.round(ms / (86400000));
  return `${d} дн`;
}
