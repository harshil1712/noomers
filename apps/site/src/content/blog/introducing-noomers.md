---
title: "Introducing noomers: privacy-first self-hosted analytics"
description: "Self-hosted web analytics on Cloudflare — a tiny tracker, realtime Durable Objects, and durable history in Basin SQL."
pubDate: 2026-11-02
updatedDate: 2026-11-02
author: "noomers team"
tags: ["announcement", "privacy", "cloudflare"]
tldr: "noomers gives you Plausible-style analytics that live entirely inside your own Cloudflare account: a cookieless tracker, realtime Durable Objects, and durable history via Basin Pipelines → R2 → Iceberg → Basin SQL."
faq:
  - q: "Is noomers a drop-in Plausible replacement?"
    a: "It implements a subset of Plausible's Events, Sites and Stats APIs — see the parity document in the repo for exact coverage. It is not full parity and never claims to be."
  - q: "Where does my analytics data live?"
    a: "Inside your own Cloudflare account: D1 for the site registry, a per-site Durable Object for realtime buffering, and R2/Iceberg for history. Nothing is sent to a third party."
---

## The short version

noomers is a privacy-first web analytics platform you self-host on Cloudflare. You add a script tag to your site, and events flow through a Cloudflare Worker into a per-site Durable Object, then durably into a Basin pipeline — all inside your own account.

## Why self-hosted

Analytics data is visitor data. With noomers it never leaves your infrastructure: the site registry lives in D1, realtime state in Durable Objects, and long-term history in R2/Iceberg queried through Basin SQL. There is no retention cliff and no vendor in the middle.

## Privacy guarantees are architecture

There are no cookies. Raw IP addresses and full user-agent strings are never persisted. Visitor identifiers are salted, site-scoped, hostname-scoped, and rotate daily in UTC — so visitors can't be tracked across days, sites, or devices.

## What's included

The dashboard (single-owner, Better Auth admin) shows stats, timeseries, realtime visitors, goals, and breakdown cards. Collection works through `/collect`, plus the Plausible-compatible Sites and Stats APIs for automation — see the parity doc for the supported subset.
