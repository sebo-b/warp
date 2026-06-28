# Glossary

Plain-language definitions of the core concepts in warp. For _who is allowed to
do what_, see [PERMISSIONS.md](PERMISSIONS.md).

> **The one-sentence mental model:** a **plan** is a floor map that holds
> **seats**; each seat belongs to a **zone**; the zone decides **who may see or
> book** that seat. Plans are _layout_, zones are _access control_ — two
> independent things that meet at the seat.

---

## People

### User

An account that can sign in. A user has a **login** (the unique id used to sign
in and the key everything else hangs off — bookings, group membership), a
display **name**, and an **account type**. Account type is the _global_ role:

| Account type           | Meaning                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| **Site administrator** | Can manage everything: users, groups, zones, plans, and every seat/booking. A super-user. |
| **Regular user**       | Can see and book seats according to the zone permissions granted to them.                 |
| **Blocked user**       | The account exists but cannot sign in.                                                    |

### Site administrator

A user whose account type is _administrator_. Site admins are the only ones who
can reach the management screens (Users, Groups, Zones, Plans) and they
implicitly administer **every** zone and plan, even ones nobody explicitly
assigned them to. Think "owner of the whole installation".

### Group

A named container of users used to grant zone access in bulk. A group is stored
as a special account that **cannot sign in**. Assigning a _group_ to a zone
grants that access to **every member of the group**. Groups can contain other
groups; membership is followed transitively (a member of a member is a member).

---

## Spaces

### Plan

A **floor map**: an uploaded image plus the seats placed on it. A plan is what a
user actually looks at when booking ("here is the office floor, pick a desk").
A plan owns its seats and the map image. A single plan can contain seats from
**several different zones** (e.g. an open area anyone can book plus a restricted
corner), which is what makes the access rules interesting.

#### Plan timezone

An IANA timezone (e.g. `Europe/Warsaw`) attached to a plan. All seats on a plan
share its timezone. Bookings are stored as **wall-clock** integers in the plan's
TZ (the "airline ticket" guarantee: 06:00–18:00 stays 06:00–18:00 to anyone
viewing that office, even across DST). Real UTC instants are **derived at the
edges** for the work that genuinely needs them: cross-plan conflict comparison
(see `book_utc`) and iCal `VTIMEZONE`. New plans default to the deployment's
`DEFAULT_PLAN_TIMEZONE`.

### Zone

A pure **access-control group of seats** — it has no map of its own. A zone
answers the question "who is allowed to see or book the seats tagged with this
zone, and how far can they book?". Every seat carries exactly one zone. A zone
has a **zone type** and an optional **zone group**.

#### Zone type

How _open_ the zone is to people with no explicit role in it:

| Zone type         | Who gets access without an explicit role                               |
| ----------------- | ---------------------------------------------------------------------- |
| **Disabled**      | Nobody (only an explicit zone-admin may even look; nobody may book).   |
| **Enabled**       | Nobody — access must be granted explicitly (the normal, private zone). |
| **Public (view)** | Everybody may _see_ the seats (but not book without a role).           |
| **Public (book)** | Everybody may _see and book_ the seats.                                |

#### Zone role

The level a user (or group) is granted **within a specific zone**:

| Zone role       | Can do                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| **Zone admin**  | Everything in the zone: enable/disable seats, assign seats, book for others. |
| **Zone user**   | See and book seats in the zone.                                              |
| **Zone viewer** | See the seats and existing bookings, but not book.                           |

#### Zone group

An optional label shared by several zones to make booking **mutually
exclusive** across them. If two zones share a zone group, a user may hold at
most **one** seat across _all_ zones in that group at the same time (handy for
"one parking spot per person across all car parks"). A zone with no zone group
is exclusive only with **itself** (one seat per zone at a time).

A zone group may span **plans in different timezones**. Because stored booking
timestamps are per-plan wall-clock, wall-clock-integer comparison is no longer
sufficient across such a group, so the exclusivity rule (`book_overlap_insert`)
compares **real UTC instants** via `book_utc` — the same wall-clock 14:00 in
`Europe/Warsaw` and `America/New_York` is allowed, while two bookings that share
a real instant (even with different wall-clks) conflict.

### Seat

A bookable spot on a plan, drawn at an (x, y) position on the map. A seat
belongs to exactly one **plan** (which map it is on) and one **zone** (who may
book it). A seat can be **enabled** or **disabled**.

### Disabled seat

A seat that has been turned off. Non-admins do not see it at all; zone admins
see it greyed out and can re-enable it. A disabled seat cannot be booked.
(Distinct from a _disabled zone_, which turns off a whole group of seats.)

---

## Bookings

### Booking

A reservation of one seat for one user over a time range (from–to) on a given
day. The same seat cannot be double-booked for overlapping times, and a user
cannot hold two seats in the same zone (or zone group) at the same time.

### book_utc

A SQL **view** that derives real UTC instants from the wall-clock storage: for
each booking it joins `book → seat → plan` and re-interprets the stored
`fromts`/`tots` digits as local time in the booking's **plan timezone**, yielding
`from_utc`/`to_utc` (`timestamptz`). Used by `book_overlap_insert` for cross-TZ
conflict comparison and by report/export reads that need chronological, real-
instant ordering. A plain view, so a `plan.timezone` edit is reflected with no
stored-UTC to refresh.

### Assigned seat (assignment)

A seat can be **reserved** for particular people. Each assignment row names a
user (or _everyone_) and an optional **days-in-advance** value. If a seat has
any assignment, only the named users (or everyone, if there is an everyone row)
may book it. Assignment is _not_ the same as a booking — it is a standing
reservation of the _right to book_.

### Everyone assignment

An assignment whose target is "everyone" rather than a named user. Combined with
a private assignment it produces the classic **reserve-then-release** pattern:
the seat belongs to its named owner, but opens up to everyone a few days before
each date (see _release time_).

### Days in advance

How far ahead an assignment lets its holder book. `Unlimited` means the holder
can book at any time within the system's booking horizon. A finite value, e.g.
`3`, means the holder may only book dates within the next 3 days — used on an
_everyone_ assignment to control when a reserved seat opens to the public.

### Release time

The moment a privately-assigned seat **opens for general booking**. If a seat is
assigned to Alice (unlimited) and also to _everyone_ with 3 days-in-advance,
then for any given day the seat is Alice's until 3 days before — at that point it
"releases" and anyone may grab it. The calendar integration can send a _seat
release reminder_ so the owner knows before their seat opens up.

### Booking window / horizon

The range of dates that are open for booking at all, configured installation-
wide (a number of weeks in advance). No one — not even an admin booking for
themselves — can book outside this window through the normal booking screen.

### Book as

A convenience for zone (and site) admins: book (or auto-book) a seat **on behalf
of another user**. The booking is recorded under the target user, who must be
allowed to book that seat. (Manual book-as requires the admin to manage the
seat's own zone; auto-book-as only requires admin standing on the plan — see
[PERMISSIONS.md](PERMISSIONS.md) §8.)

### Auto-book ("find me a seat")

Instead of picking a specific seat, the user asks the system to choose the best
available seat on the plan for the selected dates, honouring assignments, the
release window, and existing bookings. Admins can also auto-book _as_ another
user, in which case it runs **as that user** — picking only seats the target
could book themselves. See [AUTOBOOK.md](AUTOBOOK.md) for the selection priority.

### Effective zone role

The role a user _actually_ has in a zone once everything is combined: their
explicit role (if any), the roles inherited from their groups, and the zone's
type (which can grant a baseline role to everyone). See
[PERMISSIONS.md](PERMISSIONS.md) for the exact rules.
