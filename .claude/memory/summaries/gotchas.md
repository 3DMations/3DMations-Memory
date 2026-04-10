# gotchas

*Last regenerated: 2026-04-10 — high-recurrence entries (recurrence >= 3) + critical audit findings*

---

## CRITICAL: Never cite a paper without a verifiable DOI or arXiv ID

The Memory Hub v2.3 trace architecture was justified by "Meta-Harness (Lee et al., 2026)" — a paper that cannot be found on arXiv, Google Scholar, DBLP, or Semantic Scholar. No DOI, arXiv ID, or URL was provided.

**Rule:** Before using a paper as architectural justification, verify it exists at a citable URL. "Preprint" requires a link. If unverifiable, label the feature "experimental" and plan internal validation.

---

## CRITICAL: bash read-modify-write on shared files requires flock

Any bash pattern that does `read JSON → modify → write JSON` on a file shared between concurrent processes is a race condition. In 3DMations-OPS with overlapping systemd tasks, this is guaranteed to occur.

**Rule:** Wrap every shared-file read-modify-write in `(flock -x FD; ...) FD>lockfile`.

---

## HIGH: PostgreSQL UPSERT timestamp fields should use now(), not EXCLUDED.timestamp

`ON CONFLICT DO UPDATE SET updated_at = EXCLUDED.updated_at` is nondeterministic under concurrent inserts — whichever network packet arrives first wins. Use `updated_at = now()` for server-side determinism.
