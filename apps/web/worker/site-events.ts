// eslint-disable-next-line import/no-unresolved
import { DurableObject } from "cloudflare:workers";
import type { DurableEvent } from "./analytics/collect";

const SHIP_DELAY_MS = 5_000;
const SHIP_BATCH_SIZE = 500;
const SHIP_MAX_BATCHES_PER_ALARM = 10;
const RETENTION_MS = 60 * 60 * 1000; // keep shipped rows for 60 min
const IDLE_REARM_MS = 15 * 60 * 1000;
const WS_TICK_MS = 30_000;
const WS_BROADCAST_MIN_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export interface RealtimeStats {
  debugUnshipped?: number;
  debugSendFailures?: number;
  currentVisitors: number;
  visitors30m: number;
  pageviews30m: number;
  pageviewsPerMinute: number[];
  topPages: { pathname: string; views: number }[];
  topReferrers: { referrer: string; views: number }[];
  topCountries: { country: string; views: number }[];
}

interface EventRow {
  seq: number;
  received_ms: number;
  visitor_id: string;
  event_type: string;
  pathname: string;
  referrer: string;
  country: string;
  payload: string;
}

export class SiteEvents extends DurableObject<Env> {
  private alarmPending = false;
  private lastBroadcast = 0;
  private missingStreamLogged = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                received_ms INTEGER NOT NULL,
                visitor_id TEXT,
                event_type TEXT,
                pathname TEXT,
                referrer TEXT,
                country TEXT,
                payload TEXT NOT NULL
            )
        `);
    this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value
            )
        `);
  }

  private metaGet(key: string): string | undefined {
    const row = this.ctx.storage.sql
      .exec("SELECT value FROM meta WHERE key = ?", key)
      .toArray()[0] as unknown as { value: string | number } | undefined;
    return row ? String(row.value) : undefined;
  }

  private metaSet(key: string, value: string | number): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
      key,
      String(value),
    );
  }

  async record(event: DurableEvent): Promise<void> {
    const receivedMs = Date.parse(event.received_at);
    this.ctx.storage.sql.exec(
      `INSERT INTO events
             (received_ms, visitor_id, event_type, pathname, referrer, country, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
      Number.isFinite(receivedMs) ? receivedMs : Date.now(),
      event.visitor_id,
      event.event_type,
      event.pathname,
      event.referrer,
      event.country,
      JSON.stringify(event),
    );
    await this.ensureAlarm();
    this.broadcastSoon();
  }

  private async ensureAlarm(): Promise<void> {
    if (this.alarmPending) return;
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null) {
      this.alarmPending = true;
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + SHIP_DELAY_MS);
    this.alarmPending = true;
  }

  async alarm(): Promise<void> {
    this.alarmPending = false;
    const now = Date.now();

    if (this.env.EVENT_STREAM) {
      for (let batch = 0; batch < SHIP_MAX_BATCHES_PER_ALARM; batch++) {
        const current = Number(this.metaGet("shipped_seq") ?? 0);
        const rows = this.ctx.storage.sql
          .exec(
            `SELECT seq, payload FROM events
                         WHERE seq > ? ORDER BY seq LIMIT ?`,
            current,
            SHIP_BATCH_SIZE,
          )
          .toArray() as unknown as Pick<EventRow, "seq" | "payload">[];
        if (rows.length === 0) break;
        try {
          await this.env.EVENT_STREAM.send(
            rows.map(
              (r) => JSON.parse(r.payload) as DurableEvent,
            ) as unknown as import("cloudflare:pipelines").PipelineRecord[],
          );
          this.metaSet("shipped_seq", rows[rows.length - 1].seq);
          this.metaSet("send_failures", 0);
          this.metaSet("last_shipped_at", Date.now());
        } catch (error) {
          const attempts = Number(this.metaGet("send_failures") ?? 0);
          this.metaSet("send_failures", attempts + 1);
          const backoff = Math.min(SHIP_DELAY_MS * 2 ** attempts, MAX_BACKOFF_MS);
          console.error(
            JSON.stringify({
              message: "event stream send failed",
              attempt: attempts + 1,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          await this.ctx.storage.setAlarm(now + backoff);
          this.alarmPending = true;
          return;
        }
      }
    } else if (!this.missingStreamLogged) {
      this.missingStreamLogged = true;
      console.warn(
        JSON.stringify({
          message: "EVENT_STREAM binding missing; events remain unshipped",
        }),
      );
    }

    // Re-read shipped_seq — the ship loop above may have advanced it.
    const shippedSeq = Number(this.metaGet("shipped_seq") ?? 0);

    // Prune shipped rows past the realtime window. seq order equals time
    // order; AUTOINCREMENT keeps seq monotonic across full prunes.
    this.ctx.storage.sql.exec(
      `DELETE FROM events
             WHERE seq <= ? AND received_ms < ?`,
      shippedSeq,
      now - RETENTION_MS,
    );

    const unshipped = this.ctx.storage.sql
      .exec("SELECT seq FROM events WHERE seq > ? LIMIT 1", shippedSeq)
      .toArray().length;
    const hasRows =
      unshipped > 0 ||
      this.ctx.storage.sql.exec("SELECT seq FROM events LIMIT 1").toArray().length > 0;

    if (!hasRows && this.ctx.getWebSockets().length === 0) return;
    const delay =
      unshipped > 0
        ? SHIP_DELAY_MS
        : this.ctx.getWebSockets().length > 0
          ? WS_TICK_MS
          : IDLE_REARM_MS;
    await this.ctx.storage.setAlarm(now + delay);
    this.alarmPending = true;
  }

  realtime(): RealtimeStats {
    const now = Date.now();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT received_ms, visitor_id, event_type, pathname, referrer, country
                 FROM events WHERE received_ms >= ? ORDER BY seq`,
        now - 30 * 60_000,
      )
      .toArray() as unknown as Omit<EventRow, "seq" | "payload">[];

    const currentVisitors = new Set<string>();
    const visitors30m = new Set<string>();
    const perMinute = new Array<number>(30).fill(0);
    const pages = new Map<string, number>();
    const referrers = new Map<string, number>();
    const countries = new Map<string, number>();
    let pageviews30m = 0;

    for (const row of rows) {
      const isPageview = row.event_type === "pageview";
      if (row.visitor_id && row.event_type !== "engagement") {
        visitors30m.add(row.visitor_id);
        if (row.received_ms >= now - 5 * 60_000) {
          currentVisitors.add(row.visitor_id);
        }
      }
      if (!isPageview) continue;
      pageviews30m++;
      const bucket = Math.floor((now - row.received_ms) / 60_000);
      if (bucket >= 0 && bucket < 30) perMinute[29 - bucket]++;
      pages.set(row.pathname, (pages.get(row.pathname) ?? 0) + 1);
      let ref = "Direct";
      if (row.referrer) {
        try {
          ref = new URL(row.referrer).hostname || "Direct";
        } catch {
          ref = "Direct";
        }
      }
      referrers.set(ref, (referrers.get(ref) ?? 0) + 1);
      if (row.country) {
        countries.set(row.country, (countries.get(row.country) ?? 0) + 1);
      }
    }

    const top = (m: Map<string, number>, key: string) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, views]) => ({ [key]: k, views }));

    const shippedSeq = Number(this.metaGet("shipped_seq") ?? 0);
    const lastSeq =
      (
        this.ctx.storage.sql.exec("SELECT MAX(seq) AS m FROM events").toArray()[0] as
          | { m: number }
          | undefined
      )?.m ?? 0;
    return {
      debugUnshipped: Math.max(0, lastSeq - shippedSeq),
      debugSendFailures: Number(this.metaGet("send_failures") ?? 0),
      currentVisitors: currentVisitors.size,
      visitors30m: visitors30m.size,
      pageviews30m,
      pageviewsPerMinute: perMinute,
      topPages: top(pages, "pathname") as RealtimeStats["topPages"],
      topReferrers: top(referrers, "referrer") as RealtimeStats["topReferrers"],
      topCountries: top(countries, "country") as RealtimeStats["topCountries"],
    };
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify(this.realtime()));
    this.broadcastSoon();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(): void {
    // Push-only channel; inbound messages are ignored.
  }

  webSocketClose(): void {
    this.scheduleNextAlarmIfIdle().catch(() => {});
  }

  webSocketError(): void {
    this.scheduleNextAlarmIfIdle().catch(() => {});
  }

  private broadcastSoon(): void {
    const now = Date.now();
    if (now - this.lastBroadcast < WS_BROADCAST_MIN_MS) return;
    this.lastBroadcast = now;
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const snapshot = JSON.stringify(this.realtime());
    for (const socket of sockets) {
      try {
        socket.send(snapshot);
      } catch {
        // socket likely closing; hibernation API cleans up
      }
    }
  }

  private async scheduleNextAlarmIfIdle(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0 || this.alarmPending) return;
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null) return;
    // Nothing to do unless rows remain to ship or prune later.
    const rows = this.ctx.storage.sql.exec("SELECT seq FROM events LIMIT 1").toArray().length;
    if (rows === 0) return;
    await this.ctx.storage.setAlarm(Date.now() + IDLE_REARM_MS);
    this.alarmPending = true;
  }

  backlog(): {
    unshipped: number;
    oldestUnshippedAgeMs: number;
    sendFailures: number;
    lastShippedAt: number;
  } {
    const shippedSeq = Number(this.metaGet("shipped_seq") ?? 0);
    const row = this.ctx.storage.sql
      .exec(
        "SELECT COUNT(*) AS n, MIN(received_ms) AS oldest FROM events WHERE seq > ?",
        shippedSeq,
      )
      .toArray()[0] as { n: number; oldest: number | null } | undefined;
    return {
      unshipped: Number(row?.n ?? 0),
      oldestUnshippedAgeMs: row?.oldest ? Math.max(0, Date.now() - Number(row.oldest)) : 0,
      sendFailures: Number(this.metaGet("send_failures") ?? 0),
      lastShippedAt: Number(this.metaGet("last_shipped_at") ?? 0),
    };
  }

  async purge(): Promise<void> {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    this.alarmPending = false;
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(1000, "site purged");
      } catch {
        // ignore
      }
    }
  }
}
