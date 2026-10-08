# AeroFly Tours — Supabase Foundation

## Status

Phase 1 — Supabase Foundation

Status: Implemented in application code; deployment and verification required.

---

## Target Architecture

```text
React + TypeScript
        |
        v
Supabase Client
        |
        +--------------------------+
        |                          |
        v                          v
Supabase Auth             Supabase PostgreSQL
                                   |
                                   v
                                  RLS
                                   |
                    +--------------+--------------+
                    |              |              |
                    v              v              v
                Profiles         RBAC          Storage
                    |
                    v
            Organization layer