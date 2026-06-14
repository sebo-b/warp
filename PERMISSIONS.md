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
  site admin). The assign / enable / disable / book-as tools appear.
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

## 8. Booking on behalf of others ("book as")

### Manual book-as (picking a specific seat for someone)

- **The actor must be a zone admin of the seat's zone** (site admins qualify
  everywhere). Being an admin of a _different_ zone on the same plan is not
  enough — e.g. an admin of the enabled zone cannot book-as into a public-book
  zone on the same plan unless they also administer that public-book zone.
- **The target must be allowed to book in that zone** — i.e. the _target's_
  effective role must be _user_ or better. You cannot park a booking on someone
  who has no business in the zone. (In a public-book zone that is everyone; in a
  public-view zone only users with an explicit grant; in an enabled zone only
  those granted _user_/_admin_.)
- **Disabled zones** still reject the booking outright.

### Auto-book ("find me a seat")

Auto-book is always a **regular-user action**: it picks a seat the **subject**
(the booking's owner) could have picked themselves — no super-user bypass, and no
confinement to the actor's own zones. The actor's role only gates _who may book
for whom_:

- **For yourself** — always allowed; the pool is the zones where _you_ have a
  regular booking grant (or that are public-bookable). The site-admin bypass is
  excluded here (§4), so auto-book never picks a zone you only oversee.
- **As another user** — only a **site admin** or a **zone admin of some zone on
  the plan** may trigger it. The seat is then chosen exactly as the **target**
  would get it (across the target's own accessible zones), so the target is never
  placed on a seat they couldn't book themselves, and the actor's zones do not
  constrain the choice. This is intentionally looser than manual book-as (which
  also requires the actor to administer the specific seat's zone) — safe, because
  the picked seat is by construction one the target could book on their own.

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

(For _book as_, run the booking-access checks against the **target** user and
additionally require the **actor** to administer S's zone — §8.)

---

## 10. Worked examples

A plan **"Office"** has three zones:

- **Open** — public (book)
- **Quiet** — enabled (private); _Bob_ is zone admin, _Carol_ is zone user
- **Lab** — disabled; _Bob_ is zone admin

| Person                    | Open        | Quiet       | Lab         | Notes                                        |
| ------------------------- | ----------- | ----------- | ----------- | -------------------------------------------- |
| **Dana** (no grants)      | book        | –           | –           | public-book gives everyone _user_ in Open    |
| **Carol** (user in Quiet) | book        | book        | –           | sees Lab? no — disabled & no admin grant     |
| **Bob** (admin Quiet+Lab) | book        | book+manage | view+manage | cannot _book_ in Lab (disabled), only manage |
| **Site admin**            | book+manage | book+manage | view+manage | super-user; still cannot book in Lab         |

Book-as on this plan:

- Bob books **as Carol** in **Quiet** → ✅ (Bob admins Quiet, Carol may book there).
- Bob books **as Dana** in **Open** → ❌ Bob is only a _user_ of Open, not its
  admin; he cannot book-as there (even though Dana herself could book).
- Bob auto-books **as Carol** → he may trigger it (he admins Quiet, a zone on the
  plan), and it then runs **as Carol**, so it may place her in **any zone Carol
  can book** (Quiet or the public Open) by the auto-book priority — never in Lab.
- Site admin books **as Dana** in **Open** → ✅ (super-user admins Open; Dana may
  book there).
