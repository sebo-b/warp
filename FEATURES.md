# WARP Functionality Guide

> **WARP** — Workspace Autonomous Reservation Program  
> A hybrid-office desk (and parking) reservation system.  
> This document describes everything a user, tester, or administrator can do in WARP.

The behaviour described here is covered by the end-to-end Playwright suite in
[`e2e/`](e2e/) (see [`e2e/README.md`](e2e/README.md) for how to run it).
Exceptions that cannot be exercised in a self-contained container: the external
authentication providers (LDAP §1.2, Azure AD §1.3, OIDC §1.5, SAML §1.4), multi-language
rendering (§20), and mobile layouts (§21).

---

## 1. Authentication & Login

Logins are matched case-insensitively by default (`LOGIN_IGNORECASE`): a name entered in any letter case resolves to the same stored account across every backend, so a case-insensitive directory (e.g. LDAP) cannot create duplicate accounts. The stored login keeps its original case.

### 1.1 Built-in Authentication (default)
- Users log in with a **login** and **password** on the login page.
- Wrong credentials display an error; no detail is given about which field is incorrect (prevents enumeration).
- A blocked account shows "Your account is blocked" instead of logging in.
- On first start, WARP creates a default admin account (`admin` / `noneshallpass`).
- Session lifetime is configurable (default: 1 day). After that, the user is forced to re-login.
- A user whose account is deleted or blocked between sessions is silently redirected to the login page.

### 1.2 LDAP / Active Directory Authentication
- When enabled, WARP authenticates users against an LDAP server instead of its own password database.
- Supports: plain LDAP, SSL (`ldaps://`), and StartTLS.
- Supports SIMPLE and NTLM authentication types.
- **Auto-provisioning**: a WARP user account is created automatically on first LDAP login.
- User name is synced from LDAP on each login.
- **Group mapping**: LDAP groups can be replicated to WARP groups (add/remove), or used purely as access control (allow/deny login).
- **Strict mapping** mode: removes users from WARP groups that don't match LDAP groups on each login.
- **Excluded users**: specific logins (e.g. local admin) can be excluded from LDAP auth, keeping their local password.
- A `[null, null]` entry in the group map allows any LDAP user to log in (open access).

### 1.3 Azure Active Directory (AAD) Authentication
- When enabled, users are redirected to Microsoft's OAuth2 login flow.
- Auto-provisioning and name sync work the same as LDAP.
- Supports the same group mapping / strict mapping model as LDAP.
- Configurable login and name claim attributes.

### 1.4 SAML 2.0 via Apache mod_auth_mellon (legacy)
- When enabled, login/logout is handled by an Apache reverse proxy with mod_auth_mellon.
- WARP reads the `MELLON_uid` and `MELLON_cn` environment variables set by Apache.
- Auto-provisioning on first SAML login.
- A default group can be assigned to all SAML users.
- Logging out redirects to the Mellon logout endpoint.
- Local WARP password is set to `*` (unusable) for SAML-created users.
- **Legacy**: use native SAML (§1.6) instead for new deployments.

### 1.5 OpenID Connect (OIDC) Authentication
- When enabled, users are redirected to any OIDC-compliant identity provider (Keycloak, Authentik, Okta, Auth0, Google, Entra ID generic mode, etc.).
- Configuration is discovery-driven: a single `OIDC_DISCOVERY_URL` loads all endpoints and signing keys from the IdP's `.well-known/openid-configuration`.
- **Auto-provisioning**: a WARP user account is created automatically on first OIDC login.
- User name is synced from the IdP on each login.
- **Group mapping**: IdP groups can be replicated to WARP groups (add/remove), or used purely as access control (allow/deny login). Same semantics as LDAP group mapping.
- **Strict mapping** mode: removes users from WARP groups that don't match IdP groups on each login.
- **Excluded users**: specific logins (e.g. local admin) can be excluded from OIDC auth, keeping their local password.
- A `[null, null]` entry in the group map allows any OIDC user to log in (open access).
- ID-token verification (signature via JWKS, nonce, issuer, audience, expiry) is handled by Authlib.
- Optional UserInfo endpoint call for IdPs that only expose groups in the UserInfo response.

### 1.6 Native SAML 2.0 Authentication
- When enabled, users are redirected to any SAML 2.0 identity provider (Keycloak, Authentik, Okta, Auth0, ADFS, Entra ID, Shibboleth, etc.).
- Configuration is metadata-URL driven: a single `SAML_IDP_METADATA_URL` loads the IdP entity ID, SSO URL, SLO URL, and signing certificate. Manual endpoint configuration is also supported.
- **No Apache required** — native Python Service Provider via `python3-saml`.
- **Auto-provisioning**: a WARP user account is created automatically on first SAML login.
- User name is synced from the IdP on each login.
- **Group mapping**: IdP groups can be replicated to WARP groups (add/remove), or used purely as access control (allow/deny login). Same semantics as LDAP group mapping.
- **Strict mapping** mode: removes users from WARP groups that don't match IdP groups on each login.
- **Excluded users**: specific logins (e.g. local admin) can be excluded from SAML auth, keeping their local password.
- A `[null, null]` entry in the group map allows any SAML user to log in (open access).
- **SP-initiated Single Logout (SLO)**: logging out of WARP also ends the IdP session.
- SP metadata endpoint at `/saml/metadata` for easy IdP registration.
- Configurable signed AuthnRequests and signed assertion requirements.
- Local WARP password is set to `*` (unusable) for SAML-created users.

### 1.7 SAML 2.0 via Apache mod_auth_mellon (legacy)
- When enabled, login/logout is handled by an Apache reverse proxy with mod_auth_mellon.
- WARP reads the `MELLON_uid` and `MELLON_cn` environment variables set by Apache.
- Auto-provisioning on first SAML login.
- A default group can be assigned to all SAML users.
- Logging out redirects to the Mellon logout endpoint.
- Local WARP password is set to `*` (unusable) for SAML-created users.
- **Legacy**: use [native SAML](#16-native-saml-20-authentication) instead for new deployments.

### 1.8 Changing Password
- Available from the user menu (only when built-in auth is active — not for SSO/LDAP/AAD/OIDC/SAML users).
- Requires the current password and a new password.
- Minimum password length is configurable (default: 6 characters).

---

## 2. User Roles & Permissions

WARP has two independent role layers: **account-level** roles and **zone-level** roles.

### 2.1 Account-Level Roles

| Role        | Value | Description                                                                                                                               |
|-------------|-------|-------------------------------------------------------------------------------------------------------------------------------------------|
| **Admin**   |    10 | Full system access: user/group/zone management and reports. Zone-level actions (e.g., "Book As", enabling/disabling seats) still require a Zone Admin assignment in that zone — which admins can grant themselves. |
| **User**    |    20 | Regular user. Can book seats in zones they are assigned to.                                                                               |
| **Blocked** |    90 | Cannot log in. Account exists but is disabled.                                                                                            |
| **Group**   |   100 | Virtual account representing a user group. Not a real person; cannot log in.                                                              |

### 2.2 Zone-Level Roles

Each user (or group) can be assigned a role **per zone**:

| Role           | Value | What they can do in the zone                                                                 |
|----------------|-------|---------------------------------------------------------------------------------------------|
| **Zone Admin** |    10 | Assign/unassign users to the zone and to seats, enable/disable seats, book on behalf of any zone user ("Book As"), see disabled seats. |
| **User**       |    20 | Book, update, and delete their own bookings.                                                |
| **Viewer**     |    30 | See the zone map, seats, and other people's bookings, but **cannot book**.                   |

### 2.3 Effective Zone Role (Zone Type + Assigned Role)

The zone type influences what role a user effectively has:

| Zone Type               | Assigned Admin | Assigned User/Viewer                          | No Assignment                                   |
|-------------------------|----------------|-----------------------------------------------|-------------------------------------------------|
| **Disabled** (10)       | Zone Admin     | **No access**                                 | **No access**                                   |
| **Enabled** (20)        | Zone Admin     | Assigned role applies                         | **No access**                                   |
| **Public — View** (30)  | Zone Admin     | Most permissive wins (User → User, Viewer → Viewer) | Viewer (can see but not book)              |
| **Public — Book** (40)  | Zone Admin     | Most permissive wins                          | User (can book without assignment)              |

- **"Most permissive wins"**: if a user is explicitly assigned as Viewer to a Public-Book zone, their effective role is **User** (the public type grants User, which is more permissive).
- Zone Admins can always access a zone regardless of its type.
- Disabled zones are completely invisible to non-admins.

### 2.4 Navigation Visibility

- **Non-admin users**: see "Bookings" plus only the **Plans** containing seats in zones they can access (plus public zones).
- **Admins** see an additional **settings (gear) icon** dropdown in the top bar that contains two groups:
  - **User management**: Users, Groups
  - **Plan management**: Zones, Plans
- The right-side admin nav ("Report") remains; the old flat Users/Groups/Zones links were folded into the grouped dropdown.

---

## 3. Zone Management (Admin Only)

### 3.1 Creating a Zone
- An admin creates a zone with a **name** and a **zone type**.
- New zones default to **Disabled** type if not specified.

### 3.2 Editing a Zone
- Change the zone name, zone type, or zone group at any time.
- The zone edit dialog is non-dismissible (cannot be closed by clicking outside the modal).
- Changing a zone type immediately affects who can access it (see §2.3).

### 3.3 Deleting a Zone
- Deletes the zone and its zone assignments.
- **If the zone has seats**, the delete button skips the simple confirmation and goes directly to a reassignment modal:
  - The modal displays the seat count and a warning about booking history being permanently deleted.
  - A Materialize `<select>` of other zones is offered; choosing one and pressing the reassign button moves seats (`UPDATE seat SET zid = <target>`) then deletes the zone.
  - A prominent red **"Delete seats"** button at the bottom deletes all seats (and their bookings via the cascade) and then deletes the zone. This button triggers a **second confirmation dialog** before proceeding.
  - The reassignment modal is non-dismissible (cannot be closed by clicking outside).
  - Cancel leaves the zone intact.
- **If the zone has no seats**, a simple confirmation dialog ("Are you sure?") is shown, and the zone is deleted upon confirmation.
- Deleting a zone that had seats also removes their booking history (the seats and bookings are gone).

### 3.4 Zone Groups
- A zone can optionally belong to a **zone group** (a free-text group name set by an admin).
- When a zone has no group (the default), the **per-zone constraint** applies: one seat per zone per time slot.
- When two or more zones share the same group name, the **per-group constraint** applies: a user may hold at most one seat across all zones in the group simultaneously.
- Example: put "Office Floor 1" in one group so users cannot hold both a desk and a second desk on the same floor. Leave parking in no group so a desk + a parking spot can be held simultaneously.
- The booking constraint is enforced at the database level (see §24.2).

### 3.5 Zone Type Details

| Type                  | Value | Behaviour                                                                                                       |
|-----------------------|-------|-----------------------------------------------------------------------------------------------------------------|
| **Disabled**          |    10 | Invisible to all non-admin users. Only zone admins can see and manage it.                                       |
| **Enabled**           |    20 | Only explicitly assigned users can see and use the zone.                                                        |
| **Public — View**     |    30 | Everyone can see the zone and its bookings. Only assigned users (with User role or better) can book. Unassigned visitors get Viewer role. |
| **Public — Book**     |    40 | Everyone can see and book in the zone. Assignment is not required. Unassigned visitors get User role.            |

> **Zone access counts on the /zones page.** The admin zones page shows per-zone admin/user/viewer counts from the `user_to_zone_roles` view. Because the view is the single source of truth (it includes synthetic rows for public zones), a public zone's counts reflect the **full eligible population** (every non-group user), not just explicit assignees — this is the intended meaning of "who can use this zone." Explicit-assignment (Enabled) zones still count only their assignees. The explicit-member list on a zone's assign page (`zones.members`) is unaffected and continues to show only explicit `zone_assign` entries.

---

## 4. Plan Map Editor (Admin Only)

Accessible via the map icon on the Plans management page.

### 4.1 Editor Modes (Tabs)
The editor is split into three tabs:

- **Transform** — shows the multi-seat marquee. Drag the dashed frame to move all seats,
  drag the corner/edge grips to resize, and drag the rotate grip to rotate. The currently
  selected seat is the **anchor/pivot** and stays locked during scale/rotate.
- **Add mode** — click anywhere on the map to add a new seat. A zone selector chooses which
  zone the new seat belongs to; the zone with the most seats on the plan is pre-selected
  the first time the tab is opened.
- **Map edit** — replace the map image, choose a dark-mode **filter preset** from
  `map_filter_presets.json`, or fine-tune the per-plan CSS filter with seven sliders:
  invert, grayscale, sepia, saturate, hue-rotate, brightness, contrast. The result is only
  visible in dark mode and is persisted in the `plan.dark_filter` JSONB column.

Seats can be dragged to a new position in every mode.

### 4.2 Uploading / Replacing the Map Image
- In **Map edit** mode, upload a JPEG or PNG image as the background for the plan.
- The image is stored as a binary blob in the database.

### 4.3 Adding Seats
- Switch to the **Add mode** tab.
- A **zone selector** dropdown appears — choose which zone new seats will belong to.
- If the plan already has seats, **the first time** the tab is opened, the zone that already contains the largest number of seats on this plan is pre-selected.
- If no zones exist at all, nothing is executed and a visible error is shown: "You must create a zone before adding seats."; the click on the map is ignored and a toast reiterates the requirement.
- Click anywhere on the map to place a new seat with the chosen `zid` (the plan backend no longer has a `default_zid` — every created seat must carry an explicit zone).
- Each seat has a **name**, **X**, **Y**, and **zone**.

### 4.4 Editing Seats
- Select a seat to edit its name, position (X/Y), or drag it to a new position.
- Multi-seat selection with a marquee: drag to select multiple seats, then move or transform them together.
- To move all selected seats, **grab the marquee border** (the dashed outline) and drag. Clicking inside the box interior does not initiate a move — but it does keep the selection (the marquee stays visible). The border has an enlarged grip area so it is easy to grab.
- The cursor changes to `move` only when hovering over the border, signalling where to grab.
- When a seat is selected or newly added, the **Seat name** field is focused automatically. A new seat's auto-generated placeholder name stays fully selected (so typing replaces it) until you actually edit the name — including across re-selections. Once the name has been edited, or for existing seats, the caret is placed at the end for normal editing.
- The selected group shows a transform box with **8 resize handles** (4 corners + 4 edges) and a **rotation handle**.
- Scaling and rotation pivot around the group's center — unless the currently selected seat is part of the group, in which case it stays **locked in place** and acts as the pivot.
- While rotating, the selection box and handles are hidden and replaced by a **rotation guide**: a marker on the pivot, a dashed line from the pivot to the cursor, and a live **angle readout** next to the cursor. Rotation is free (no angle snapping), so seats can be aligned to maps that are not axis-aligned.
- All transformed seats are clamped to the map boundaries (a group move stops at the edges).

### 4.5 Editor Seat Icon States
- **Unchanged** seats show the standard (blue) seat icon.
- **Modified** seats (name or position changed) show a distinct "changed" icon (blue seat in a green ring).
- **New** seats (not yet saved) show a green **"+"** icon.
- Seats **marked for deletion** show the gray "disabled" icon.
- The currently selected seat(s) are highlighted with a red outline.

### 4.6 Editor Seat Labels
- Every seat shows its **name** as an on-map label below the seat icon.
- Labels update live as the admin renames a seat in the side panel, including newly placed seats.
- When the plan spans **more than one zone** (based on non-deleted seats), each label also shows the zone name in a secondary line; this zone line disappears when the plan returns to a single zone.
- Deleted seats' labels are **greyed out** (solid grey card and title, matching the greyed seat icon — no transparency); they un-grey on restore.
- Labels are pointer-events:none so they never interfere with click, drag, or marquee hit-testing; the marquee selection box accounts for each label's full footprint so it never clips through them.

### 4.7 Deleting Seats
- Mark a seat for deletion; it can be restored before saving.
- Deletion is confirmed via a dialog showing what will be removed.
- The seat's zone can be changed via the dropdown in the side panel when the seat is selected (in the **Transform** or **Add mode** tabs).

### 4.8 Saving & Cancelling
- All changes (image, added/modified/deleted seats) are submitted together.
- A confirmation dialog lists the pending changes before applying.
- A **Cancel** button returns to the plans list; if there are unsaved changes, a confirmation dialog ("All unsaved changes will be lost.") is shown first.
- Unsaved changes trigger a browser warning if the user tries to leave the page.

---

## 5. Zone User Assignment (Admin Only)

Accessible via the user icon on the Zones management page.

### 5.1 Assigning Users or Groups to a Zone
- Add individual users or existing user groups to the zone with a chosen role (Zone Admin, User, or Viewer).
- Adding a group: all members of that group inherit the group's zone role (via the `user_to_zone_roles` materialized view).
- A user's effective role is the **most permissive** across all their direct assignments and group memberships. For public zones a synthetic baseline role (User for public-book, Viewer for public-view) is folded in via `MIN(zone_role)`, so a user with no explicit grant still gets the public baseline.

### 5.2 Changing a User's Zone Role
- Inline editing: click the role cell to change between Zone Admin, User, and Viewer.

### 5.3 Removing a User from a Zone
- Remove the user's zone assignment. They lose access (unless the zone is public).
- A confirmation dialog is shown.

---

## 6. Seat Assignment & Days-in-Advance

### 6.1 Seat Assignment (Zone Admin)
- A zone admin can assign a seat to specific users or to **"Everyone"**.
- Assigning to specific users means **only** those users can book that seat.
- Assigning to "Everyone" means any user in the zone can book it.
- A seat can have **both** specific user assignments and an "Everyone" assignment simultaneously. In that case, specific users always get access, and everyone else can book via the "Everyone" row.
- At most one "Everyone" assignment per seat.

### 6.2 Days-in-Advance Booking Window
- Each assignment row (specific user or Everyone) can optionally set a **days_in_advance** limit.
- This restricts how far into the future a user can book that seat.
- **NULL / Unlimited**: the user can book up to the system-wide booking window (`WEEKS_IN_ADVANCE`).
- **N days**: the user can book at most N days from today. E.g., `0` = same day only, `3` = up to 3 days from now.
- When a user has multiple matching assignment rows (e.g., a direct one and an Everyone row), the **most permissive** `days_in_advance` wins (NULL beats any number; the highest number beats lower ones).
- If a user tries to book past their window, they get a "Cannot book this seat that far in advance" error.
- When changing an assignment's `days_in_advance`, WARP reports any existing bookings that fall outside the new window (they must be removed manually).

### 6.3 Conflict Warnings on Assignment Changes
- When assigning a seat to specific users, WARP checks for existing bookings by **non-assignees**. A warning is returned listing those bookings (they are not automatically removed).
- When setting a days-in-advance limit, WARP checks for existing bookings that now exceed the new window. A warning lists them (not automatically removed).
- "Everyone" assignments suppress the non-assignee warning because everyone is allowed.

---

## 7. Booking Seats

### 7.1 The Plan View (Booking Map)
- A **plan** is the floor-map page you interact with to book (“the zone view” in everyday speech). Each plan owns an image + seats; seats are labelled with a **zone** for access control.
- A single plan may contain seats belonging to several different zones (mixed permissions on the same map).
- The plan view shows the plan's map image with seat icons overlaid.
- A **side panel** (collapsible on mobile) contains:
  - **Date checkboxes**: the next ~2 weeks of dates (configurable via `WEEKS_IN_ADVANCE`). Omitted weekdays (e.g., Sat/Sun) are hidden.
  - **Time slider**: a vertical dual-handle slider for selecting the start and end time. Configurable range (`BOOK_OPEN` / `BOOK_CLOSE`, default 00:00–24:00). Steps in 15-minute increments.
- Seat states update in real-time as the user changes the date/time selection.

### 7.2 Seat Visual States (Icon Colors)

| State                                   | Meaning                                                                                | Click Action                    |
|-----------------------------------------|----------------------------------------------------------------------------------------|---------------------------------|
| Green                                   | Seat is available for booking                                                          | Book                            |
| Green (with rebook indicator)           | Available, but you have a conflicting booking elsewhere — it will be auto-removed      | Book (replaces old booking)     |
| Yellow (assigned)                       | Seat is assigned to others, you cannot book (visible only to non-admins)               | —                               |
| Blue                                    | You already booked this seat exactly for the selected time                             | Remove                          |
| Blue (rebook)                           | You booked this seat, but for a different time range — can update                      | Update                          |
| Blue (conflict)                         | You booked this seat, but another user has a conflicting booking — cannot update, only remove | Remove                     |
| Red (taken)                             | Booked by someone else or unavailable                                                  | —                               |
| Gray (disabled)                         | Seat is disabled (visible only to zone admins)                                         | Enable/Disable                  |
| Gray circle / gray person (view-only)   | Seat is in a view-only or disabled zone you cannot book in (free vs. taken)            | —                               |
| No icon                                 | No date/time selected                                                                  | —                               |

### 7.3 Booking a Seat
1. Select one or more dates and a time range.
2. Click an available (green) seat.
3. The action modal opens, showing the dates/times to be booked.
4. Click **Book**. The booking is created.
5. If you already have a booking in the **same zone (or zone group)** at the same time, it is **automatically removed** and replaced with the new one. The modal shows the bookings that will be removed. Bookings in unrelated zones or groups are not affected.

### 7.4 Updating a Booking
1. Select a date/time that partially overlaps an existing booking of yours.
2. Click your booked seat.
3. Click **Update**. The old booking is removed and a new one is created for the selected time.

### 7.5 Deleting a Booking
1. Click your booked seat.
2. Click **Remove** to delete it.
- Users can always remove **their own** bookings, even from zones they are no longer assigned to. This allows cleanup of leftover bookings after reassignment.

### 7.6 Booking Constraints (enforced by database trigger)
- A user **cannot have two overlapping bookings** across zones that share a **zone group** (or, for an ungrouped zone, within that single zone). This is the per-zone/per-group exclusivity rule.
- A seat **cannot be double-booked** at the same time.
- The booking time range must be valid (from < to).
- These constraints are enforced at the database level via the `book_overlap_insert` trigger (keyed by seat.zid and zone_group membership).


### 7.7 Shift-Select for Dates
- Holding **Shift** while clicking a date checkbox selects/deselects all dates between the last clicked date and the current one.

### 7.8 Session Persistence of Date/Time Selection
- The selected dates and time slider position are stored in `sessionStorage` and restored on page reload.

---

## 8. Auto-Book ("Find Me a Seat")

### 8.1 The Floating "+" Button
- A floating action button appears in the bottom-right corner of the plan view (the interactive floor-map page).
- Disabled when no dates are selected or when the exact booking already exists.
- Clicking it triggers the auto-book algorithm.

### 8.2 Auto-Book Algorithm
- For each selected date, the system tries to find an available seat:
  1. **Priority tiers**: seats directly assigned to the user are preferred; then "Everyone"/unassigned seats.
  2. **Within each tier**, seats are ranked by the user's past booking frequency (prefer seats you book often), then by overall popularity (prefer less popular seats as a tiebreaker), then by seat ID.
  3. The algorithm respects the **days-in-advance** window per seat.
  4. Existing bookings by the user in the same zone group that overlap the requested times are **automatically replaced** (removed and rebooked on the new seat).
  5. If the user already has an **exact** booking in another zone of the same group, it is reported as "Already booked elsewhere" without changes.
  6. If the user has overlapping bookings that cannot be extended/rebooked, those dates are reported as "Could not extend or rebook".
Auto-book runs **one day at a time**, scoped to the **current plan**. For each requested day it walks this priority (best first) and takes the first seat that can cover the whole day's slots:

1. **The seat you already hold that day** (extend or shrink your existing booking on it).
2. **A seat assigned/reserved to you** — ordered by descending `days_in_advance` (unlimited first), then by your own cumulative booked time on it, then spread. A reserved seat is not eligible until its window has opened.
3. **Your most-used seat** (among the remaining shared/everyone seats) — ranked by your own total booked *time* (cumulative seconds, not number of bookings) over the look-back window.
4. **Another seat in that seat's zone** — the fallback when your usual seat is taken.
5. **A seat in the biggest zone** on the plan (the "main area" fallback when you have no usage history or the prior zone was full).
6. **Any remaining free seat**, picked at random (to spread people).

- Existing bookings by *you* in the **same zone or zone group** as the chosen seat are automatically removed (so the new booking can be created without a conflict).
- Bookings in unrelated zones/groups are untouched.
- Assignments (`direct` or `everyone`) still gate eligibility: you can only be auto-booked onto a seat whose assignment includes you and whose days-in-advance window covers the date.
- The algorithm never uses the site-admin super-user bypass for seat *selection* when booking for yourself; the pool is exactly the seats/ zones the subject could have booked manually.

Full details (with the exact decision tree, `dia` handling, exclusivity keys, future_options, etc.) live in [AUTOBOOK.md](AUTOBOOK.md).

### 8.3 Auto-Book Results
The backend result buckets are:

- `booked` — successfully booked (or already exactly matched).
- `not_extended` — you already had a booking that day but it could not be adjusted (a conflict prevented extending/rebooking).
- `unbookable` — no seat could be found for the day; each carries optional `future_options` hints for when a reserved seat you are eligible for will open up.

The UI modal surfaces this as sections titled "Booked", "Could not extend or rebook", and "No seat available" (the last one shows the future-availability messages when present).

The old "Already booked in another zone" section is gone; an existing booking on the same plan for the same slots takes top priority at step 1 instead.

### 8.4 Auto-Book for Zone Admins
- Zone admins can use the "Book As" feature with auto-book to find a seat for another user (see §9).
- When doing so via auto-book, the seat is chosen exactly as it would have been for the target user themselves (the actor's own zones do not restrict the choice). Manual "book as" is still scoped to the specific seat's zone adminship.

---

## 9. "Book As" (Zone Admin Feature)

- A "Book As" input field appears in the plan-view side panel (the booking map) for zone admins.
- It is an autocomplete field listing all users with access to the zones on that plan (resolved through the `user_to_zone_roles` view — the single source of truth). For a public zone that is every non-group user, including blocked users (an admin can manage and book on behalf of blocked users); for an enabled zone it is the explicitly assigned users.
- Selecting a user switches the entire plan view to show what that user sees, including their bookings and conflicting bookings across the plan.
- When the admin books, updates, or removes a booking, it is performed **on behalf of the selected user**.
- The admin can also auto-book for the selected user.
- Clearing the "Book As" field (pressing Enter while empty) reverts to the admin's own view.

---

## 10. Seat Preview & Tooltips

### 10.1 Hover Tooltip
- Hovering over a seat shows a preview popup with:
  - **Assigned users**: list of assigned users with their days-in-advance limit (e.g., "John (3d)").
  - **"Everyone" assignment**: shows whether everyone can book and the days-in-advance limit.
  - **Current bookings**: up to 8 booking entries showing the date, time, and username.

### 10.2 Seat Name Labels (User Preference)
- Users can toggle **"Show seat names on the map"** to display permanent labels with seat names below each seat icon.
- Labels show the seat name and (when enabled) booking preview only; zone info is never displayed on booking-pane labels, even in mixed-zone plans.

### 10.3 Booking Preview Labels (User Preference)
- Users can toggle **"Show booking preview on the map"** to show who is booked on each seat for the currently selected date/time.
- Labels update in real-time when the date/time selection changes.
- When both seat names and booking preview are on, labels show both.

### 10.4 Assigned-Names Labels (User Preference)
- Users can toggle **"Show assigned names on zone map"** to display the names of users a seat is exclusively assigned to (permanent personal-desk assignments with `days_in_advance IS NULL`).
- Only real-user assignments with no `days_in_advance` limit (unlimited) are shown. Limited-window assignments and everyone-only assignments are excluded.
- A seat assigned to multiple real users (all unlimited) shows all of their names.
- **Booking-wins precedence**: when both booking preview and assigned-names are enabled, if a seat has any booking overlapping the currently selected date/time, only the booking preview is shown (the assigned name is suppressed for that seat).
- Assigned-name labels are date-independent (they reflect the static seat assignment, not the selected date), and are only suppressed by overlapping bookings when booking preview is also on.
- Cross-reference: §14.4.

---

## 11. Bookings List & Report

### 11.1 Bookings List (available to all users)
- Shows **future** bookings in zones the user is assigned to.
- Columns: User name, Plan, Seat, Time (merged from/to into one column).
- A **delete button** (🗑) appears for bookings the user can remove (own bookings where they have User role, or any booking where they have Zone Admin role).
- Filtering by user name, plan, seat, and date range.
- Sorting by time and user name.
- Paginated with remote data loading.

### 11.2 Report (Admin Only)
- Shows **all** bookings (past and future) across all zones.
- Additional column: **Login**.
- Separate **From** and **To** date columns with date-picker filters.
- Defaults: last 2 weeks of data, sorted by To (descending), then From (descending), then Login.
- **Export to Excel** (`.xlsx`): generates an Excel file with timestamps formatted as dates. Limited to `MAX_REPORT_ROWS` (default: 5000) rows. A warning is shown if the selection exceeds the limit.

---

## 12. User Management (Admin Only)

### 12.1 User List
- Paginated table with columns: Login, User name, Account type.
- Filter by login, name, or account type.
- Groups (account_type ≥ 100) are excluded from the default filter.

### 12.2 Adding a User
- Required fields: Login, Name, Password.
- Account type: Admin, User, or Blocked (default: User).
- Password: type manually or use the **Generate** button (creates a random 10-character password with mixed characters).
- Show/hide password toggle.
- **Add to group**: a chip-input field with autocomplete. The new user is immediately added to the selected groups.

### 12.3 Editing a User
- Login is read-only (cannot be changed after creation).
- Name, account type, and password can be updated.
- Password is optional on update (leave blank to keep the current one).
- Group memberships can be changed.

### 12.4 Deleting a User
- A confirmation dialog warns that past booking history will be lost.
- If the user has past bookings, a second warning is shown with the count. The admin can choose **force delete** to proceed anyway.
- **Blocking** is recommended as a less destructive alternative (preserves booking history).
- You cannot delete your own account from the user management UI.

### 12.5 Groups
- Groups are virtual "user" accounts with `account_type = 100`.
- They appear in the **Groups** management page (separate from regular users).
- A group has a **Group ID** (login) and **Group Name** (display name).
- Groups can be created, edited, and deleted the same way as users (but without a password).

---

## 13. Group Management (Admin Only)

### 13.1 Group List
- Shows only group-type accounts (account_type ≥ 100).
- Columns: Group ID, Group Name.
- Two action icons per group:
  - 👤 **Manage members**: navigates to the Group Assignment page.
  - ✏️ **Edit**: opens the group edit dialog.

### 13.2 Group Assignment Page
- Shows all members of a group (users and nested groups).
- **Add members**: autocomplete input to find users/groups and add them to the group.
- **Remove members**: each member has a remove icon.
- Members are displayed with their name and a user/group icon.
- Nested groups are supported: if group A is a member of group B, all of A's members transitively inherit B's zone roles.

### 13.3 Group Inheritance
- The `user_to_zone_roles` materialized view is the **single source of truth** for zone access: a row exists iff the user has effective access to the zone, and `zone_role` is the effective (minimum) role.
- It expands group memberships recursively and unions synthetic rows for public zones (public-book → User, public-view → Viewer) for every user with `account_type < 100` (including blocked users). A user with an explicit grant on a public zone keeps the more permissive role (`MIN`). DISABLED zones keep ADMIN rows only.
- Changes to zone assignments, groups, zone type, and user creation/deletion automatically refresh the materialized view. (No `users` UPDATE trigger is needed: the app prevents user↔group conversion, and blocked users are included in the view, so an `account_type` change within `< 100` produces the same synthetic rows.)

---

## 14. User Preferences

> A user's preferred "default plan" (user profile preference) determines which plan opens after login.

Accessible from the user menu (dropdown in the top-right corner).

### 14.1 Default Plan
- Choose which plan opens by default after login.
- If the default plan is no longer accessible, WARP falls back to the landing page.

### 14.2 Default Day
- Controls which day is pre-selected when opening a plan:
  - **Today**: always start on today.
  - **Tomorrow**: always start on tomorrow.
  - **Today if before start time, otherwise tomorrow**: smart boundary (e.g., if it's already 10:00 AM and your start time is 9:00 AM, it jumps to tomorrow).

### 14.3 Default Time
- A dual-handle slider setting the default booking time range (e.g., 09:00–17:00).
- This range is used when opening a plan view and for iCal one-click booking.

### 14.4 Zone Display Preferences
- **Show seat names on zone map**: toggle permanent seat name labels.
- **Show booking preview on zone map**: toggle labels showing who is booked on each seat for the selected time.
- **Show assigned names on zone map**: toggle labels showing the names of users exclusively assigned to each seat (unlimited assignments only). When booking preview is also on, seats with overlapping bookings show the booking instead.

---

## 15. Calendar Integration (iCal Feed)

Accessible from the user menu → "Calendar integration".

### 15.1 Enabling the Calendar Feed
- Toggle "Calendar integration" on. A unique, secure token is generated automatically.
- The **subscription URL** is shown (masked by default). Click the 👁 eye icon to reveal it, or the 📋 copy icon to copy it.

### 15.2 Regenerating the Token
- Click the 🔄 regenerate icon to create a new token. This **invalidates** the old URL — the user must update their calendar subscription.
- A confirmation dialog warns about this before proceeding.

### 15.3 Subscribing in a Calendar App
- Paste the URL into Google Calendar, Outlook, Apple Calendar, or any app that supports iCal/webcal subscriptions.
- The feed includes all **current and future** bookings (with a 7-day lookback for recently ended bookings).
- Each booking event contains a **one-click release link** in the URL and description fields.
- An extra `type` URL parameter can be appended to filter the feed contents:
  - `?type=bookings` — only real bookings (no reminders).
  - `?type=reminders` — only reminder events (no bookings).
  - (no flag or `?type=all`) — both bookings and reminders (the historical default).

### 15.4 Releasing a Seat via Calendar Link
- Click the link in the calendar event → opens a WARP page asking **"Release seat?"** with Confirm/Cancel buttons.
- If confirmed, the booking is removed and a "Seat released" message is shown.
- Past bookings cannot be released via the link (shows "Reservation in the past").
- HMAC tokens ensure the link is authentic and cannot be forged.

### 15.5 Booking a Seat via Calendar Link (Missing Booking Reminder)
- When the missing booking reminder triggers, the event contains a one-click **book** link.
- Clicking it attempts auto-book for the zone and day using the user's default time preferences.
- If a booking already exists in the same zone, it reports "Seat already booked" with details.
- If auto-book succeeds, it reports "Seat booked" with zone/seat/time details.
- If no seat is available, it reports "Not possible to book".
- Past dates cannot be booked via the link.

---

## 16. Calendar Reminders

### 16.1 Missing Booking Reminder
- **Purpose**: reminds you to book a desk for days when you don't have one yet.
- **Configuration**: choose how many days ahead to remind (1–7 days, or "Don't remind").
- **Behaviour**: if you have no booking in a monitored zone on a given day, a reminder event appears in your calendar N days before that day at the configured reminder time.
- The reminder event includes a one-click auto-book link (see §15.5).

### 16.2 Seat Release Reminder
- **Purpose**: reminds you before an assigned seat becomes available for general booking (so you can book it before others).
- **Prerequisite**: you must have a direct seat assignment AND an "Everyone" row on that seat with a days_in_advance value. The release reminder fires when the "Everyone" window opens.
- **Configuration**: choose how many days before the release to remind (1–7 days, or "Don't remind").

### 16.3 Shared Reminder Settings
- **Active weekdays**: a chip selector for which days of the week you want reminders (e.g., Mon–Fri only).
- **Reminder time**: what time of day the reminder event appears (default: 22:00).
- **Zones to monitor**: select which zones to check for missing/release bookings. Only zones you have access to can be selected.
- If a missing reminder and a release reminder fall on the same time for the same zone, the release reminder **takes priority** (it's more specific).

### 16.4 Calendar Feed Caching
- The iCal feed is cached per user per calendar day (stored in an unlogged table).
- The cache is invalidated automatically whenever a booking is created, updated, or deleted, or when calendar preferences change.

---

## 17. iCal Action Pages

When a user clicks a link from their calendar, they are taken to a simple WARP page (no login required — the link contains an HMAC token for authentication):

### 17.1 Book Action Page
- Shows the result of the auto-book attempt:
  - "Seat Booked" — success, with zone/seat/time details.
  - "Seat Already Booked" — existing booking found, no change.
  - "Not possible to book" — no available seat.
  - "Requested date is in the past" — the date has already passed.
  - "Forbidden" — user no longer has access to the zone.

### 17.2 Delete Action Page (Two-Step)
1. First click: shows **"Release seat?"** with the seat name, Confirm and Cancel buttons.
2. On confirm: shows **"Seat released"** with the seat name.
3. On cancel: shows **"Action cancelled"**.

All text on these pages is translated according to the deployment-wide language setting.

---

## 18. Zone Map Help

- A **help icon** (❓) is shown on the zone map.
- Clicking it opens a modal with a legend showing all seat icon states and their meanings (see §7.2).
- Zone admins see additional legend entries for disabled and assigned-only icons.

---

## 19. Landing Page & Default Plan Redirect

- After login, WARP checks if the user has a **default plan** preference set.
- If the default plan is accessible, the user is redirected directly to that plan's map.
- If not (no preference, or plan no longer accessible), the user sees the landing page with the WARP logo.
- The user can navigate to any accessible plan from the navigation bar.

---

## 20. Multi-Language Support

- WARP supports **English, German, French, Spanish, and Polish**.
- The language is configured globally per instance via `LANGUAGE_FILE` (e.g., `i18n/de.js`).
- All UI strings (buttons, labels, error messages, modal text) are translated.
- The iCal feed uses the same language for event summaries and action page text.
- Date pickers adapt to the locale (first day of week, month names, etc.).

---

## 21. Mobile Responsiveness

- The plan-view side panel (date/time selection) collapses into a **sidenav** on mobile.
- A trigger button (schedule icon) appears on the plan map to open the side panel.
- The navigation bar collapses into a hamburger menu.
- The user menu is available from the mobile sidenav.
- Seat icons and the plan map scale to the viewport.

---

## 22. Light / Dark Theme

WARP ships a light and a dark theme. A toggle in the top navigation bar (left of the user/admin
menus) switches between them, showing a **moon** icon in light mode and a **sun** icon in dark mode.

- The choice is stored in a long-lived `warp_theme` cookie (it survives closing the tab; it is
  **not** part of the user-preferences database). The server reads the cookie and renders the
  `<html theme>` attribute on first paint, so there is no flash of the wrong theme on load.
- Colours come entirely from `warp/static/theme.css`: a `:root[theme="dark"]` block re-points the
  neutral surface / background / text roles, and the brand tints re-mix against the dark surface
  automatically. Materialize's own Material 3 tokens are mapped onto the same warp tokens, so the
  whole UI (page, nav, cards, modals, dropdowns, tables) shares one coherent two-tier palette.
- **Plan map images** can be hard to read on a dark page, so each plan stores its own dark-mode
  CSS filter (see §4.1, *Map edit*). The filter is applied to the map image only in dark mode, on
  both the editor and the public booking view.

---

## 23. Booking Window Configuration

### 23.1 System-Wide Booking Window
- `WEEKS_IN_ADVANCE`: how many weeks after the current week users can book (default: 1). The visible date range in the plan view is from today to the end of (current week + WEEKS_IN_ADVANCE) weeks.
- `BOOK_OPEN` / `BOOK_CLOSE`: earliest and latest bookable time of day, in seconds from midnight (default: 0 / 86400 = full day).

### 23.2 Omitted Weekdays
- `OMITTED_WEEKDAYS`: list of weekday numbers (0=Mon, 6=Sun) to hide from the date selector. Default: none. Set to `[5, 6]` to hide weekends.

### 23.3 Per-Seat Days-in-Advance
- See §6.2 for the seat-level booking window restriction.

---

## 24. Security & Data Integrity

### 24.1 Session Security
- `SECRET_KEY` is required for signing session cookies (must be set in production).
- Session lifetime is configurable (default: 1 day). Expired sessions force re-login.

### 24.2 Database-Level Constraints
- **No double-booking**: a PostgreSQL trigger enforces that a seat cannot be booked by two users at the same time. Additionally, if a zone belongs to a zone group, a user cannot hold two overlapping bookings in any zones of that group simultaneously; for ungrouped zones, the constraint is one seat per zone.
- **Referential integrity**: cascading deletes ensure that deleting a user, zone, or seat cleans up all related records.

### 24.3 iCal Token Security
- Each user's iCal feed URL contains a unique token (UUID).
- Action links in the feed use HMAC-SHA256 signatures, preventing forgery. There are three link types, each with its own token:
  - **Book token**: authorises one auto-book action (signs zone, date, and a per-link nonce).
  - **Release token**: authorises showing the release confirmation for one booking (signs booking ID and nonce).
  - **Confirm-release token**: a separate token issued on the confirmation page, authorising the actual deletion.
- All tokens are keyed with the user's feed token, so regenerating the feed token (see §15.2) invalidates every outstanding link.

### 24.4 Input Validation
- All API endpoints validate input against JSON schemas before processing.
- File uploads are validated by magic bytes (not just extension) for JPEG/PNG.
- File size limits: 5 MB for general requests, 2 MB for map images.

### 24.5 Reserved Identifiers
- The login `__everyone__:550e8400-...` is reserved for the virtual "Everyone" user and cannot be used as a real login.

---

## 25. Debug Features (Development Only)

- When running in debug mode (`FLASK_DEBUG=1`), two debug endpoints are available:
  - `GET /debug/time`: returns the current virtual time and offset.
  - `POST /debug/set_time_offset`: shifts the server's virtual clock by N seconds (pass 0 to reset). Used for e2e testing to simulate future dates.
- These endpoints are **never** available in production.

---

## 26. Quick Reference: Who Can Do What

| Action                                | Regular User | Zone Viewer | Zone Admin | System Admin |
|---------------------------------------|:---:|:---:|:---:|:---:|
| View accessible zones                 | ✅  | ✅  | ✅  | ✅  |
| Book a seat                           | ✅  | ❌  | ✅  | ✅¹ |
| Remove own booking                    | ✅  | ✅² | ✅  | ✅¹ |
| Remove someone else's booking         | ❌  | ❌  | ✅  | ✅¹ |
| Book on behalf of another user        | ❌  | ❌  | ✅  | ✅¹ |
| Use auto-book                         | ✅  | ❌  | ✅  | ✅¹ |
| Enable/disable seats                  | ❌  | ❌  | ✅  | ✅¹ |
| Assign/unassign users to seats        | ❌  | ❌  | ✅  | ✅¹ |
| Set days-in-advance per assignment    | ❌  | ❌  | ✅  | ✅¹ |
| Assign/unassign users to zones        | ❌  | ❌  | ❌  | ✅  |
| Create/edit/delete zones              | ❌  | ❌  | ❌  | ✅  |
| Create/edit/delete plans              | ❌  | ❌  | ❌  | ✅  |
| Upload/replace plan map               | ❌  | ❌  | ❌  | ✅  |
| Create/edit/delete users              | ❌  | ❌  | ❌  | ✅  |
| Create/edit/delete groups             | ❌  | ❌  | ❌  | ✅  |
| Access booking report                 | ❌  | ❌  | ❌  | ✅  |
| Export bookings to Excel              | ❌  | ❌  | ❌  | ✅  |
| See disabled seats                    | ❌  | ❌  | ✅  | ✅¹ |
| Change own password                   | ✅³ | ✅³ | ✅³ | ✅³ |

¹ System Admins do not automatically hold zone-level rights. Zone-level actions require the corresponding zone role (User or Zone Admin) in that zone — which a System Admin can always grant themselves via zone user assignment.  
² Viewers can remove their own bookings (even from zones they are only a viewer in), to clean up leftover bookings after role changes.  
³ Only available with built-in authentication (not SSO).

---

## 27. Plan View Interaction Summary

| Seat State            | No Dates | Green (Book)          | Green (Rebook)      | Blue (Update) | Blue (Conflict) | Blue (Exact) | Red (Taken) | Yellow (Assigned)           | Gray (Disabled)             |
|-----------------------|----------|-----------------------|----------------------|---------------|-----------------|--------------|-------------|-----------------------------|-----------------------------|
| **User actions**      | —        | Book                  | Book (replaces)      | Update        | Remove          | Remove       | —           | —                           | —                           |
| **Zone Admin actions**| —        | + Book As, + Assign, + Enable/Disable | same | same          | same            | same         | + Assign    | + Assign, + Enable/Disable  | + Enable                    |
| **Viewer actions**    | —        | —                     | —                    | —             | —               | —            | —           | —                           | —                           |

---

## 28. Configuration Reference

| Setting                      | Default        | Description                                          |
|------------------------------|----------------|------------------------------------------------------|
| `WEEKS_IN_ADVANCE`           | 1              | Weeks after the current week available for booking   |
| `AUTOBOOK_USAGE_WINDOW_DAYS` | 30             | Days window for auto-book seat ranking               |
| `BOOK_OPEN`                  | 0 (00:00)      | Earliest bookable time (seconds from midnight)       |
| `BOOK_CLOSE`                 | 86400 (24:00)  | Latest bookable time (seconds from midnight)         |
| `OMITTED_WEEKDAYS`           | `[]`           | Weekdays to hide (0=Mon … 6=Sun)                     |
| `SESSION_LIFETIME`           | 1 (day)        | Force re-login after this many days                  |
| `MAX_REPORT_ROWS`            | 5000           | Maximum rows in Excel export                         |
| `MIN_PASSWORD_LENGTH`        | 6              | Minimum password length                              |
| `LOGIN_IGNORECASE`           | true           | Match logins case-insensitively across all backends  |
| `MAX_MAP_SIZE`               | 2 MB           | Maximum zone map image size                          |
| `MAX_CONTENT_LENGTH`         | 5 MB           | Maximum request body size                            |
| `TIMEZONE`                   | auto-detect    | Timezone label for iCal DTSTART/DTEND                |
| `LANGUAGE_FILE`              | `i18n/en.js`   | UI language file                                     |
| `SECRET_KEY`                 | — (required)   | Key for signing session cookies                      |
| `DATABASE_ADDRESS`          | — (required)   | Database host or `host:port` (port defaults to 5432) |
| `DATABASE_NAME`             | — (required)   | Database name                                         |
| `DATABASE_USER`             | — (required)   | Database username                                     |
| `DATABASE_PASSWORD`         | — (required)   | Database password                                     |
| `DATABASE_ARGS`              | `{}`           | Extra arguments passed to the database driver        |

Any setting can be provided as an environment variable with the `WARP_` prefix (e.g. `WARP_SECRET_KEY`, `WARP_WEEKS_IN_ADVANCE`); each value is parsed according to the type of the setting it maps to (string, integer, boolean, or JSON array/object). An unknown `WARP_` variable is ignored with a warning, and a value that does not match its setting's type aborts startup.

### 28.1 LDAP Settings (§1.2)

| Setting                              | Default                            | Description                                          |
|--------------------------------------|------------------------------------|------------------------------------------------------|
| `AUTH_LDAP`                          | unset                              | Set to `true` to enable LDAP authentication          |
| `LDAP_SERVER_URL`                    | —                                  | `ldap://` or `ldaps://` server URL                   |
| `LDAP_AUTH_TYPE`                     | `SIMPLE`                           | `SIMPLE` or `NTLM`                                   |
| `LDAP_STARTTLS`                      | `true`                             | Upgrade plain `ldap://` connections via StartTLS     |
| `LDAP_VALIDATE_CERT`                 | `false`                            | Validate the server TLS certificate                  |
| `LDAP_TLS_VERSION` / `LDAP_TLS_CIPHERS` | unset                           | Optional TLS protocol version and cipher list        |
| `LDAP_USER_TEMPLATE`                 | —                                  | Bind DN template, e.g. `uid={login},ou=users,…`      |
| `LDAP_USER_SEARCH_BASE`              | unset                              | Search base for user lookup (falls back to template) |
| `LDAP_USER_NAME_ATTRIBUTE`           | `cn`                               | Attribute(s) used as the display name; a JSON array joins several |
| `LDAP_USER_SEARCH_FILTER_TEMPLATE`   | `(objectClass=person)`             | Filter for the user lookup                           |
| `LDAP_GROUP_SEARCH_BASE`             | unset                              | Search base for group membership checks              |
| `LDAP_GROUP_SEARCH_FILTER_TEMPLATE`  | `(&(memberUid={login})(cn={group}))` | Filter for group membership checks                 |
| `LDAP_GROUP_MAP`                     | `[[null, null]]`                   | LDAP-group → WARP-group map; `[null, null]` = allow all |
| `LDAP_GROUP_STRICT_MAPPING`          | `false`                            | Remove unmatched WARP group memberships on login     |
| `LDAP_EXCLUDED_USERS`                | `[]`                               | Logins that keep local-password auth                 |

### 28.2 Azure AD Settings (§1.3)

| Setting                    | Default              | Description                                  |
|----------------------------|----------------------|----------------------------------------------|
| `AUTH_AAD`                 | unset                | Set to `true` to enable AAD authentication   |
| `AAD_TENANT`               | —                    | Azure AD tenant ID                           |
| `AAD_CLIENT_ID`            | —                    | OAuth2 application (client) ID               |
| `AAD_CLIENT_SECRET`        | —                    | OAuth2 client secret                         |
| `AAD_HTTPS_SCHEME`         | `https`              | Scheme used for the redirect URI             |
| `AAD_LOGIN_ATTRIBUTE`      | `preferred_username` | Claim used as the WARP login                 |
| `AAD_USER_NAME_ATTRIBUTE`  | `name`               | Claim(s) used as the display name; a JSON array joins several |
| `AAD_GROUP_MAP`            | `[[null, null]]`     | Same semantics as `LDAP_GROUP_MAP`           |
| `AAD_GROUP_STRICT_MAPPING` | `false`              | Same semantics as `LDAP_GROUP_STRICT_MAPPING`|

### 28.3 SAML / Mellon Settings (§1.7)

| Setting                | Default | Description                                            |
|------------------------|---------|--------------------------------------------------------|
| `AUTH_MELLON`          | unset   | Set to `true` to enable Mellon (legacy SAML) auth      |
| `MELLON_ENDPOINT`      | —       | Mellon endpoint path on the Apache proxy, e.g. `/sp`   |
| `MELLON_DEFAULT_GROUP` | unset   | WARP group assigned to all SAML-provisioned users      |

### 28.4 OIDC Settings (§1.5)

| Setting                    | Default              | Description                                  |
|----------------------------|----------------------|----------------------------------------------|
| `AUTH_OIDC`                | unset                | Set to `true` to enable OIDC authentication  |
| `OIDC_DISCOVERY_URL`       | —                    | Full `.well-known/openid-configuration` URL  |
| `OIDC_CLIENT_ID`           | —                    | OAuth2 client ID registered at the IdP       |
| `OIDC_CLIENT_SECRET`       | —                    | OAuth2 client secret (supports `_FILE`)      |
| `OIDC_SCOPES`              | `openid profile email` | Space-separated scopes requested           |
| `OIDC_LOGIN_ATTRIBUTE`     | `preferred_username` | Claim used as the WARP login                 |
| `OIDC_USER_NAME_ATTRIBUTE` | `name`               | Claim used as the display name               |
| `OIDC_GROUPS_CLAIM`        | `groups`             | Claim holding the user's group list          |
| `OIDC_GROUP_MAP`           | `[[null, null]]`     | Same semantics as `LDAP_GROUP_MAP`           |
| `OIDC_GROUP_STRICT_MAPPING`| `false`              | Same semantics as `LDAP_GROUP_STRICT_MAPPING`|
| `OIDC_EXCLUDED_USERS`      | `[]`                 | Logins kept on local password auth           |
| `OIDC_HTTPS_SCHEME`        | `https`              | Scheme used for the redirect URI             |
| `OIDC_USERINFO`            | `false`              | Also call the UserInfo endpoint and merge claims |

### 28.5 Native SAML Settings (§1.6)

| Setting                      | Default              | Description                                  |
|------------------------------|----------------------|----------------------------------------------|
| `AUTH_SAML`                  | unset                | Set to `true` to enable native SAML auth     |
| `SAML_ENDPOINT_PATH`         | `/saml`              | Base path for SP endpoints (Mellon `MellonEndpointPath`) |
| `SAML_SP_ENTITY_ID`          | —                    | SP entity ID (issuer)                        |
| `SAML_IDP_METADATA_URL`      | unset                | IdP metadata URL (auto-discovery)             |
| `SAML_IDP_METADATA_FILE`     | unset                | Local IdP metadata XML file (→ `SAML_IDP_METADATA`) |
| `SAML_IDP_ENTITY_ID`         | unset                | Manual IdP entity ID                          |
| `SAML_IDP_SSO_URL`           | unset                | Manual IdP SSO URL                            |
| `SAML_IDP_SLO_URL`           | unset                | Manual IdP SLO URL                            |
| `SAML_IDP_X509_CERT`         | unset                | IdP signing cert (supports `_FILE`)            |
| `SAML_SP_X509_CERT`          | unset                | SP certificate (supports `_FILE`)              |
| `SAML_SP_PRIVATE_KEY`        | unset                | SP private key (supports `_FILE`)              |
| `SAML_NAMEID_FORMAT`        | `urn:oasis:…:unspecified` | Requested NameID format               |
| `SAML_LOGIN_ATTRIBUTE`       | `""` (use NameID)   | Attribute used as the WARP login              |
| `SAML_USER_NAME_ATTRIBUTE`   | `cn`                 | Attribute used as the display name            |
| `SAML_GROUPS_ATTRIBUTE`      | `groups`             | Attribute holding the user's group list       |
| `SAML_GROUP_MAP`             | `[[null, null]]`     | Same semantics as `LDAP_GROUP_MAP`             |
| `SAML_GROUP_STRICT_MAPPING`   | `false`              | Same semantics as `LDAP_GROUP_STRICT_MAPPING`|
| `SAML_EXCLUDED_USERS`        | `[]`                 | Logins kept on local password auth             |
| `SAML_HTTPS_SCHEME`          | `https`              | Scheme used for SP endpoint URLs               |
| `SAML_AUTHN_REQUESTS_SIGNED` | `false`              | Sign outgoing AuthnRequests                    |
| `SAML_WANT_ASSERTIONS_SIGNED`| `true`               | Require signed assertions from the IdP        |
| `SAML_WANT_MESSAGES_SIGNED`  | `false`              | Require signed SAML messages from the IdP     |

> The IdP delivers the assertion via a cross-site POST to the ACS endpoint. For
> RelayState and `InResponseTo` validation to work in browsers, set
> `WARP_SESSION_COOKIE_SAMESITE=None` and `WARP_SESSION_COOKIE_SECURE=true`
> (HTTPS required) — the native equivalent of Mellon's `MellonCookieSameSite none`.
> See [CONFIGURATION.md](CONFIGURATION.md#session-cookie-and-the-saml-post-binding).
