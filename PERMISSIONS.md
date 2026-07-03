# Permissions

How warp decides **who can see, book, and manage** seats. This document is the
authoritative description of the access model. For definitions of the terms used
here (zone, plan, assignment, …) see [GLOSSARY.md](GLOSSARY.md).

---

## 1. The three independent dimensions

Access is the combination of **three separate things**. Keeping them apart is the
key to understanding the whole model:

```
  ┌─────────────────────┐   ┌──────────────────────┐   ┌────────────────────┐
  │  ACCOUNT TYPE       │   │  ZONE TYPE           │   │  ZONE ROLE         │
  │  (who you are,      │   │  (how open a zone    │   │  (what you were    │
  │   globally)         │   │   is to everyone)    │   │   granted in a     │
  │                     │   │                      │   │   zone)            │
  │  • Site admin       │   │  • Disabled          │   │  • Zone admin      │
  │  • Regular user     │   │  • Enabled (private) │   │  • Zone user       │
  │  • Blocked          │   │  • Public (view)     │   │  • Zone viewer     │
  │                     │   │  • Public (book)     │   │  • (none)          │
  └─────────────────────┘   └──────────────────────┘   └────────────────────┘
           │                            │                          │
           └──────────────┬─────────────┴──────────────┬──────────┘
                          ▼                             ▼
                 site admins are            ZONE TYPE + ZONE ROLE  ⇒  EFFECTIVE
                 super-users (§4)           combine per zone (§3)      ZONE ROLE
```

- **Account type** is the _global_ role of the login (site admin / regular /
  blocked). It is checked at sign-in and gates the admin screens.
- **Zone type** is a property of the _zone_ and sets a baseline that applies to
  _everyone_, even people with no explicit grant.
- **Zone role** is an explicit grant of a level (admin / user / viewer) to a
  _user or group_ in a _specific zone_.

Zone type and zone role combine into the **effective zone role** — the level a
person really has in that zone.

> **Numeric convention (in code):** for both account type and zone role, **lower
> number = more powerful**. Admin = 10, user = 20, viewer = 30. "Most permissive"
> therefore means "smallest number", which is why the code uses `MIN`.

---

## 2. Account types (global role)

| Account type           |      Sign in?       | Admin screens? | Booking ability                                |
| ---------------------- | :-----------------: | :------------: | ---------------------------------------------- |
| **Site administrator** |         yes         |      yes       | super-user over every zone & plan (§4)         |
| **Regular user**       |         yes         |       no       | governed entirely by effective zone roles (§3) |
| **Blocked**            |         no          |       –        | –                                              |
| **Group**              | no (cannot sign in) |       –        | a vehicle for granting zone roles in bulk (§5) |

Only site administrators can open **Users**, **Groups**, **Zones**, and
**Plans** management, and the backend re-checks this on every related request —
hiding a menu item is never the only line of defence.

---

## 3. Effective zone role = zone type ⊕ zone role

For a given user and a given zone, the **effective zone role** is computed from
the zone's _type_ and the user's _specific role_ in that zone (the specific role
already includes everything inherited from groups — see §5).

The rule:

1. **Disabled** zone → effective role is **admin** _only if_ the user has an
   explicit zone-admin grant; otherwise **no access**. (Disabled zones are
   locked down: even an admin cannot _book_, only re-enable — see §7.)
2. Otherwise, the zone type grants a **baseline for everyone**:
   - Public (book) → everyone is a **zone user**
   - Public (view) → everyone is a **zone viewer**
   - Enabled (private) → everyone is **nothing**
3. The effective role is the **most permissive** of {explicit role, baseline}
   (i.e. the smaller number). No access if both are empty.

### The full matrix

Columns are the explicit zone role the user holds (possibly via a group); rows
are the zone type. Cells are the **effective** role.

| Zone type ↓ \ Explicit role → | **(none)** | **viewer** | **user**  | **admin** |
| ----------------------------- | ---------- | ---------- | --------- | --------- |
| **Disabled**                  | no access  | no access  | no access | **admin** |
| **Enabled**                   | no access  | viewer     | user      | admin     |
| **Public (view)**             | viewer     | viewer     | user      | admin     |
| **Public (book)**             | **user**   | user       | user      | admin     |

Things worth noting in the matrix:

- A **public (view)** zone makes seats visible to all, but only people with an
  explicit _user_/_admin_ grant can actually book.
- A **public (book)** zone lets _anyone signed in_ book — and an explicit
  _viewer_ grant cannot demote them below that public baseline (they still get
  _user_). You can only ever be raised to the more permissive level.
- A **disabled** zone ignores _viewer_/_user_ grants entirely; only an explicit
  _admin_ keeps any access at all (and even then, not booking).

> **Implementation:** this matrix is now materialized directly in the
> `user_to_zone_roles` view, which is the single source of truth for zone
> access. A row exists iff the user has effective access, and `zone_role` is
> the effective role above. Application code reads `zone_role` straight from the
> view — no per-call `zone_type ⊕ role` recomputation. Blocked users
> (account_type 90) are included in the view (same `< 100` filter); blocked
> status is enforced only at the auth layer (sign-in / session), so admins can
> still manage and book on their behalf.

---

## 4. Site administrators are super-users

A site administrator (account type _administrator_) is treated as a **zone admin
of every zone**, including zones nobody explicitly assigned them to. Concretely
they can:

- open and view **any** plan and its seats;
- manage seats anywhere (enable/disable, assign);
- book for themselves in any non-disabled zone, and book _as_ any user who is
  allowed in that zone.

This makes the booking screens behave consistently with the management screens
(which already treat the site admin as owner of everything). The **disabled-zone
"no booking" rule still applies even to site admins** (§7).

**One deliberate exception — self auto-book.** When a site admin uses "find me a
seat" _for themselves_, the super-user bypass is **not** applied to seat
selection: auto-book only considers zones where the admin has a _regular_ grant
(or that are public-bookable), exactly as it would for any other user. Otherwise
an admin could be auto-booked into a zone they merely oversee but never sit in.
The bypass still applies to viewing, managing, and booking _as_ another user.

> Implementation note: the booking endpoints (`getSeats`, `apply`, `autoBook`)
> short-circuit to _zone admin_ when `flask.g.isAdmin` is set, mirroring the
> bypasses already present in the view layer (`view.plan`, `view.planImage`,
> `zone.getUsers`). A site admin therefore does **not** need a `zone_assign` row
> to use a plan.

---

## 5. Groups and role nesting

Zone roles can be granted to a **group** instead of an individual. Every member
of the group then inherits that grant, and membership is **transitive** — a
member of a sub-group is a member.

When a user ends up with **several** grants for the same zone (their own grant
plus one or more via groups), they keep the **most permissive** one (the
smallest role number):

```
   user "alice"
     ├─ direct grant on Zone 1 ........... viewer (30)
     ├─ member of group "team"  ─ grant on Zone 1 ... user (20)
     └─ member of group "leads" ─ grant on Zone 1 ... admin (10)
                                                       ─────────
   alice's specific role in Zone 1 = MIN(30,20,10) =  admin (10)
```

This "specific role" is then fed into the effective-role rule of §3. Group
accounts themselves never get access (they cannot sign in); only the human
members do.

---

## 6. What each effective role can do

| Capability                            | viewer | user | zone admin / site admin |
| ------------------------------------- | :----: | :--: | :---------------------: |
| See the plan & its seats              |   ✓    |  ✓   |            ✓            |
| See who has booked (where shown)      |   ✓    |  ✓   |            ✓            |
| Book a seat for themselves            |   –    |  ✓   |            ✓            |
| Cancel **their own** existing booking |   ✓¹   |  ✓   |            ✓            |
| See **disabled** seats                |   –    |  –   |            ✓            |
| Enable / disable seats                |   –    |  –   |            ✓            |
| Assign seats to users / everyone      |   –    |  –   |            ✓            |
| Book / cancel **as another user**     |   –    |  –   |           ✓²            |

¹ A viewer can always remove a booking they already hold (e.g. left over after a
zone was switched to view-only), but cannot create new ones.
² Booking as another user additionally requires the _target_ to be allowed to
book in that zone (see §8).

### Plan-level mode

A plan can mix zones, so the screen picks a mode from the user's roles across all
zones on that plan:

- **Admin mode** — the user administers _at least one_ zone on the plan (or is a
  site admin). The assign / enable / disable / book-for tools appear.
- **Viewer mode** — the user can only _view_ every zone they can reach on the
  plan (no booking anywhere). The booking actions and the auto-book button are
  hidden.
- **Normal mode** — otherwise; the user can book in the zones where their
  effective role is _user_ or better, and just view the rest.

Within a mixed plan each seat is still judged by _its own_ zone: a user might
book seats in the enabled zone while only viewing seats in a public-view zone on
the same map.

---

## 7. Booking rules (after access is established)

Having _book_ access to a zone is necessary but not sufficient. A booking is
accepted only when **all** of these hold:

1. **Effective role is _user_ or better** for the seat's zone.
2. **The zone is not disabled.** Disabled zones reject booking for _everyone_,
   including zone admins and site admins — you must re-enable the zone first.
3. **The seat is enabled.**
4. **The time is inside the booking window** (the installation's weeks-in-advance
   horizon). Site admins are exempt from the window only when booking via the
   API for themselves; the normal screens still enforce it.
5. **Assignment check** — if the seat has any assignment, the booker must be a
   named assignee or be covered by an _everyone_ assignment, **and** the date
   must fall within that assignment's days-in-advance window (see _release time_
   in the glossary).
6. **No conflict** — the seat is free for the time, and the user does not already
   hold another seat in the same **zone group** (or, for an ungrouped zone, the
   same zone) at an overlapping time.

Rule 6 is enforced at the database level, so it holds no matter which path
(manual, auto-book, calendar link) created the booking.

---

## 8. Booking on behalf of others ("book for")

Book-for is fundamentally different from booking as yourself: the actor is
acting in their capacity as **zone admin**, not as the target. Self-booking
requires the booker's own effective role to be _user_ or better; book-for
instead requires the **actor** to administer the zone, and only requires the
**target** to be a _member_ of it — any zone role, viewers included. Because
the actor is the zone's admin, they may also override seat-level assignment
restrictions there (they could reassign the seat themselves anyway) — but only
in zones they administer. Disabled zones reject booking outright, for
everyone, book-for included.

### Manual book-for (picking a specific seat for someone)

- **The actor must be a zone admin of the seat's zone** (site admins qualify
  everywhere). Being an admin of a _different_ zone on the same plan is not
  enough — e.g. an admin of the enabled zone cannot book for someone into a
  public-book zone on the same plan unless they also administer that
  public-book zone.
- **The target only needs to be a member of that zone** — a
  `user_to_zone_roles` row for the zone, of _any_ role. A zone admin can book
  for a viewer in their own zone; this is the point of the mechanism (it makes
  view-only zones genuinely centrally managed — the office manager books,
  viewers just see the outcome).
- **Assignments do not bind the target under book-for.** If the seat is
  assigned to someone else, or its days-in-advance window would otherwise
  block the date, the zone admin's book-for override still succeeds.
- **Release confinement still applies to unrelated zones.** Book-for can only
  release (delete) an existing conflicting booking of the target's if that
  booking is in a zone the actor also administers. If the conflicting booking
  is in a zone outside the actor's control, the operation is rejected rather
  than silently deleting it.
- **Disabled zones** still reject the booking outright.

### Auto-book ("find me a seat")

- **For yourself** — always a regular-user action: it picks a seat you could
  have picked yourself — no super-user bypass, and no confinement to zones you
  merely oversee. The pool is the zones where _you_ have a regular booking
  grant (or that are public-bookable). The site-admin bypass is excluded here
  (§4), so auto-book never picks a zone you only oversee.
- **For another user** — only a **site admin** or a **zone admin of some zone
  on the plan** may trigger it. The seat pool (and the release side — which
  bookings of the target's may be displaced) is confined to the zones the
  **actor** administers (unconfined for a site admin). Within that pool the
  target only needs to be a member — any role, viewers included — mirroring
  the manual book-for rule; the auto-book heuristic then picks the best seat
  among eligible ones exactly as it would for a normal booking.

See [AUTOBOOK.md](AUTOBOOK.md) for the full auto-book selection priority.

---

## 9. Decision flow: "can user **U** book seat **S**?"

```
          ┌───────────────────────────────────────────────┐
          │ Is U a site admin?                            │
          └───────────────────────────────────────────────┘
                     │ yes                       │ no
                     ▼                           ▼
        treat U as zone admin of S      Look up U's effective role in S's zone
                     │                  (zone type ⊕ U's specific role, §3)
                     │                           │
                     ▼                           ▼
          ┌────────────────────────────────────────────────┐
          │ Effective role is "user" or better?            │──no──► CANNOT book
          └────────────────────────────────────────────────┘        (view only / none)
                     │ yes
                     ▼
          ┌────────────────────────────────────────────────┐
          │ S's zone disabled, or S disabled?              │──yes─► CANNOT book
          └────────────────────────────────────────────────┘
                     │ no
                     ▼
          ┌────────────────────────────────────────────────┐
          │ Date inside the booking window?                │──no──► CANNOT book
          └────────────────────────────────────────────────┘
                     │ yes
                     ▼
          ┌────────────────────────────────────────────────┐
          │ S assigned? If so, is U an assignee / everyone,│──no──► CANNOT book
          │ and the date within the days-in-advance window?│
          └────────────────────────────────────────────────┘
                     │ yes
                     ▼
          ┌────────────────────────────────────────────────┐
          │ Seat free & U holds no other seat in the same  │──no──► CANNOT book
          │ zone group (or zone) at that time?             │        (conflict)
          └────────────────────────────────────────────────┘
                     │ yes
                     ▼
                 ✅  BOOKED
```

(For _book for_, replace the first two checks: require the **actor** to
administer S's zone, and the **target** to merely be a member of it — any
role — instead of running the role/assignment checks against the target. The
zone-disabled, booking-window, and conflict checks still apply — §8.)

---

## 10. Worked examples

A plan **"Office"** has three zones:

- **Open** — public (book)
- **Quiet** — enabled (private); _Bob_ is zone admin, _Carol_ is zone user, _Eve_ is zone viewer
- **Lab** — disabled; _Bob_ is zone admin

| Person                    | Open        | Quiet       | Lab         | Notes                                        |
| ------------------------- | ----------- | ----------- | ----------- | -------------------------------------------- |
| **Dana** (no grants)      | book        | –           | –           | public-book gives everyone _user_ in Open    |
| **Carol** (user in Quiet) | book        | book        | –           | sees Lab? no — disabled & no admin grant     |
| **Eve** (viewer in Quiet) | book        | view only   | –           | can see Quiet's occupancy, cannot book there |
| **Bob** (admin Quiet+Lab) | book        | book+manage | view+manage | cannot _book_ in Lab (disabled), only manage |
| **Site admin**            | book+manage | book+manage | view+manage | super-user; still cannot book in Lab         |

Book-for on this plan:

- Bob books **for Carol** in **Quiet** → ✅ (Bob admins Quiet, Carol is a member).
- Bob books **for Eve** in **Quiet** → ✅ (Bob admins Quiet, Eve is a member —
  her _viewer_ role doesn't matter for book-for; if the seat happens to be
  assigned to someone else, Bob's book-for still overrides that).
- Bob books **for Dana** in **Open** → ❌ Bob is only a _user_ of Open, not its
  admin; he cannot book for anyone there (even though Dana herself could book).
- Bob auto-books **for Eve** → he may trigger it (he admins Quiet, a zone on
  the plan), and the seat pool is confined to **zones Bob administers**
  (Quiet, Lab) — never Open, even though Eve could book there herself. Lab is
  excluded too (disabled). So the seat is picked from Quiet only.
- Site admin books **for Dana** in **Open** → ✅ (super-user admins Open; Dana
  is a member there).
