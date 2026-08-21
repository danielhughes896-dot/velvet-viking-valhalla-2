# monday.com — the operational board contract

Supabase is the source of truth. monday is the human operational layer: a board
somebody looks at to see how the business is doing and to notice when something
needs attention.

Two rules make that safe, and both are enforced in code rather than remembered.

**Nothing on the board is an authority.** No access decision, entitlement,
trial, price or lock state is ever read back from monday. If the board is wrong,
stale, hand-edited or deleted entirely, no athlete's access changes by one
second. `test/mondayOperational.test.js` fails if `_access.js`,
`_entitlement.js`, `_commercial-store.js` or `_products.js` so much as mentions
monday.

**Nothing coaching-related crosses.** Not a session, a pace, a heart rate, an
RPE, a readiness score, a note, a training history or anything health-shaped.
This is guaranteed by an allow list plus a refusal, not by care: the projection
names every field it takes, so a field added upstream later cannot leak, and a
gate refuses any key matching a training/health pattern even if somebody adds it
to the allow list by mistake.

---

## The account reference

The board never sees an account uuid. That value is the `auth.users` id — the
key to every table in the product — and putting it on a third-party board turns
that board into a lookup into the database for anybody who can see it.

Instead each account gets `VVV-` + the first 20 hex characters of
`HMAC-SHA256(account_id, MONDAY_OPERATIONAL_SALT)`, uppercased.

- **stable** — the same account always produces the same reference, so an item
  can be found again
- **unique** — 80 bits, so a collision across every account this product will
  ever have is unreachable
- **not reversible** — without the salt it is a random string

It fails closed. **No salt configured means no sync**, never a fallback to the
raw uuid — which is exactly the shortcut somebody would take at 2am to get a
board working.

---

## The payload — the complete vocabulary

| Field | Column id | Type | What it answers |
|---|---|---|---|
| `accountRef` | `text_account_ref` | text | which account, opaquely. The board key. |
| `accountCreated` | `date_account_created` | date | cohort |
| `lastActive` | `date_last_active` | date | subscriber or churn risk |
| `trialActive` | `boolean_trial_active` | checkbox | live provider trial |
| `trialEnds` | `date_trial_ends` | date | when it converts |
| `trialStarted` | `date_trial_started` | date | when the one allowance was spent |
| `paidActive` | `boolean_paid_active` | checkbox | paying now |
| `billingPeriod` | `status_billing_period` | status | `monthly` / `yearly` |
| `paidThrough` | `date_paid_through` | date | end of the period already paid for |
| `commercialState` | `status_commercial_state` | status | `none` `trial` `paid` `paused` `cancelled_active` `expired` |
| `cancelling` | `boolean_cancelling` | checkbox | set to end, still running |
| `cancelledAt` | `date_cancelled_at` | date | when it actually ended |
| `paused` | `boolean_paused` | checkbox | inside a pause window |
| `pauseResumes` | `date_pause_resumes` | date | when they come back |
| `accessState` | `status_access_state` | status | `open` / `soft_locked` / `locked` |
| `accessReason` | `text_access_reason` | text | the resolver's own product-facing reason |
| `provider` | `status_provider` | status | `web` / `apple` / `google` — the rail, not the processor |
| `adminGrant` | `boolean_admin_grant` | checkbox | beta or comp, so a tester is not counted as a customer |
| `syncedAt` | `date_synced_at` | date | when this row was last written |

**`accessState` is three values on purpose.** `open` — they can use it.
`soft_locked` — they cannot, but the door is a purchase away: expired, trial
over, paused, nothing owed. This is who to talk to. `locked` — revoked or on a
payment hold. A different conversation.

### Never sent, in any circumstance

Email, name, phone, address, date of birth, sessions, workouts, training
history, pace, heart rate, RPE, readiness, athlete state, notes, coaching
evidence, symptoms, injuries, weight, HRV, sleep, VDOT, distances, plans, races,
goals, Strava or Garmin data, activities, IP addresses, user agents, devices,
locations, card details, or any provider customer/subscription identifier.

---

## Idempotency, and its honest limit

The opaque reference is the key. Before anything is created the board is asked
whether an item already carries that reference; if it does, the item is
**updated**, not duplicated. One account, one item, ever.

A cleared value is sent as an empty cell rather than omitted. Omitting the key
leaves whatever was there — which is how a resumed athlete keeps showing a pause
end date forever.

**The race, stated rather than hidden:** monday has no unique constraint on a
text column and no upsert, so two genuinely simultaneous syncs of the same
account could both read "absent" and both create. The sync is serial and
operator-triggered, so the window is not reachable in practice. The fix is a
monday-side uniqueness automation, not more retries.

## Failure behaviour

A monday outage produces a **stale board**, never a failed purchase, a refused
sign-in or a lost webhook. The sync runs after the thing that mattered has
already been written to Supabase, every return is a report rather than a throw,
and no caller aborts on it. A monday GraphQL error is summarised to
`graphql_error` and never echoed — an error body repeats the request, and the
request carries the payload.

---

## Exact monday-side actions

1. **Create a board** named `Valhalla — Operational`. It must be a *different*
   board from the content/evidence board; the two have different rules and
   different blast radius.
2. **Create one group** on it, e.g. `Accounts`.
3. **Create the columns above**, with those exact ids. monday assigns an id when
   a column is created and it is usually not the title — open each column's
   settings and set the id, or read the assigned id and tell us so the map is
   corrected. **The column ids must match the table exactly; a mismatch writes
   nothing and reports success.**
4. Status columns need their labels created: `monthly`/`yearly`;
   `none`/`trial`/`paid`/`paused`/`cancelled_active`/`expired`;
   `open`/`soft_locked`/`locked`; `web`/`apple`/`google`. The sync sends
   `create_labels_if_missing: false`, so a missing label is a refused write
   rather than a board that quietly grows labels nobody designed.
5. **Do not add automations that write to these columns.** The board is a
   mirror. An automation editing a mirrored column produces a board that
   disagrees with the database and cannot be reconciled.

## Exact Vercel environment variables

| Name | Value |
|---|---|
| `VVV_MONDAY_OPERATIONAL` | `on` — the sync is off until this says so |
| `MONDAY_API_TOKEN` | the monday personal API token (already set for the content bridge; the same token is fine) |
| `MONDAY_OPERATIONAL_BOARD_ID` | the numeric board id from the board URL |
| `MONDAY_OPERATIONAL_GROUP_ID` | the group id (not its title) |
| `MONDAY_OPERATIONAL_SALT` | a long random string, generated once and never changed. **Changing it re-keys every account and orphans every existing board item.** |

Never paste any of these into a chat, a commit or a file in this repository.
