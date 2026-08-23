# Getting the leaderboard running

Three steps, about ten minutes, and it costs nothing.

---

## 1. Create the database (2 minutes)

1. Open the **ethan-game** project at [supabase.com](https://supabase.com)
2. Left sidebar → **SQL Editor** → **New query**
3. Open `supabase-setup.sql`, copy the whole file, paste it in, press **Run**

You should see `Success. No rows returned`. That is it — you never have to
touch SQL again unless you want to kick someone off the board.

---

## 2. Put the key in the game (1 minute)

1. In Supabase: **Project Settings** → **API Keys**
2. Copy the **publishable** key. It starts with `sb_publishable_`
3. Open `index.html` in any text editor and find this near the top
   (it is about 40 lines into the `<script>` block, search for `CLOUD`):

```js
const CLOUD = {
  url : 'https://ctzjitzkolqghvonjtnx.supabase.co',
  key : '',            // <-- paste the sb_publishable_... key between these quotes
  club: 'ralston',     // everyone using the same word shares one leaderboard
};
```

4. Paste the key between the empty quotes. Save the file.

**Only ever paste the publishable key here.** There is a second key called
`service_role` — that one bypasses every protection in the database and must
never go in a file you hand to other people. If you paste the wrong one,
rotate it in Supabase immediately.

The publishable key is *designed* to be public. It is safe here because the
tables have row level security with no policies, so that key cannot read or
write them directly. Everything goes through the six checked functions.

---

## 3. Publish it (already done)

The game lives at **https://github.com/reynoldw/shooters-royale** and GitHub
Pages serves it from the `main` branch at:

**https://reynoldw.github.io/shooters-royale/**

To push a change after editing `index.html`:

```bash
cd ~/Documents/ethan-game
git add -A && git commit -m "what changed" && git push
```

Pages redeploys on its own, usually within a minute. Send that link to the class.

> Anything in a public repo is public, including the key in `index.html`. That is
> fine for the publishable key and **only** for that one.

---

## What a kid actually does

1. Opens the link
2. Clicks the chip that says **NOT SIGNED IN · TAP TO JOIN THE CLUB**
3. Types a made-up fighter name and picks any 4 digits
4. Plays

Every finished trial goes to the board. Their coins, unlocks and weapon
mastery are saved to the server too, so they can play on a different computer
by signing in with the same name and PIN.

**Tell them to write the PIN down.** There is no email, so there is no
"forgot my PIN" link — that is the price of not collecting anything about them.
You can reset one by hand (see the bottom of `supabase-setup.sql`).

---

## What is stored, and what is not

| Stored | Not stored |
| --- | --- |
| A made-up handle | Real names |
| A scrambled (bcrypt) PIN | Email addresses |
| A club word | Ages or birthdays |
| Wins, kills, headshots, trials | Location, IP, device ID |
| The game save (coins, unlocks) | Anything that identifies a child |

This is deliberate. Nothing here can identify a kid, which is what keeps the
project out of COPPA's scope and means you are not holding data you would
have to protect. It is worth keeping that way even when somebody points out
that Google sign-in would be less typing. It would also be a legal project.

Tell the parents and the school it exists anyway. "My son built a game, here
is the link, it stores a nickname and a score and nothing else" is a very easy
conversation to have *before* somebody asks.

---

## Running the club

All of these go in the SQL Editor.

```sql
-- who has been playing
select handle, club, matches, wins, kills, last_seen
  from players order by last_seen desc;

-- a name got past the filter
update players set handle = 'NEWNAME' where handle = 'OLDNAME';

-- somebody forgot their PIN — this sets it to 1234
update players set pin_hash = extensions.crypt('1234', extensions.gen_salt('bf')),
                   fails = 0, locked_until = null
 where handle = 'SLAGKING';

-- remove a player and free up their name
delete from players where handle = 'SLAGKING';

-- look for someone inflating their score
select handle, count(*) as trials, avg(duration_s)::int as avg_len, sum(kills)
  from matches where played_at > now() - interval '1 day'
 group by handle order by sum(kills) desc;
```

---

## About cheating, honestly

The game runs in the browser, so any kid who opens DevTools can change their
own numbers. That is not fixable in a game like this, and trying hard to fix
it would make the game worse.

What the database does instead:

- **Impossible numbers are clipped.** You cannot report more kills than there
  were opponents in the lobby.
- **Rate limits.** 25 trials an hour, and you cannot claim more minutes of
  play in an hour than an hour actually contains.
- **Everything is visible.** The board shows each player's trial count next to
  their kills, so 25 trials and 25 wins in one afternoon looks exactly as silly
  as it is. Every submission leaves a row in `matches` with a name on it.

Deliberately *not* done: rules like "five kills cannot happen in sixteen
seconds". They sound sensible and then they throw away a real player's best
run of the week, which is the exact run they wanted on the board. Rate limits
can never do that to an honest match.

With twelve year olds, "everyone can see you did that" works better than
clever validation. If someone does inflate their score, the fix is a
conversation, and `delete from players where handle = '...'`.

---

## If something does not work

| What you see | What it means |
| --- | --- |
| Chip says **PLAYING OFFLINE** | The key is still blank in `index.html` |
| "Cannot reach the server" | Wifi, or the school network is blocking Supabase |
| "Somebody already took that name" | Handles are unique across the whole club |
| "Too many wrong PINs" | Eight wrong guesses locks the account for 15 minutes |
| Board is empty | Nobody has finished a trial yet in that club |
| Mouse does not get captured | Some managed Chromebooks block pointer lock — try a normal laptop |

Nothing online is required to play. If Supabase is unreachable, or the key is
blank, the whole game still works and saves on that computer. The leaderboard
is the only thing that goes quiet.
