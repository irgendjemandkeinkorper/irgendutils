---
type: index
project: Offline Redesign
status: active
tags: [wordpress, migration]
created: 2026-07-31
---

# Offline Redesign — Project Hub

Dashboard for everything about **Offline Redesign**. Notes below stay in sync via
Dataview; the plain lists are the fallback when Dataview isn't installed.

## Start here
- [[Project Brief]]
- [[Scope & Deliverables]]
- [[Site Inventory]]
- [[Access & Credentials]]
- [[Tasks]]

## Stakeholders
```dataview
table role, email from "02-Stakeholders" where type = "person" sort file.name asc
```
- [[Jane Doe]]

## Decisions
```dataview
table status, date from "04-Decisions" where type = "decision" sort date desc
```
_New ADRs land in `04-Decisions/` (`vault add-decision offline-redesign "..."`)._

## Meetings
```dataview
table date from "05-Meetings" where type = "meeting" sort date desc
```
_New notes land in `05-Meetings/` (`vault add-meeting offline-redesign "..."`)._

## Open tasks
```dataview
task from "06-Tasks" where !completed
```
See [[Tasks]].
