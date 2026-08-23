# FeedOps Agent: Autonomous Google Actions Center & Merchant Syndication Platform

An enterprise-grade, multi-agent operations platform built with **Google ADK**, **Gemini 2.5**, and **FastMCP** that automates merchant identity reconciliation, feed governance, and integration health for platforms connecting to **Google Actions Center (Food Ordering Redirect & Menu Feeds)**.

---

## 1. Executive Summary & Problem Statement

### The Problem
Integrating and maintaining restaurant inventory on Google Search and Maps via Google Actions Center (Food Ordering Redirect) requires heavy manual engineering and operational triage:
1. **Manual Portal Entity Matching:** Matching internal database entries to Google Maps `place_id` records.
2. **Missing Google Business Profiles (GBP):** Unindexed or mislocated merchants cannot receive "Order Online" buttons.
3. **Strict Daily Feed Delivery:** Requirement to generate, lint, and SFTP 3 monolithic feeds (`Entity`, `Action`, `Service`) daily across Sandbox and Production for $\ge 3$ consecutive error-free days with $\ge 10$ active entities.
4. **Recurring Conversion Health Checks:** Manual weekly execution of `conversion_tracking.sh` test tokens (`rwg_token`) to prevent portal de-indexing.
5. **Launch Review Readiness:** Manual inspection of schema compliance, Place ID match ratios, and deep-link health before requesting production launch.

### The Solution
**FeedOps Agent** turns this deterministic script pipeline into a self-healing, autonomous multi-agent system that automates the entire partner lifecycle from raw menu photo ingestion to live Google production launch.

---

## 2. Multi-Tier Target Personas