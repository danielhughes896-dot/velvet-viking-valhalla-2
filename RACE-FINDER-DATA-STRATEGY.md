# Race Finder: can we legally get the data

This is the document the prototype's header comment points at. The code in
`protected/velvet-viking-valhalla.html` answers "can we build it". This answers
the question that actually decides whether the feature ships:

> **Can Velvet Viking obtain enough reliable race data, under terms that let a
> commercial product use it?**

Short answer: **yes, with conditions, and none of the conditions is code.** The
blocker is a licensing conversation, not an engineering one. That asymmetry is
the single most important thing in this document, because it means the prototype
being finished tells you almost nothing about whether the feature can launch.

Nothing here was verified against a live provider. Everything below is desk
research from providers' own public pages plus what their existing integrations
demonstrate. Where a term is not stated publicly, this document says so rather
than assuming the friendly reading.

---

## 1. What the feature actually needs

Worth being precise, because "race data" makes the requirement sound larger than
it is. Valhalla does not need a race directory. It needs to answer one question
an athlete cannot easily answer themselves: *given that I want this distance
around this time near here, which real events exist?*

That reduces to a small per-event record:

| Field | Needed for | Missing is |
|---|---|---|
| name | showing the athlete what they picked | fatal |
| date | the entire block: phases, taper, countdown | fatal |
| distance | choosing which block to build | fatal |
| location, lat/lon | "near me", travel distance | degrades |
| status | never offering a cancelled race | **degrades dangerously** |
| official URL | the athlete entering, and dedupe evidence | degrades |
| terrain, elevation | Execution Strategy, one day | nice to have |
| organiser | dedupe evidence, trust | nice to have |

Two consequences drop straight out of that table.

**Status freshness is the risk, not coverage.** A calendar missing a third of UK
races is an inconvenience — the athlete types their race in and the plan is
identical. A calendar that still lists a cancelled race as scheduled sends
somebody to a start line that is not there, having spent sixteen weeks training
for it. Coverage is a marketing problem; staleness is a trust problem. Every
provider conversation should lead with "how quickly do cancellations propagate,
and will you tell us in writing", not "how many events do you have".

**Elevation and terrain are optional and must stay optional.** They are the
fields most often absent and most often wrong. The prototype never infers either
— `normaliseRace()` returns `null` elevation when the provider is silent, and
`raceFit()` states "No elevation data for this course" as a caveat. A guessed
elevation would be read as fact and would eventually drive an Execution Strategy
pacing target, which is the worst possible place for a fabricated number.

---

## 2. What is not on the table

**Scraping.** Race events being publicly visible on a website does not make a
compiled calendar free to take. In the UK and EU, the database right protects a
substantial investment in obtaining and verifying contents independently of
whether any individual fact is copyrightable — and a race calendar is close to
the textbook example of sweat-of-the-brow compilation. Add terms of use that
almost universally forbid automated extraction, and scraping is the option that
looks cheapest until the product has paying customers, at which point it is a
liability with a name and an address. It is out on those grounds, not on
squeamishness.

**Inferring rights that are not stated.** "Their API is public" is not a licence.
"They let Garmin do it" is not a licence to us. If a term is not in writing, it
does not exist for planning purposes.

**Any LLM in the ranking path.** Standing product rule, and it applies with
force here: a ranked race list assembled by a language model is a set of
recommendations nobody can explain or reproduce, attached to a decision the
athlete will build four months of their life around. `searchRaces()` is
deterministic filtering plus a band ordering, and `FIT_BAND_ORDER` is five
integers precisely so the reason for a race's position can be stated in a
sentence.

---

## 3. The providers, honestly assessed

### Ahotu — strongest candidate

Roughly 68,730 events across 187 countries by its own public numbers, and — the
part that matters — **it already licenses this exact flow.** Ahotu data feeds
Garmin Connect's race search, including Garmin's adaptive training plans, and
Strava. That is not a rumour about capability; it is a shipped integration doing
the same job Valhalla wants: athlete searches races, picks one, a training plan
is built to it.

UK inventory comes largely via Eventrac, which is credible domestic coverage
rather than a thin international skim.

The catch: **no self-serve API and no published pricing.** There is no key to
sign up for. Access is a commercial conversation with a company that has already
proven it will do these deals — which is the good version of "no API", because
the precedent exists and the terms are negotiable rather than absent.

*Assessment: the one to approach first. Precedent, coverage and intent all line
up. Cost and minimum commitment unknown.*

### RunSignup — documented, weak where we live

A real documented REST API and an explicit affiliate programme, so the rights
question is answerable by reading rather than negotiating. That is genuinely
valuable: it is the only candidate where an engineer could integrate this week.

But it is a US race-registration platform. UK coverage is thin to the point of
being unusable as a primary source for a UK-first product with five UK beta
athletes.

*Assessment: excellent as a second source, a US-market source, or an integration
rehearsal. Not a launch source for the UK.*

### findarace.com and England Athletics RunEvents — right inventory, no door

Both have strong, well-maintained UK coverage. Neither publishes an API. RunEvents
in particular is close to authoritative for affiliated UK road and cross-country
racing.

*Assessment: the right data behind no technical door. England Athletics is worth
a direct approach on partnership grounds — a training product that fills UK race
fields is aligned with their interests, not opposed to them — but that is a
relationship, not an integration, and it will not move on an engineering
timescale.*

### parkrun — closed, and correctly so

parkrun's API programme is **on hold** and applications are not being accepted.
Worth noting it is also the wrong shape: parkrun events are weekly, free and
ubiquitous, which makes them a poor goal race and a poor Race Finder result. A
5K every Saturday morning is not the thing a sixteen-week block builds toward.

*Assessment: rejected, and no loss.*

---

## 4. The recommended path

**Two sources, deliberately, from the first day there is one.**

Not for coverage — for the reason that shows up throughout the prototype: a
single provider is a single point of both failure and truth. With one feed there
is no way to notice it is wrong. With two, disagreement is detectable, which is
why `dedupeRaces()` preserves every source on every row and why `raceUrlKey()`
merging exists at all. The architecture already assumes plurality; the licensing
should too.

The sequence:

1. **Approach Ahotu.** Lead with the Garmin precedent, and ask specifically about
   cancellation latency and about redistribution terms for a paid consumer app.
2. **Integrate RunSignup in parallel**, on its documented affiliate terms, as the
   second source and as proof the two-provider abstraction survives contact with
   a real feed. Its UK weakness does not matter for that purpose.
3. **Open a partnership conversation with England Athletics** on a longer
   timescale, for UK depth and for the credibility of affiliated-race data.
4. **Ship manual entry as the primary path regardless**, and never demote it.

That last point is the one to defend hardest, and it is why
`raceFinderStepModel()` builds `manualEntry` before it builds the results and
returns it in all five tested states including the ones where search worked
perfectly. Race Finder is a convenience layered on a product that already works.
If it is ever load-bearing, an outage at a company Valhalla does not control
becomes an outage in Valhalla, and a licensing renegotiation becomes a hostage
negotiation.

---

## 5. Terms to insist on in writing

Non-negotiable, because each maps to something already built:

- **Redistribution in a paid consumer app.** Not "personal use", not
  "non-commercial". If this is not granted, the licence is useless — the product
  is intended to be paid for.
- **Cache and store selected races.** The prototype stamps `goalRace` into plan
  setup and it must survive offline, forever, independent of the provider. A
  licence forbidding local retention breaks the offline guarantee the whole app
  is built on.
- **Cancellation and postponement propagation, with a stated latency.** The
  single highest-risk field. Ask for the number and get it in the contract.
- **Attribution terms.** Fine to display; needs to be known up front so the
  surface is designed for it rather than retrofitted.
- **No exclusivity on our side.** Two sources is an architectural commitment.
- **Notice period on termination.** Long enough to migrate a normaliser and
  notify athletes who have a race selected.

And one to refuse: **any term tying result ordering to commercial arrangement.**
Paid placement, if it ever exists, appears as its own labelled block outside the
fit results. A test asserts there is no `promoted`, `featured`, `sponsored` or
`priority` field anywhere in the Race Finder region for such a deal to be written
into, and that `fit` carries no numeric score a thumb could be put on. Race
matching must not become pay-to-win, and the cheapest way to guarantee that is
for the field not to exist.

---

## 6. The public website

**Defer.** A public race search on the marketing site is a real acquisition idea
and it is not this quarter's, for three reasons that all point the same way:

- It needs the licence first, and probably a *wider* licence than the app does —
  public unauthenticated display is a different grant from in-app display to a
  paying customer.
- It only works at scale, and scale here means thousands of thin generated pages.
  That is an SEO strategy with a bad reputation and a real penalty risk, and it is
  explicitly not what this product should be spending its credibility on.
- The current site's job is converting a five-person private beta into a first
  cohort. A race directory does not help with that.

Revisit when there is a licence, a public-display grant, and a reason beyond
"pages rank".

---

## 7. Where this leaves the feature

The engineering is done and inert: normaliser, identity, dedupe with provenance,
deterministic filters, explainable fit, selection into the existing goal fields,
a change-impact description that rebuilds nothing, a step view model, and 46
tests. `RACE_FINDER_ENABLED` is `false`, nothing reaches a render path, and no
provider is connected.

What is missing is a signature on a data licence. Until there is one there is
nothing to turn on, and turning it on with fabricated inventory would be worse
than not shipping it — a race calendar that is wrong is not a lesser version of
one that is right.
