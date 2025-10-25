# Game Tracker - Working Log

## Project Overview
Local-first desktop and web app to ingest personal game libraries, enrich metadata, and manage a private backlog.

## Current State
- Implemented: PNPM monorepo (`apps/web`, `apps/desktop`, `packages/core`), Dexie schema, import/export flows, basic metadata fetch.
- Partial: Desktop fetch commands need reliability; styling regressions under investigation.
- Gaps: Search/filter enhancements, store badge UX, enrichment pipeline polish.

## Architecture
- Stack: React 18 + TypeScript + Vite + TailwindCSS; Dexie (IndexedDB); Tauri v2 + Rust; PNPM workspaces.
- Key modules/files: `apps/web/src/pages/LibraryPage.tsx`, `apps/web/src/db.ts`, `packages/core/src/*.ts`, `apps/desktop/src-tauri/src/commands.rs`.
- Data flow: Web UI + desktop bridge (`apps/web/src/desktop/bridge.ts`) + Tauri commands + remote APIs; imports use core normalizers then Dexie persistence.

## Decisions & Rationale
- Manual per-item metadata fetch with caching/backoff to respect API rate limits.
- Fixed-width library cards (responsive column count only) for visual consistency.
- Local caches under `%AppData%/GameTracker/` for HLTB/OpenCritic/Steam metadata.

## Open Tasks
- Now: Restore Tailwind styling, enforce fixed card layout, add title search, add store badges.
- Next: Dexie migration for new fields, row-by-row importer enrichment with throttling.
- Later: Ship SVG badges, explore Steam Web API integration.

## Known Issues
- UI currently unstyled due to missing Tailwind directives.
- Desktop fetch commands may fail (OpenCritic 429, HLTB misses, Steam currency mismatches).
- Settings page occasionally triggers "Invalid hook call".

## Commands
- Install deps: `pnpm install`
- Web dev: `pnpm dev:web`
- Desktop dev: `pnpm tauri dev`
- Core tests: `pnpm -C packages/core test`

## CSV ingestion – baseline
- Suspected delimiter: `,`; BOM: not present; line endings: `\r\n` (Windows-style) when quoted blocks span multiple physical lines.
- First 40 raw lines from `apps/web/public/hookdata/games.csv`:
```
id,metascore,platform,release_date,sort_no,summary,title,user_score
543718,91,PC,"August 18, 2020",301,"From light planes to wide-body jets, fly highly detailed and accurate aircraft in the next generation of Microsoft Flight Simulator. Test your piloting skills against the challenges of night flying, real-time atmospheric simulation and live weather in a dynamic and living world.",Microsoft Flight Simulator,7.1
555108,91,PC,"December 8, 2022",302,"Take up your sword, channel your magic or board your Mech. Chained Echoes is a 16-bit SNES style RPG set in a fantasy world where dragons are as common as piloted mechanical suits. Follow a group of heroes as they explore a land filled to the brim with charming characters, fantastic landscapes and vicious foes.

Can you bring peace to a continent where war has been waged for generations and betrayal lurks around every corner?

Chained Echoes is a story-driven game where a group of heroes travel around the vast continent of Valandis to bring an end to the war between its three kingdoms. In the course of their journey, they will travel through a wide array of diverse landscapes spanning from wind-tanned plateaus and exotic archipelagos to sunken cities and forgotten dungeons.",Chained Echoes,8.7
106820,91,PlayStation 2,"November 7, 2005",303,"Strap on your Guitar Hero SG controller, plug-in, and CRANK IT UP. Guitar Hero creates all the sensations of being a rock star, as you rock out to 30 of the greatest rock anthems of all time and more. Soundtrack includes songs as made famous by such legendary artists as the Red Hot Chili Peppers, David Bowie, Boston, Sum 41, Ozzy Osbourne, Audioslave, White Zombie, Franz Ferdinand, and The Ramones. So kiss that air guitar goodbye and get ready to rock. Features over 30 of the greatest rock songs of all-time. 4 difficulty levels (Easy, Medium, Hard, and Expert). 6 venues that range from basement parties to sold out stadiums. 8 different characters that each offer their own look and unique style of playing, from metal head to classic rocker. Two-player mode that offers tons of multiplayer fun. [Red Octane]",Guitar Hero,8.5
110775,91,PC,"November 13, 2008",304,"Players last visited Northrend in ""Warcraft III: The Frozen Throne,"" when Arthas Menethil fused with the spirit of NerTzhul to become the Lich King, one of the most powerful beings in the Warcraft universe. He now broods atop the Frozen Throne deep in Icecrown Citadel, clutching the rune blade Frostmourne and marshaling the undead armies of the Scourge. In Wrath of the Lich King, the forces of the Alliance and the Horde venture into battle against the Scourge amid Northrends howling winds and fields of jagged ice. Wrath of the Lich King adds a rich variety of content to an already massive game. New features in the games second expansion include: Death Knight Hero Class: Create a high-level Death Knight character -- the games first hero class -- once certain challenges have been met. Increased Level Cap: Advance to level 80 and gain potent new talents and abilities along the way. Northrend: Explore the harsh new continent of Northrend, packed with new zones, quests, dungeons, monsters, and items -- and do battle with the undead armies of the Lich King. ""Inscription"" Profession: Learn this exciting new profession and gain unique ways to permanently enhance spells and abilities in the game. Siege Weapons and Destructible Buildings: Take the battle to another level with new player-vs.-player game mechanics and new battlefields to wage war on. New Character Customization: Change how characters look and express themselves, with different hairstyles and dance animations. [Blizzard Entertainment]",World of Warcraft: Wrath of the Lich King,7.7
142864,91,Wii,"October 26, 2010",305,Rock Band returns with the third iteration of the popular music game featuring new songs and instruments.,Rock Band 3,6.8
114951,91,Wii,"August 24, 2009",306,"Metroid Prime 3: Corruption set a new standard for first-person motion controls in video games. Now its bringing those controls to the rest of the celebrated series, allowing players to experience the entire Metroid Prime story arc with the precision of the Wii Remote. Metroid Prime Trilogy, is a three-game collection for the Wii console that bundles all three landmark Metroid Prime games onto one disc and revamps the first two installments with intuitive Wii Remote controls, wide-screen presentation and other enhancements. Each game maintains its original storyline and settings, but now Metroid Prime and Metroid Prime 2: Echoes let players use their Wii Remote to aim with precision as heroine Samus Aran. Based on the breakthrough control system that debuted in Metroid Prime 3: Corruption, these new Wii controls bring an entirely new level of immersion and freedom to these milestone games. Players can access the game they want from a unified main menu that ties together all three adventures. Through a new unlockables system, players can gain access to in-game rewards such as music and artwork by accomplishing objectives across all three adventures. [Nintendo]",Metroid Prime Trilogy,9.2
107055,91,PC,"June 10, 2008",307,"The E3 2007 award-winning sequel to the highest-rated real-time strategy game of all time delivers an epic campaign and fierce multiplayer battles.","Sins of a Solar Empire: Rebellion",8.8
547914,91,PC,"February 8, 2023",308,"A farm sim game with RPG elements to it! Besides being able to farm such as growing crops or raising animals, you can also get resources from mining, fishing, logging, and interacting with NPCs by completing quests, gifting, etc. You can also decorate your garden and create routes, fences, and decorative items to personalize your garden. ???(?¬ ї??)??",Voltaire: The Vegan Vampire,6.9
549975,91,PC,"September 28, 2022",309,"Beacon Pines is a cute and creepy adventure game. Sneak out late, make new friends, uncover hidden truths, and collect words that will change the course of fate!",Beacon Pines,8.4
545823,91,PC,"June 14, 2022",310,"Birushana: Rising Flower of Genpei is set 15 years after the Heiji Rebellion, with the Heike clan ruling the capital, and the Minamoto clan nearly decimated. The only surviving male heir of the Minamoto clan is wrapped in secrecy and raised as a female to hide his identity, despite being the legitimate successor to the clan. Rogue elements of the Minamoto clan continue to resist the Heike, and the Heike's frustration rises to a breaking point.",Birushana: Rising Flower of Genpei,7.8
112955,91,Wii,"October 6, 2009",311,"New Super Mario Bros. Wii is a side-scrolling platform game developed and published by Nintendo for the Wii home video game console. The sequel to New Super Mario Bros., it was released in North America on November 15, 2009, followed by Australia, Japan, and Europe a few days later. After a Wii version of Super Mario Galaxy 2, which nobody expected, Super Mario Bros. Wii was confirmed at E3 2009 on June 2, 2009. Being a sequel to New Super Mario Bros., its plot and gameplay are similar to the previous game.",New Super Mario Bros. Wii,8.9
505011,91,PC,"September 28, 2018",312,"The culmination of the ""LEGEND OF HEROES"" series' 15th anniversary -- the total sales for which exceeded 1 million units in Asia. The Fate of the Empire will be determined in ""The Erebonian Civil War""! Presenting a new story in the Byronic ""LEGEND OF HEROES"" series, developed by the Nihon Falcom Corporation. ","The Legend of Heroes: Trails of Cold Steel IV",7.7
492155,91,PC,"March 30, 2017",313,"A new warrior has entered the ring! Take control of the iconic Powered Rangers and their villains, past and present, in Power Rangers: Legacy Wars, a massive worldwide fighting game!Developed by nWay in collaboration with Saban Brands and Lionsgate, the multiplayer fighting game Power Rangers Legacy Wars features characters from the Power Rangers movie in addition to an entire collection of Rangers and villains from the past 24 years of the Power Rangers franchise.",Power Rangers: Legacy Wars,4.2
514446,91,PC,"June 4, 2019",314,"A rich combination of city building, strategy and alchemy,then throw in an extra dash of random catastrophe. Make potions, break rules, and grow your massive city.",Little Big Workshop,7
510611,91,PC,"November 20, 2018",315,"Konami's PES returns with unique football changes that'll separate it from the pack. With an improved version of the franchise's acclaimed gameplay, which has seen it win ""Best Sports Game"" at gamescom for two straight years, and industry leading visuals and presentation, PES 2019 is an experience that needs to be seen to be believed.",Pro Evolution Soccer 2019,7.3
513295,91,PC,"August 22, 2018",316,"Enjoy the six high-quality japanese visual-novel masterpieces inside this ""all-age"" version collection with exclusive contents.",Ascension to the Throne,7.6
113574,91,Xbox 360,"September 22, 2009",317,"The Beatles: Rock Band allows fans to pick up the guitar, bass, mic or drums and experience The Beatles’ extraordinary catalogue of music through gameplay that takes players on a journey through the legacy and evolution of the band’s legendary career.",The Beatles: Rock Band,8.5
226948,91,PC,"August 30, 2012",318,"The Walking Dead Episode 4: Around Every Corner is the fourth of five episodes contained in Season One of The Walking Dead. The episode focuses on Lee and the remaining survivors as they finally arrive in Savannah, Georgia to escape the Walkers. The episode was written by Gary Whitta, writer of The Book of Eli and After Earth.",The Walking Dead: The Game - Episode 4: Around Every Corner,8.4
383,91,PC,"November 16, 2004",319,"The Half-Life 2 saga is the highest acclaimed game ever with over 50 Game of the Year Awards and the highest rankings in Metacritic's PC and FPS categories. It also introduced the Source engine, the first integrated physics simulation in games. Half-Life 2: Episode One is the first in a series of episodes that reveal the aftermath of Half-Life 2 and launch a journey beyond City 17. The player reprises the role of Dr. Gordon Freeman, who along with the enigmatic Alyx Vance and her robot, Dog, was last seen leaving the heart of the Citadel before it exploded. Alyx makes an appearance as a non-player character who accompanies Gordon and fights alongside him with unique weaponry-including new additions to her arsenal. [Valve]",Half-Life 2: Episode One,9.2
555498,91,PC,"September 21, 2022",320,"Return to Monkey Island is an unexpected, thrilling return by series creator Ron Gilbert that continues the story of the legendary adventure games The Secret of Monkey Island and Monkey Island 2: LeChuck’s Revenge developed in collaboration with Lucasfilm Games.",Return to Monkey Island,8.6
518681,91,PC,"October 22, 2019",321,"Manifold Garden is a game that reimagines physics and space. Explore beautiful Escher-esque worlds of impossible architecture. Witness infinity through the eyes of an artist.

Manifold Garden is a game that reimagines physics and space. Explore beautiful Escher-esque worlds of impossible architecture. Witness infinity through the eyes of an artist.",Manifold Garden,7.6
119,91,PC,"July 19, 2000",322,"Diablo II is an action role-playing game developed by Blizzard North and published by Blizzard Entertainment in 2000 for Microsoft Windows and macOS. Diablo II was praised by critics, with many citing it as one of the greatest games of all time. It has remained popular, and also introduced the Battle.net service, which is still used today.",Diablo II,8.8
485288,91,PC,"May 10, 2016",323,"The Witcher Card Game",Gwent: The Witcher Card Game,7.5
486695,91,PC,"June 2, 2016",324,"Duet is a hypnotic game of time and destruction. Your survival is dependent on protecting two vessels ï¿½ they are devices in sync, a dance and song between two entities tethered together in symbiosis. Feel edge of your seat terror where the world around you becomes quiet and numb as all that matters is the game living between your palms ï¿½ that is Duet.",Duet,8.3
562380,91,PC,"July 16, 2021",325,"Beasts of Skin, Steel, and Bone

Your expedition has gone missing, and you must find them. Thrown into a search that gets more complicated the deeper you go, can you out-think the monsters long enough to bring your companions home?

Bugsnax meets Slay the Spire in this strategy roguelike with deckbuilding elements.",Beasts of Maravilla Island,6.9
552977,91,PC,"October 27, 2022",326,"Signalis is a classic survival horror experience set in a dystopian future where humanity has uncovered a dark secret. Unravel a cosmic mystery, escape terrifying creatures, and scavenge an off-world government facility as Elster, a technician Replika searching for her lost dreams.",Signalis,7.9
555437,91,PC,"November 19, 2022",327,"Prodeus is the old-school shooter of today; a hand-crafted campaign from industry FPS veterans, retro visuals reinvisioned using modern rendering techniques, and gameplay that just simply feels good.

Old school, new school, no school. Prodeus is FPS evolved.",Prodeus,7.8
488057,91,PC,"November 30, 2016",328,"Square Enix and tri-Ace present a brand-new RPG of cosmic proportions. Engage in real-time combat to annihilate your foes with powerful combos and switch between 6 unique characters to utilize their special strengths in battle. Discover the expansive sci-fi fantasy world of Star Ocean, meet new allies, face dangerous enemies, and save the galaxy. 2D pixel art characters are beautifully rendered against 3D environments, while real time events keep the story flowing seamlessly.",Star Ocean: First Departure R,7.6
524604,91,PC,"February 18, 2020",329,"Mythic Ocean lets you explore the ocean depths and play a part in its reconstruction. Befriend the numerous denizens of the world as your story intertwines with theirs. Every creature you meet has their own unique life, complete with backgrounds, issues, and personality quirks of their own. Ask their opinions, invite them to hang out, introduce them to animals they’d like, or find support for their goals. Provide the gods with guidance as they respond to what the creatures value, and explore a narrative that changes drastically depending on the various choices you make.",Mythic Ocean,6.9
108364,91,PC,"November 3, 2006",330,"Defcon is a PC strategy game inspired by the 1983 cult-classic war film ""WarGames."" The game simulates Global Thermonuclear War where the player assumes the role of a Commander hidden deep within an underground bunker. The player issues orders to armies, navies, and aircraft with the goal of causing the highest enemy civilian casualties possible, effectively rendering that territory useless to the enemy. The player that best accomplishes this goal is the winner.

The game, which allows between 1 and 6 players, is inspired by the 1983 cult-classic war film ""WarGames.""",DEFCON,7.5
554247,91,PC,"September 5, 2022",331,"The third instalment in the Danganronpa main series, Danganronpa V3: Killing Harmony introduces a new death game cast of 16 Ultimate Students.

Monokuma returns to run the Killing School Semester, and Monokubs are introduced.",Danganronpa V3: Killing Harmony,7.7
514335,91,PC,"June 26, 2019",332,"You are the unlikeliest of heroes - a rag-tag kid in an oversized suit of armour, travelling along with a goblin that's smarter than he looks, and the wind spirit that lives inside a magic sword. Together, you've got to muscle your way into the heart of an enormous, tyrannical robot and shut the thing down for good. Ravva and the Cyclops Curse is a 2D fantasy platformer inspired by classic '90s action games.",Ravva and the Cyclops Curse,7.7
514346,91,PC,"May 8, 2019",333,"In 2054, magic has returned to a world of cold corporate technology. Vicious creatures have re-entered the world. Technology merges with flesh and mind. Elves, trolls, orks and dragons walk among us. A world in which over 20 million people use the Matrix everyday...you are one of them.","Shadowrun Returns: Dragonfall - Director's Cut",7.7
514471,91,PC,"July 16, 2019",334,"Inspired by the classic adventure of the same name, Return of the Obra Dinn is a first-person mystery adventure based on exploration and logical deduction.

Lost at sea 1803--the good ship Obra Dinn.
The next morning, the Obra Dinn drifted into port with damaged sails and no visible crew. As insurance investigator for the East India Company’s London Office, dispatch immediately to Falmouth, find means to board the ship, and prepare an assessment of damages.",Return of the Obra Dinn,8.7
524700,91,PC,"May 21, 2020",335,"Sheepo is a pacifist ""Metroidvania"" where you traverse strange planets in order to capture and catalog species of animals. With each species you capture, you gain the ability to transform into them, unlocking new parts of the planet to explore.",Sheepo,7.5
110179,91,PlayStation Portable,"October 6, 2009",336,"TAITO's ""Darius"" is an arcade game that was first released in 1986. This renowned side-scrolling shooting game featured a unique arcade cabinet that utilized three CRT monitors to deliver action on a super wide screen. Many players were taken aback by the overwhelming visuals that were powered by state-of-the-art pixel technology, and by the catchy ZUNTATA sound design.",Darius Burst,8.1
510391,91,PC,"November 6, 2018",337,"Grip is a futuristic combat racing game that features breathtaking speeds and heavy weapons.",GRIP: Combat Racing,6.9
533676,91,PC,"October 5, 2021",338,"About the ""SKIDROWCODE"" (SKIDROWCODE GAMES) is an indie company. ì�¤ë���","SKIDROWCODE GAMES",4.7
534002,91,PC,"October 12, 2021",339,"Help the main hero cook delicious royal cuisine, manage a kitchen, run your own restaurant in a fairy country and become the best chef in the world!.","Cooking Simulator: Pizza",6.4
513872,91,PC,"October 29, 2018",340,"""Slime Rancher"" is a first-person, sandbox adventure game released by Monomi Park in 2017 for PC, Mac, Linux, and Xbox One, and then on Nintendo Switch in 2021. The game follows the exploits of a spunky, young rancher named Beatrix LeBeau, who accepts the challenge of a new life a thousand light years away on the ""Far, Far Range."" Each day will present new challenges and risky opportunities as she attempts to amass a great fortune in the business of slime ranching. Some players have described ""Slime Rancher"" as ""Harvest Moon"" meets ""Pokemon"" with a dash of ""Animal Crossing.""",Slime Rancher,8.7
510408,91,PC,"November 20, 2018",341,"Kenshi 2 is an upcoming video game by Lo-Fi Games.","Kenshi 2",0
```
- Header row: `id,metascore,platform,release_date,sort_no,summary,title,user_score`

## Notes
- 2025-02-14: Initialized Git, removed redundant `game-tracker/` copy, added worklog template.
- 2025-02-14: Restored Tailwind styling/cards, added debounced title search, and surfaced store badges in library view.
- 2025-02-14: Removed legacy `old*` web pages and re-enabled full TypeScript coverage.
- 2025-02-14: Added Dexie v5 migration (`currencyCode`), moved TTB source tracking onto identities, and refreshed editor/bulk fetch flows.
- 2025-02-23: Added Dexie v6 `settings` key/value store for enrichment state and introduced background enrichment with pause/resume and a floating status bar.
- 2025-02-24: Implemented a singleton enrichment runner with persisted sessions, minimal HUD overlay, and a hideable Import Wizard. Updated `ImportWizard.tsx`, `state/enrichmentRunner.ts`, `overlays/EnrichmentHUD.tsx`, and styling/Library hooks; verified via `pnpm build` (web) â€” noted existing Vite dynamic import warning. Known limitation: Tauri bridge calls still lack abort support, so pause waits for the current request to settle.
- 2025-02-24: Added runner `phase` lifecycle (`idle/init/active/paused/done`) with a 600ms minimum init window, shader-style init line (`gt-hud__init`) that swaps to progress fill (`gt-hud__prog`), and reduced-motion guard. `EnrichmentHUD` now reads `snapshot.phase` to switch lines while keeping popover controls unchanged.
- 2025-02-24: Wired OpenCritic via RapidAPI: desktop command reads `OPENCRITIC_API_KEY`/`OPENCRITIC_HOST`, hits `/game/search` and `/game/{id}`, caches scores in `%AppData%/GameTracker/opencritic_cache.json` for 7 days, and backs off on 429 using `Retry-After` or a 700ms+jitter fallback.
- 2025-02-25: **Vendor assets â€“ current:** confirmed `apps/web/public/hookdata` contains `hltb_data.csv` (70.9â€¯MB) and `games.csv` (12.7â€¯MB); both are served via `/hookdata/*` by Vite/static builds.
- 2025-02-25: Reverted experimental HLTB Next.js integration; API endpoints still 404, parked integration.
- 2025-02-25: IGDB integration trimmed to cover-only placeholder; removed mocked TTB updates.
- 2025-02-25: Added Metacritic vendor pipeline (scripts/build-mc-index.ts, pps/web/src/data/metacriticIndex.ts, Dexie v8 with mcScore persistence, Library badge fallback). Latest pnpm build:vendor compiled 16,025 entries (from 20,022 rows) -> pps/web/public/hookdata/metacritic.index.json (~1.35 MB).
- 2025-02-25: Integrated RAWG metadata (API client, Dexie cache, shared cache helpers). GameCover now falls back Steam -> RAWG -> IGDB, Library cards/Editor surface RAWG genres+stores, and Settings documents data-source precedence.
- 2025-02-25: Rebuilt Metacritic vendor index via `build:vendor` (sniff delimiter=`,` BOM=false); processed 20,022 rows → 16,396 entries; artifact `apps/web/public/hookdata/metacritic.index.json` ≈1.22 MB.
- 2025-02-25: Added `scripts/csv/smartCsv.ts` + `smartCsv.sanity.ts` (edgecase titles) to normalize CSV ingestion for Metacritic builds; sanity run reports pass.
- 2025-02-25: Added Steam colon-delimited list support in importer and enabled triple-row concurrency in enrichment runner for faster processing.
