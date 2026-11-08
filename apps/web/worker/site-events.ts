// eslint-disable-next-line import/no-unresolved
import { DurableObject } from "cloudflare:workers";
import type { DurableEvent } from "./analytics/collect";

const RETENTION_MS = 30 * 60 * 1000; // keep rows for the realtime window
const WS_TICK_MS = 30_000;
const WS_BROADCAST_MIN_MS = 2_000;
const IDLE_REARM_MS = 15 * 60 * 1000;

export interface RealtimeStats {
  currentVisitors: number;
  visitors30m: number;
  pageviews30m: number;
  pageviewsPerMinute: number[];
  topPages: { pathname: string; views: number }[];
  topReferrers: { referrer: string; views: number }[];
  topCountries: { country: string; views: number }[];
}

interface EventRow {
  received_ms: number;
  visitor_id: string;
  event_type: string;
  pathname: string;
  referrer: string;
  country: string;
}

/**
 * Realtime-only buffer. The collector sends each event straight to
 * EVENT_STREAM (Pipelines confirms ingest before the event is accepted);
 * this DO keeps the same event for the 30-minute realtime window and pushes
 * aggregates to connected WebSockets. The alarm only prunes old rows and
 * ticks sockets, and stops rearming when there is nothing to do.
 */
export class SiteEvents extends DurableObject<Env> {
  private alarmPending = false;
  private lastBroadcast = 0;

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
                country TEXT
            )
        `);
  }

  async record(event: DurableEvent): Promise<void> {
    const receivedMs = Date.parse(event.received_at);
    this.ctx.storage.sql.exec(
      `INSERT INTO events
             (received_ms, visitor_id, event_type, pathname, referrer, country)
             VALUES (?, ?, ?, ?, ?, ?)`,
      Number.isFinite(receivedMs) ? receivedMs : Date.now(),
      event.visitor_id,
      event.event_type,
      event.pathname,
      event.referrer,
      event.country,
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
    await this.ctx.storage.setAlarm(Date.now() + WS_TICK_MS);
    this.alarmPending = true;
  }

  async alarm(): Promise<void> {
    this.alarmPending = false;
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM events WHERE received_ms < ?", now - RETENTION_MS);

    const hasRows =
      this.ctx.storage.sql.exec("SELECT seq FROM events LIMIT 1").toArray().length > 0;
    const hasSockets = this.ctx.getWebSockets().length > 0;
    if (!hasRows && !hasSockets) return;
    await this.ctx.storage.setAlarm(now + (hasSockets ? WS_TICK_MS : IDLE_REARM_MS));
    this.alarmPending = true;
    if (hasSockets) this.broadcastSoon();
  }

  realtime(): RealtimeStats {
    const now = Date.now();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT received_ms, visitor_id, event_type, pathname, referrer, country
                 FROM events WHERE received_ms >= ? ORDER BY seq`,
        now - 30 * 60_000,
      )
      .toArray() as unknown as EventRow[];

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

    return {
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
    // Nothing to do unless rows remain to prune later.
    const rows = this.ctx.storage.sql.exec("SELECT seq FROM events LIMIT 1").toArray().length;
    if (rows === 0) return;
    await this.ctx.storage.setAlarm(Date.now() + IDLE_REARM_MS);
    this.alarmPending = true;
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
