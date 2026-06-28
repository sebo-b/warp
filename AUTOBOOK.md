# Auto-book heuristics ("find me a seat")

This document explains, in detail, how the **auto-book** feature decides _which_
seat to give you (or another user) for a set of requested days/times. It
describes — and matches — the implementation in `warp/xhr/plan.py` (`autoBook`
endpoint + `runAutoBook` core).

For the surrounding access model see [PERMISSIONS.md](PERMISSIONS.md); for term
definitions see [GLOSSARY.md](GLOSSARY.md).

> **TL;DR.** Auto-book works **one day at a time**, only on the plan currently
> open in the UI. For each requested day it picks a seat by priority: the seat you
> already hold that day (extend/shrink it) → a seat reserved (assigned) to you →
> your most-used seat (by cumulative booked time) → another seat in that seat's
> zone → a seat in the biggest zone → any free seat (chosen at random to spread
> people). Seats that are taken or outside the assignment window are skipped. Days
> it can't satisfy are reported back, with hints about when reserved seats open up.

---

## 1. Inputs and outputs

**Request** (`POST /xhr/plan/autoBook/<pid>`):

- `dates`: a list of `{fromTS, toTS}` slots (absolute unix seconds). There may be
  several slots, possibly spanning several days.
- `login` (optional): book _as_ this user instead of yourself (see §3).

**Response** (HTTP 200) is a report with four buckets:

| Bucket         | Meaning                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `booked`       | slots that were successfully booked (or were already booked exactly)                                     |
| `not_extended` | slots where you already had a booking that **could not** be changed/extended (a conflict got in the way) |
| `unbookable`   | slots where **no** seat was available; each carries `future_options` (see §8)                            |

(The old `already_booked_elsewhere` bucket is being removed — see §11 note 1.)

Error statuses: `403` for out-of-window dates or no eligible zone; `400` for
overlapping slots in the request or a database conflict at commit time.

---

## 2. Permission gate (the `autoBook` endpoint)

Auto-book is **always a regular-user action**: the seat it picks is one the
**subject** of the booking could have picked themselves. Roles are equal here —
there is **no** site-admin super-user bypass and **no** confinement to "the zones
the actor administers". The actor's role only governs _who may book for whom_:

- **Booking for yourself** (`login` omitted) → always allowed. Seat selection
  acts as you.
- **Booking as another user** (`login` differs) → only a **site admin** or a
  **zone admin of at least one zone on this plan** may do this. Once allowed, seat
  selection acts entirely as the **target** user (see §3) — the actor's own zones
  are irrelevant. A regular user may never book as someone else (`403`, code 104).

The plan must also contain at least one zone the **subject** can book in;
otherwise the request is rejected (`403`, code 104).

> This is intentionally more permissive than **manual** book-as, which also
> requires the actor to administer the _specific seat's_ zone. Auto-book-as only
> requires admin standing on the plan, because the seat it ultimately picks is —
> by construction — always one the target could have booked on their own.

---

## 3. Whose seats, whose access

`runAutoBook(login, pid, dates)` selects seats that the **subject `login`** is
allowed to book — and **only** those:

- enabled seats, in non-disabled zones, where the subject has `zone_role ≤ user`
  (this includes zones they administer, since admin ≤ user numerically); **plus**
- all enabled seats in **public-book** zones (everyone may book those).

This is the subject's _regular_ access — exactly what they would get if they
clicked "find me a seat" themselves. For a book-as call the subject is the
**target** user, so the target can never be placed on a seat they could not have
booked on their own. The actor's roles never widen (or narrow) this pool.

All of this is scoped to the **plan named in the request** (`pid`) — i.e. the
plan currently open in the UI. Auto-book only ever considers the zones and seats
on that one plan; it never looks at other plans.

> The core also accepts an optional zone restriction used only by the **calendar
> "book" link**, which confines auto-book to the single zone named in a per-zone
> reminder (a plan can span several zones). The interactive auto-book endpoint
> never restricts beyond the subject's own access.

---

## 4. Up-front validation

1. **Plan exists** — otherwise error 130.
2. **Every slot is inside the booking window** `[today, today + WEEKS_IN_ADVANCE]`.
   A single out-of-window slot rejects the **whole** request (code 103).
3. **No overlapping slots in the request** — slots are sorted by start; if any
   slot ends after the next one begins, the whole request is rejected (code 140).

> **Timezone.** `runAutoBook` now operates in the **plan's own IANA timezone**
> (PLAN_per_plan_timezone §7). The algorithm is unchanged; only the source of
> `today`/`now` moved — `runAutoBook(pid)` resolves `today(plan_tz)` once and
> seeds the window check above, the usage-range scan, and the `days_in_advance`
> cutoff with it. Stored `fromts`/`tots` stay wall-clock and need no conversion;
> all `%86400`/`+86400` day math remains in wall-clock space.

---

## 5. Per-seat classification (assignments)

Every candidate seat is classified by how it relates to the target user, based on
its assignment rows (see GLOSSARY → _assigned seat_):

| Kind       | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `none`     | seat has no assignments — freely bookable                              |
| `direct`   | seat is assigned to the target user                                    |
| `everyone` | seat has an "everyone" (NULL-login) assignment                         |
| `blocked`  | seat is assigned, but only to **other** people → **excluded entirely** |

If both a direct and an everyone row apply, the seat counts as `direct`
(priority: `blocked` < `none` < `everyone` < `direct`).

Each eligible seat also carries a **days-in-advance horizon** (`dia`): across all
assignment rows that apply to the target, if any row is _unlimited_ the horizon is
unlimited; otherwise it is the **largest** (most permissive) finite value.
`blocked` seats are removed from consideration completely.

> This classification feeds both **eligibility** (blocked seats are dropped; a
> seat is bookable only within its `dia` window) **and priority**: a seat
> `direct`-assigned to you is offered first (§6 step 2), ahead of the shared pool.
> `everyone`/`none` seats are that shared pool (§6 steps 3–6).

---

## 6. Selection priority (which seat you get)

For each requested day, among the seats the subject may book (the eligible pool
of §3 and §5), auto-book walks the priority below **in order** and takes the
first seat that is actually free for **all** the day's slots ("covers all" — §7).
Everything is scoped to the **current plan**.

1. **The seat you already hold that day.** If the subject already has a booking
   overlapping the requested slots, keep that seat and just **extend or shrink**
   it to the requested time. → If that seat can't be adjusted (another booking is
   in the way) or there is none, go on.
2. **A seat assigned to you.** A seat directly **reserved** for the subject (a
   `direct` assignment — §5). Among your reserved seats — in one zone or spread
   across zones on the plan — try them ordered by **descending days-in-advance**
   (`dia`): an _unlimited_ seat before a 7-day one before a 2-day one, since a
   higher `dia` is the seat most reliably yours. Equal `dia` is broken by your own
   cumulative booked time, then spread. (A reserved seat whose `dia` window hasn't
   opened for the requested date is simply not eligible yet.) This offers your
   reserved seat before any shared one, even a brand-new reservation you have never
   sat in. → If no reserved seat is free, go on.
3. **Your most-used seat.** The eligible (shared) seat with the **longest
   cumulative booked time** over the look-back window
   (`AUTOBOOK_USAGE_WINDOW_DAYS`, default 30 days, centred on today). Measured as
   total **time** (Σ `toTS − fromTS`), _not_ a count of bookings — so a desk you
   hold all day beats a phone booth you grab many short times. → If it is
   occupied, go on.
4. **Another seat in that seat's zone.** The remaining seats in the **same zone**
   as your most-used seat (step 3), tried iteratively in ranked order (your own
   booked time first, then least-loaded — see below). This is the "my usual seat
   is taken, give me another desk nearby" fallback. → If that zone has no free
   seat, go on.
5. **A seat in the biggest zone.** When the subject has **no usage history** at
   all (so there is no step-3 seat), or the step-4 zone is full, fall back to the
   zone with the **most seats** on the plan (the main area) and take a free seat
   there. → If that fails, go on.
6. **Any free seat, chosen at random to spread people.** Last resort: any
   remaining available seat, picked **randomly** so bookings spread out across the
   plan rather than cluster.

Reading it end to end: extend what you already have → your reserved seat → your
usual shared seat → its zone → the main (biggest) zone → anywhere, at random.

**Ordering rules used above:**

- **Assigned seats (step 2)** are ordered by **descending `dia`**, then by your
  cumulative booked time, then spread.
- **"Most-used" (steps 3–4)** ranks by the subject's own **cumulative booked
  time** on the seat over the look-back window (descending).
- **"Least-loaded / spread" (steps 4–6)** prefers seats with the least total
  booked time across all users; step 6 picks **at random**, so repeated calls
  don't all land on the same seat.

All usage figures measure **total booked time** (Σ `toTS − fromTS`), never a
count of bookings.

---

## 7. Day-by-day decision

The requested slots are grouped by **day** and each day is handled
independently. For one day with its slots:

```
  ┌───────────────────────────────────────────────────────────────┐
  │ Does the user already hold an overlapping booking this day?   │
  │  (their existing bookings on this plan that overlap the slots)│
  └───────────────────────────────────────────────────────────────┘
        │ exactly one slot & one identical existing booking
        ▼
     already satisfied → add to `booked`, done with this day
        │ otherwise
        ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ Walk the §6 selection priority and take the first seat that    │
  │ covers all the slots:                                          │
  │   1 seat you already hold → 2 a seat assigned to you →         │
  │   3 your most-used seat → 4 its zone → 5 biggest zone →        │
  │   6 any free seat (random)                                     │
  └───────────────────────────────────────────────────────────────┘
        │ found a seat                          │ none found
        ▼                                       ▼
   replace the user's conflicting          if the user had an existing
   same-zone/same-group bookings for       booking this day → slots go to
   the day (delete) and book the new       `not_extended`; else → `unbookable`
   seat for every slot → `booked`          (with future_options, §8)
```

Priority step 1 is the day's existing booking (extend/shrink); steps 2–6 are the
§6 fallback — your reserved seat first, then your usual shared seat and its zone,
then the biggest zone, then a random free seat.

The exact-match branch shown above is **UI-guarded** rather than essential: the
auto-book button is disabled when the selection already matches one of your
bookings (§11 note 3), so the backend short-circuit is optional — re-booking an
identical seat is a harmless no-op.

**"Covers all the slots"** (`covers_all`) means, for every slot of the day:

- the slot is **within the seat's assignment horizon** (`dia`) — a reserved seat
  whose release window hasn't opened yet does not qualify; and
- the seat is **free** at that time — no other booking overlaps it, **except**
  the user's own bookings that are about to be replaced (see below); and
- booking it would **not break exclusivity** for the user: they must not already
  hold another seat at that time in the **same zone**, or — if the seat's zone
  belongs to a **zone group** — in **any zone of that group**.

**Replacing / extending.** When the chosen seat is in the same zone (or zone
group) as a booking the user already holds that day, those old bookings are
**deleted** and the new ones inserted in a single transaction. This is what makes
auto-book _adjust_ an existing booking (e.g. extend 9–12 to 9–17 on the same
seat, or move to a better seat in the same zone) instead of failing on the
one-seat-per-zone rule.

---

## 8. `future_options` (why a day was unbookable)

When a day ends up `unbookable` **and** the user had no existing booking to
extend, auto-book attaches hints: for every **reserved** seat (`direct` or
`everyone` with a finite horizon) whose release window has **not opened yet** and
that isn't already taken by someone else for that slot, it reports:

- the seat, and
- `available_from_ts` — the date the seat opens for the user (slot day minus the
  horizon).

Sorted by soonest-available, then seat id. This powers the "Seat X becomes
available on Y" message in the UI.

---

## 9. Committing

All deletions and insertions for the whole request are applied in **one database
transaction**. The database's own overlap trigger is the final backstop: if a
concurrent booking sneaks in, the commit fails and the whole call returns a
conflict (code 109) without partial changes.

---

## 10. Configuration knobs

| Setting                      | Default | Effect on auto-book                                                                     |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `WEEKS_IN_ADVANCE`           | 1       | the booking window; slots beyond it are rejected                                        |
| `AUTOBOOK_USAGE_WINDOW_DAYS` | 30      | size of the ±window over which booked **time** is summed — both your own (to rank your assigned seats and find your most-used seat, §6 steps 2–3) and everyone's (for the least-loaded "spread" tie-break) |
| `BOOK_OPEN` / `BOOK_CLOSE`   | 0 / 24h | bounds of the daily time range the UI offers (not enforced inside the core selection)   |

---

## 11. Notes / open questions

A mix of **decisions** (marked _decided/accepted_) and still-**open** questions
(marked _open_) about behaviour around the core algorithm:

1. **`already_booked_elsewhere` — removed (done).** A vestige of the old
   **per-zone** autobook (it reported an existing exact booking that sat in a
   *different* zone of the same group than the one you ran autobook on). In the
   per-plan model that distinction is gone — an existing seat on the plan is taken
   at step 1 with top priority — so the bucket was never filled. Removed from
   `runAutoBook`'s result and the "Already booked in another zone" section from
   `showAutoBookResult` in `plan.js`. (Other zones — even in the same group —
   don't matter: clicking autobook means "book me a seat on the plan I'm looking
   at, by priority".)
2. **Each day is solved independently — accepted.** A multi-day request may land
   you on a _different_ seat each day (the only cross-day pull is the usage-based
   priority and the per-day "extend a seat you already hold"). **Decision: this is
   fine** — no attempt to force one seat across the whole span.
3. **Exact match is handled in the UI only — decided.** The auto-book button is
   already disabled when the current selection exactly matches one of your existing
   bookings on the plan (`isExactMatch` / `updateFabState` in `plan.js`). Since
   re-running autobook on an exact match would, at worst, re-book the seat you
   already have (a harmless no-op), the backend needs **no** exact-match
   special-casing. The narrow §7 short-circuit was left in place as a harmless
   optimisation (it returns the existing seat without a needless re-write).
   _(Possible gap to confirm: the FAB-disable currently keys on accessible-zone
   bookings; a leftover booking in an **inaccessible** zone of the plan would not
   disable it.)_
4. **`dia` gates the window for everyone, and orders assigned seats (decided).**
   `dia` (days-in-advance) bounds how far ahead a seat can be booked — a slot
   qualifies only if it's within `dia` days of today — and this applies to the
   seat's **owner** too (no special "owner is always unlimited" override; option
   (a)). If the window is open for the requested date, the assigned seat simply
   takes its step-2 priority; if not, it isn't eligible yet. **In addition**, when
   the subject has several assigned seats, step 2 orders them by **descending
   `dia`** (unlimited > 7 > 2), because a higher `dia` is the seat most reliably
   theirs; equal `dia` falls back to usage, then spread.
5. **Selection priority — implemented (done).** The old assignment-tier +
   booking-count ranking has been replaced by the §6 priority: `_seatBookCount`
   became `_seatBookTime` (`SUM(toTS − fromTS)`); the subject's per-seat booked
   time finds the top shared seat and its zone and tie-breaks the assigned seats;
   **assigned seats are ordered by descending `dia`** then time; a per-zone
   eligible-seat count drives the "biggest zone" step; the last-resort seat is
   chosen at random; `rankTier`/the tier walk are gone, replaced by the ordered
   fallback (held seat → assigned seat → top shared seat → its zone → biggest zone
   → random).
6. **"Spread" is random (decided).** Step 6 picks a free seat **at random** (by
   design, to spread bookings). Consequence for tests: the random step can't
   assert a *specific* seat — assert the result is in the expected zone/set, or
   seed/inject the RNG so a test can pin it.
7. **Assignment vs. public-book: the assignment wins (intended).** A seat in a
   PUBLIC_BOOK ("everyone can book") zone is normally unassigned, so anyone may
   take it. But an assignment is enforced regardless of zone type: if such a seat
   is `direct`-assigned to Alice (or carries any specific assignment), then **only**
   the assignee(s) may book it — everyone else is `blocked`, even though the zone is
   "public". For autobook this means the seat is Alice's reserved seat (§6 step 2)
   and is excluded from everyone else's pool — an assignment effectively carves a
   private seat out of an open zone. **Confirmed intended** (long-standing
   behaviour; noted only because it is easy to miss on mixed plans).
