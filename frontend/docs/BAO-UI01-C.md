# BAO-UI01-C — Persisted FAQ lifecycle UI (08/11/2026)

The knowledge page now calls the real Page-scoped document API. EDITOR/ADMIN
can create FAQ drafts, select persisted documents, create edited draft versions
and submit the saved version. REVIEWER/ADMIN can approve/reject pending versions
and archive documents. Source history displays content, status, author/reviewer,
review time and active-source marker. Editing keeps the old approved source
active until a later version is approved. Archive disables edits.

The form is preserved on an error/409. Reload is explicit; the page explains
that review actions apply to saved content, not unsaved form edits. Source text
is rendered as React text, not HTML. Lists show up to 100 newest documents and
say when more exist. Upload and source-grounded Q&A remain G1 work.

Validation on isolated PostgreSQL-backed API, with external workers disabled:
- ESLint, TypeScript and webpack production build passed.
- Playwright actual browser: ADMIN creates/submits/approves FAQ; EDITOR can
  edit/submit and cannot archive; REVIEWER cannot create/edit and can approve.
- New version preserves active source; concurrent external edit triggers 409
  and keeps unsaved form content. Archive disables editing and excludes source
  from search. Empty state, simulated 503/reload recovery checked.
- Desktop 1440×1000 and mobile 390×844 inspected visually. Console before fault
  injection had zero errors/warnings; expected 409/503 HTTP errors are deliberate
  test cases. No JavaScript exception observed.

Screenshots and browser traces are local test artifacts, not production data.
No production deployment, application migration or Meta send performed.
