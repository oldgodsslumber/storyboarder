# Setting it up once, for everybody — plan

Status: **planned, not built.**

The ask: set the models up for the team, hand over the `.storyboard`, and have your choices
arrive with it.

## What already travels

More than it looks like, because model choices were always project state rather than browser
state:

| In the file today | |
|---|---|
| the model list itself | every entry, with its name, kind and prompt templates |
| **which ImagineArt model each one means** (`imagineSlug`) | `gpt-image-2`, `ltx-2.3`, … |
| which two are selected | `imageModelId`, `videoModelId` |
| aspect ratio, resolution policy | `imagineAspect`, `imagineResolution` |
| how originals are kept | `originals` |

So setting the slugs and handing over the file already carries them. What does not travel is
everything the app learned or was told *about an account*, which lives in `localStorage`:

| In the browser only | why |
|---|---|
| the OAuth token, the API key | credentials — never in a file that gets emailed |
| the transport (sign-in vs key) | a fact about a person, not a board |
| the chosen organization | account-shaped, but see below |
| the model catalog read from the account | learned per account |
| which slugs have actually worked | learned per account |
| measured credit costs | learned per account |

## What should travel, and what must not

**Must not:** the token and the API key. A `.storyboard` gets emailed; a credential in one is
a credential in somebody's mail archive forever. That line does not move.

**Should:** four things, all of them facts about how *this board* is made rather than about
who is making it.

1. **The last model actually used, per entry.** `imagineSlug` is what somebody typed;
   `lastUsed` is what produced something — `{slug, at}`, written on a successful push. When
   ImagineArt ships Kling 3.1 and you switch, the board records that the switch worked, and a
   teammate opening the file gets a slug with evidence behind it rather than a guess. Shown
   in Settings as *"last produced something on 11 Sep"*.
2. **A catalog snapshot.** What the account's tools offered, with the date. A teammate who
   has not signed in yet — or whose sign-in fails — still sees the right model list instead of
   the v2 REST floor, and the slug field stops flagging perfectly good models as unlisted. The
   live account list still wins the moment it is read.
3. **Measured credit costs.** What a configuration actually cost. It is the same number for
   everyone on the same plan, and it means the second person to open the board gets a real
   figure on the button rather than a published base.
4. **The organization, optionally.** An org id is not a secret and the team shares one, so
   carrying it saves every teammate a step. Guarded: it is used only if the signed-in account
   is a member, and it is offered rather than imposed — *"this board was set up against Pega;
   use it?"* A checkbox in Settings governs whether it is written at all, for the case where a
   board leaves the company.

## Shape

One block, so it is obvious what is being shared and what is being carried:

```js
project.settings.imagine = {
  setUpBy: 'you@pega.com',        // who configured it, for the "adopt?" prompt
  at: 1757600000000,
  orgId: 'uuid' | null,           // only with the checkbox on
  catalog: [{slug, kind, deflt}], // snapshot, with `at`
  costs: { 'ltx-2.3||2160p': 215 }
}
```

…and `model.lastUsed = {slug, at}` on each entry, beside `imagineSlug`.

## How it behaves on the other end

Opening a board whose `imagine` block differs from this browser's state does **not** silently
change anything. It puts one line in the Prompts panel and in Settings:

> This board was set up by you@pega.com on 11 Sep — GPT Image and LTX 2.3, best resolution,
> billed to Pega. **Use these** · **Keep mine**

Adopting copies the org into this browser and seeds the catalog and the costs. Declining
leaves the board's copy alone, so the next person still gets the offer. Nothing about the
account is overwritten without a click, and nothing at all is overwritten for someone who
never opens Settings.

## The one honest caveat

A board carrying `ltx-2.3` is carrying a name that means something on the MCP transport and
nothing on the v2 REST one, where the same model is `ltx-video-v095-image-to-video`. A
teammate on an API key would see every slug flagged. Either the block records which transport
it was set up for, or — better — each model entry carries both: `imagineSlug` for the account
transport and `restSlug` for the key one, with the push choosing by door. That is a small
change and it removes a whole class of confusion, so it belongs in this work rather than
after it.

## Order of work

1. `lastUsed` per model, written on a successful push and shown in Settings.
2. The `imagine` block: write it on save, read it on open, with the adopt/keep line.
3. `restSlug` beside `imagineSlug`, chosen by transport.
4. The org checkbox and the membership guard.
