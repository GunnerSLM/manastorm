// MANASTORM — Card Database, Starter Decks, Consumables & Boss Encounters

const COLORS = ["G", "R", "B", "U", "W"];
const COLOR_NAMES = {
  G: "Green {G}",
  R: "Red {R}",
  B: "Black {B}",
  U: "Blue {U}",
  W: "White {W}",
  C: "Colorless {C}"
};

// Unified Player Life Constants
const START_LIFE = 20;
const MAX_LIFE = 30;
const VICTORY_HEAL = 4;

const CARD_DB = {
  // === BASIC, DUAL & FETCH LANDS ===
  forest: {
    id: "forest", name: "Forest", type: "Land", subtype: "Basic", color: "G",
    manaCost: "", produces: ["G"],
    rules: "Tap: Add {G} to your mana pool."
  },
  mountain: {
    id: "mountain", name: "Mountain", type: "Land", subtype: "Basic", color: "R",
    manaCost: "", produces: ["R"],
    rules: "Tap: Add {R} to your mana pool."
  },
  swamp: {
    id: "swamp", name: "Swamp", type: "Land", subtype: "Basic", color: "B",
    manaCost: "", produces: ["B"],
    rules: "Tap: Add {B} to your mana pool."
  },
  island: {
    id: "island", name: "Island", type: "Land", subtype: "Basic", color: "U",
    manaCost: "", produces: ["U"],
    rules: "Tap: Add {U} to your mana pool."
  },
  plains: {
    id: "plains", name: "Plains", type: "Land", subtype: "Basic", color: "W",
    manaCost: "", produces: ["W"],
    rules: "Tap: Add {W} to your mana pool."
  },
  stomping_ground: {
    id: "stomping_ground", name: "Stomping Ground", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["G", "R"],
    rules: "Dual Land — Tap: Add {G} or {R} (Auto-tapper saves this for missing colored pips!)."
  },
  steam_vents: {
    id: "steam_vents", name: "Steam Vents", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["U", "R"],
    rules: "Dual Land — Tap: Add {U} or {R}."
  },
  blood_crypt: {
    id: "blood_crypt", name: "Blood Crypt", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["B", "R"],
    rules: "Dual Land — Tap: Add {B} or {R}."
  },
  overgrown_tomb: {
    id: "overgrown_tomb", name: "Overgrown Tomb", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["B", "G"],
    rules: "Dual Land — Tap: Add {B} or {G}."
  },
  sacred_foundry: {
    id: "sacred_foundry", name: "Sacred Foundry", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["R", "W"],
    rules: "Dual Land — Tap: Add {R} or {W}."
  },
  hallowed_fountain: {
    id: "hallowed_fountain", name: "Hallowed Fountain", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["W", "U"],
    rules: "Dual Land — Tap: Add {W} or {U}."
  },
  wastes: {
    id: "wastes", name: "Wastes", type: "Land", subtype: "Basic", color: "C",
    manaCost: "", produces: ["C"],
    rules: "Tap: Add {C} to your mana pool."
  },
  evolving_wilds: {
    id: "evolving_wilds", name: "Evolving Wilds (Fetch)", type: "Land", subtype: "Fetch", color: "L",
    manaCost: "", produces: [], isFetch: true,
    rules: "Fetch Land: Choose a Basic Land from your Library, put it onto the battlefield untapped, thin your deck & trigger Landfall TWICE!"
  },

  // === GREEN CARDS ===
  llanowar_elves: {
    id: "llanowar_elves", name: "Llanowar Elves", type: "Creature", subtype: "Elf", color: "G",
    manaCost: "{G}",
    power: 1, toughness: 1, keywords: ["Mana +1 {G}"],
    etb: "mana_dork",
    rules: "Adds +1 {G} to your mana pool at the start of each of your turns."
  },
  lotus_cobra: {
    id: "lotus_cobra", name: "Lotus Cobra", type: "Creature", subtype: "Snake", color: "G",
    manaCost: "{1}{G}",
    power: 2, toughness: 1, keywords: ["Landfall"],
    landfall: "cobra",
    rules: "Landfall: Whenever a Land enters, add +1 Any-Color Treasure Mana & +1 Resonance."
  },
  scute_swarm: {
    id: "scute_swarm", name: "Scute Swarm", type: "Creature", subtype: "Insect", color: "G",
    manaCost: "{2}{G}",
    power: 2, toughness: 2, keywords: ["Landfall", "Haste"],
    landfall: "scute",
    rules: "Haste. Landfall: Create a 1/1 Haste Insect token (or clone Scute Swarm if you control 4+ Lands!)."
  },
  cultivate: {
    id: "cultivate", name: "Cultivate", type: "Sorcery", color: "G",
    manaCost: "{2}{G}",
    keywords: ["Ramp"],
    effect: "cultivate",
    rules: "Choose a Basic Land from your Library and put it onto the battlefield untapped (triggers Landfall!)."
  },
  rampaging_baloths: {
    id: "rampaging_baloths", name: "Rampaging Baloths", type: "Creature", subtype: "Beast", color: "G",
    manaCost: "{2}{G}{G}",
    power: 6, toughness: 6, keywords: ["Trample", "Haste", "Landfall"],
    landfall: "baloth",
    rules: "Trample, Haste. Landfall: Create a 4/4 Beast token with Trample."
  },
  overrun: {
    id: "overrun", name: "Overrun", type: "Sorcery", color: "G",
    manaCost: "{2}{G}{G}",
    keywords: ["Buff", "Trample"],
    effect: "overrun",
    rules: "All Creatures you control gain +3/+3 and Trample until end of turn, plus +2 Resonance!"
  },
  colossal_dreadmaw: {
    id: "colossal_dreadmaw", name: "Colossal Dreadmaw", type: "Creature", subtype: "Dinosaur", color: "G",
    manaCost: "{2}{G}{G}",
    power: 6, toughness: 6, keywords: ["Trample", "Haste"],
    rules: "Trample, Haste. Excess damage dealt to blockers hits the Boss!"
  },

  // === RED CARDS ===
  monastery_swiftspear: {
    id: "monastery_swiftspear", name: "Monastery Swiftspear", type: "Creature", subtype: "Monk", color: "R",
    manaCost: "{R}",
    power: 1, toughness: 2, keywords: ["Haste", "Prowess"],
    rules: "Haste. Prowess: Gains +2/+2 and +1 Resonance whenever you cast an Instant or Sorcery."
  },
  goblin_guide: {
    id: "goblin_guide", name: "Goblin Guide", type: "Creature", subtype: "Goblin", color: "R",
    manaCost: "{R}",
    power: 2, toughness: 2, keywords: ["Haste"],
    rules: "Haste. Ready to attack the turn it enters."
  },
  lightning_bolt: {
    id: "lightning_bolt", name: "Lightning Bolt", type: "Instant", color: "R",
    manaCost: "{R}",
    keywords: ["Burn"],
    effect: "bolt",
    rules: "Destroy target Enemy Blocker (or deal 4 Base Burn Damage to Boss) and gain +1 Resonance."
  },
  krenkos_command: {
    id: "krenkos_command", name: "Krenko's Command", type: "Sorcery", color: "R",
    manaCost: "{1}{R}",
    keywords: ["Tokens"],
    effect: "goblins_2",
    rules: "Create two 1/1 Red Goblin Creature tokens with Haste."
  },
  goblin_rabblemaster: {
    id: "goblin_rabblemaster", name: "Goblin Rabblemaster", type: "Creature", subtype: "Goblin", color: "R",
    manaCost: "{2}{R}",
    power: 2, toughness: 2, keywords: ["Haste", "Tribal"],
    etb: "rabble",
    rules: "Haste. ETB: Create a 1/1 Haste Goblin token and give all your Goblins +1/+1."
  },
  seething_song: {
    id: "seething_song", name: "Seething Song (Ritual)", type: "Instant", color: "R",
    manaCost: "{1}{R}",
    keywords: ["Ritual"],
    effect: "ritual",
    rules: "Add {R}{R}{R}{R} to your mana pool and gain +2 Resonance this turn!"
  },
  temur_battle_rage: {
    id: "temur_battle_rage", name: "Temur Battle Rage", type: "Instant", color: "R",
    manaCost: "{1}{R}",
    keywords: ["Double Strike", "Trample"],
    effect: "battle_rage",
    rules: "Target Creature gains Double Strike (2× Power) and Trample this turn!"
  },
  terror_of_the_peaks: {
    id: "terror_of_the_peaks", name: "Terror of the Peaks", type: "Creature", subtype: "Dragon", color: "R",
    manaCost: "{2}{R}{R}",
    power: 5, toughness: 4, keywords: ["Flying", "Haste"],
    etb: "terror",
    rules: "Flying, Haste. ETB: Deal 5 Burn Damage and gain +2 Resonance."
  },

  // === BLACK CARDS ===
  vampire_nighthawk: {
    id: "vampire_nighthawk", name: "Vampire Nighthawk", type: "Creature", subtype: "Vampire", color: "B",
    manaCost: "{1}{B}{B}",
    power: 2, toughness: 3, keywords: ["Flying", "Deathtouch", "Lifelink"],
    rules: "Flying, Deathtouch, Lifelink. Heals you and kills any blocker with 1 damage!"
  },
  dark_ritual: {
    id: "dark_ritual", name: "Dark Ritual", type: "Instant", color: "B",
    manaCost: "{B}",
    keywords: ["Ritual"],
    effect: "dark_ritual",
    rules: "Add {B}{B}{B} to your mana pool and +1 Resonance this turn."
  },
  village_rites: {
    id: "village_rites", name: "Village Rites", type: "Instant", color: "B",
    manaCost: "{B}",
    keywords: ["Sacrifice", "Draw 2"],
    effect: "village_rites",
    rules: "Sacrifice 1 of your weakest Creatures (if any): Draw 2 cards and gain +2 Resonance!"
  },
  reanimate: {
    id: "reanimate", name: "Reanimate", type: "Sorcery", color: "B",
    manaCost: "{B}",
    keywords: ["Graveyard"],
    effect: "reanimate",
    rules: "Return a Creature from your Graveyard to the Battlefield with Haste (or spawn a 3/3 Haste Fiend if empty)!"
  },
  archon_of_cruelty: {
    id: "archon_of_cruelty", name: "Archon of Cruelty", type: "Creature", subtype: "Archon", color: "B",
    manaCost: "{3}{B}{B}",
    power: 6, toughness: 6, keywords: ["Flying", "Lifelink", "Haste"],
    etb: "archon",
    rules: "Flying, Lifelink, Haste. ETB: Destroy an Enemy Blocker, Draw 1 card, and gain +2 Resonance."
  },

  // === BLUE CARDS (TEMPO, BOUNCE, FREEZE & PROWESS) ===
  delver_of_secrets: {
    id: "delver_of_secrets", name: "Aberrant Delver", type: "Creature", subtype: "Wizard", color: "U",
    manaCost: "{U}",
    power: 2, toughness: 2, keywords: ["Flying", "Haste", "Prowess"],
    rules: "Flying, Haste, Prowess. Gains +2/+2 and +1 Resonance whenever you cast an Instant or Sorcery."
  },
  unsummon: {
    id: "unsummon", name: "Vapor Snag (Bounce)", type: "Instant", color: "U",
    manaCost: "{U}",
    keywords: ["Bounce", "Draw 1"],
    effect: "unsummon",
    rules: "Tempo Bounce: Return target Enemy Blocker to the Æther, draw 1 card, and gain +1 Resonance."
  },
  ledger_shredder: {
    id: "ledger_shredder", name: "Ledger Shredder", type: "Creature", subtype: "Bird", color: "U",
    manaCost: "{1}{U}",
    power: 2, toughness: 3, keywords: ["Flying", "Haste", "Connive"],
    connive: true,
    rules: "Flying, Haste. Connive: Whenever you cast your 2nd+ Spell in a turn, gains +2/+2 permanently, draws 1 card, and adds +1 Resonance."
  },
  frost_breath: {
    id: "frost_breath", name: "Cryptic Freeze", type: "Instant", color: "U",
    manaCost: "{1}{U}",
    keywords: ["Freeze", "Draw 1"],
    effect: "frost_breath",
    rules: "Freeze up to 2 Enemy Blockers (they cannot block or retaliate this turn!), draw 1 card, and gain +2 Resonance."
  },
  brainstorm: {
    id: "brainstorm", name: "Expressive Iteration", type: "Sorcery", color: "U",
    manaCost: "{U}{R}",
    keywords: ["Draw 2", "Treasure"],
    effect: "draw_2",
    rules: "Draw 2 cards from your deck, add +1 Any-Color Treasure Mana, and gain +1 Resonance."
  },
  tempest_djinn: {
    id: "tempest_djinn", name: "Tempest Djinn", type: "Creature", subtype: "Djinn", color: "U",
    manaCost: "{1}{U}{U}",
    power: 4, toughness: 4, keywords: ["Flying", "Haste"],
    etb: "djinn",
    rules: "Flying, Haste. ETB: Bounce an Enemy Blocker and gain +2 Resonance (+1 extra Power per Blue/Dual Land you control)!"
  },

  // === WHITE CARDS (ANTHEM, LIFEGAIN & CONVOKE) ===
  esper_sentinel: {
    id: "esper_sentinel", name: "Esper Sentinel", type: "Creature", subtype: "Soldier", color: "W",
    manaCost: "{W}",
    power: 1, toughness: 2, keywords: ["Lifelink"],
    upkeep: "sentinel",
    rules: "Lifelink. At the start of each of your turns, draw 1 extra card and gain +1 Resonance."
  },
  swords_to_plowshares: {
    id: "swords_to_plowshares", name: "Swords to Plowshares", type: "Instant", color: "W",
    manaCost: "{W}",
    keywords: ["Exile", "Heal 3"],
    effect: "plowshares",
    rules: "Exile target Enemy Blocker, heal 3 Life, and gain +1 Resonance."
  },
  ajani_pridemate: {
    id: "ajani_pridemate", name: "Ajani's Pridemate", type: "Creature", subtype: "Soldier", color: "W",
    manaCost: "{1}{W}",
    power: 2, toughness: 2, keywords: ["Lifelink", "Haste"],
    onLifegain: "pridemate",
    rules: "Lifelink, Haste. Whenever you gain Life, permanently put +2/+2 on Ajani's Pridemate and gain +1 Resonance!"
  },
  unbreakable_formation: {
    id: "unbreakable_formation", name: "Unbreakable Formation", type: "Instant", color: "W",
    manaCost: "{1}{W}",
    keywords: ["Anthem", "Heal 3"],
    effect: "formation",
    rules: "Anthem: Permanently put +2/+2 on ALL Creatures you control, heal 3 Life, and gain +2 Resonance!"
  },
  heroic_reinforcements: {
    id: "heroic_reinforcements", name: "Heroic Reinforcements", type: "Sorcery", color: "W",
    manaCost: "{2}{R}{W}",
    keywords: ["Tokens", "Anthem"],
    effect: "reinforcements",
    rules: "Create two 1/1 White Soldier tokens with Haste, then all your Creatures gain +2/+2 and Haste this turn (+2 Resonance)!"
  },
  serra_angel: {
    id: "serra_angel", name: "Serra Angel", type: "Creature", subtype: "Angel", color: "W",
    manaCost: "{2}{W}{W}",
    power: 5, toughness: 5, keywords: ["Flying", "Lifelink", "Haste"],
    etb: "serra",
    rules: "Flying, Lifelink, Haste. ETB: Heal 4 Life and gain +2 Resonance."
  },
  sun_titan: {
    id: "sun_titan", name: "Sun Titan", type: "Creature", subtype: "Giant", color: "W",
    manaCost: "{3}{W}{W}",
    power: 6, toughness: 6, keywords: ["Trample", "Haste"],
    etb: "sun_titan",
    rules: "Trample, Haste. ETB: Return a Creature or Land from your Graveyard to the Battlefield and gain +2 Resonance!"
  },

  // === GOLGARI GRAVEYARD & UNDERGROWTH CARDS ({B}/{G}) ===
  stitchers_supplier: {
    id: "stitchers_supplier", name: "Stitcher's Supplier", type: "Creature", subtype: "Zombie", color: "B",
    manaCost: "{B}",
    power: 1, toughness: 1, keywords: ["Haste", "Dredge"],
    etb: "supplier",
    rules: "Haste. ETB: Mill 3 cards from your Library into your Graveyard and gain +1 Resonance!"
  },
  satyr_wayfinder: {
    id: "satyr_wayfinder", name: "Satyr Wayfinder", type: "Creature", subtype: "Satyr", color: "G",
    manaCost: "{1}{G}",
    power: 2, toughness: 1, keywords: ["Haste", "Dredge"],
    etb: "wayfinder",
    rules: "Haste. ETB: Mill 3 cards into your Graveyard, return a Land from your Graveyard to your Hand, and gain +1 Resonance!"
  },
  grisly_salvage: {
    id: "grisly_salvage", name: "Grisly Salvage", type: "Instant", color: "B",
    manaCost: "{B}{G}",
    keywords: ["Dredge", "Recur"],
    effect: "grisly_salvage",
    rules: "Mill 3 cards into your Graveyard, return the strongest Creature from your Graveyard to your Hand (or draw 1), and gain +2 Resonance!"
  },
  fiend_artisan: {
    id: "fiend_artisan", name: "Fiend Artisan", type: "Creature", subtype: "Nightmare", color: "B",
    manaCost: "{1}{B}{G}",
    power: 2, toughness: 2, keywords: ["Trample", "Haste"],
    etb: "fiend_artisan",
    rules: "Trample, Haste. Undergrowth ETB: Permanently gains +1/+1 for each Creature card in your Graveyard and +1 Resonance!"
  },
  izoni_undergrowth: {
    id: "izoni_undergrowth", name: "Spider Spawning", type: "Sorcery", color: "G",
    manaCost: "{2}{B}{G}",
    keywords: ["Tokens", "Undergrowth"],
    effect: "spider_spawning",
    rules: "Undergrowth: Create a 2/2 Green Spider token with Haste & Lifelink for each Creature in your Graveyard (min 2, max 5) and gain +2 Resonance!"
  },

  // === COLORLESS / ARTIFACT CONSTRUCT CARDS ({C}) ===
  vault_skirge: {
    id: "vault_skirge", name: "Vault Skirge", type: "Creature", subtype: "Construct", color: "C",
    manaCost: "{2}",
    power: 1, toughness: 1, keywords: ["Flying", "Lifelink", "Haste"],
    rules: "Flying, Lifelink, Haste. Swift metallic construct that drains life from above."
  },
  steel_overseer: {
    id: "steel_overseer", name: "Steel Overseer", type: "Creature", subtype: "Construct", color: "C",
    manaCost: "{3}",
    power: 1, toughness: 3, keywords: ["Anthem"],
    etb: "overseer",
    upkeep: "overseer",
    rules: "ETB & Start of Turn: Permanently put +1/+1 on ALL Creatures you control and gain +1 Resonance!"
  },
  arcbound_ravager: {
    id: "arcbound_ravager", name: "Arcbound Ravager", type: "Creature", subtype: "Construct", color: "C",
    manaCost: "{3}",
    power: 2, toughness: 2, keywords: ["Trample", "Haste"],
    etb: "modular",
    rules: "Trample, Haste. Modular ETB: Permanently gains +1/+1 for each other Creature you control and +1 Resonance!"
  },
  thoughtcast: {
    id: "thoughtcast", name: "Thoughtcast", type: "Instant", color: "C",
    manaCost: "{3}",
    keywords: ["Draw 2"],
    effect: "thoughtcast",
    rules: "Affinity Draw: Draw 2 cards and gain +1 Resonance."
  },
  thopter_foundry: {
    id: "thopter_foundry", name: "Thopter Foundry", type: "Sorcery", color: "C",
    manaCost: "{3}",
    keywords: ["Tokens", "Heal 2"],
    effect: "thopter_foundry",
    rules: "Create two 1/1 Colorless Thopter Construct tokens with Flying & Haste, heal 2 Life, and gain +1 Resonance."
  },
  galvanic_blast: {
    id: "galvanic_blast", name: "Galvanic Blast", type: "Instant", color: "C",
    manaCost: "{2}",
    keywords: ["Metalcraft", "Burn 5"],
    effect: "galvanic_blast",
    rules: "Metalcraft: Destroy target Enemy Blocker (or deal 5 Burn Damage to the Boss if no Blockers) and gain +1 Resonance!"
  },
  cyberdrive_awakener: {
    id: "cyberdrive_awakener", name: "Cyberdrive Awakener", type: "Sorcery", color: "C",
    manaCost: "{5}",
    keywords: ["Flying", "Overdrive"],
    effect: "cyberdrive",
    rules: "Overdrive: All Creatures you control gain +3/+3, Flying, and Haste this turn, plus +2 Resonance!"
  },
  myr_battlesphere: {
    id: "myr_battlesphere", name: "Myr Battlesphere", type: "Creature", subtype: "Construct", color: "C",
    manaCost: "{6}",
    power: 5, toughness: 5, keywords: ["Trample", "Haste"],
    etb: "battlesphere",
    rules: "Trample, Haste. ETB: Create three 1/1 Colorless Myr Construct tokens with Haste and gain +2 Resonance!"
  }
};

// === STARTER DECKS (40 CARDS: 17 LANDS + 23 SPELLS) ===
const STARTER_DECKS = [
  {
    id: "gruul",
    name: "Gruul Landfall & Stompy ({G}/{R})",
    badge: "Gruul Landfall ({G}/{R})",
    colors: ["G", "R"],
    startingRelic: "panharmonicon",
    desc: "Ramp Lands out of your 40-card deck with Fetch Lands & Cultivate, fix {G}/{R} pips with Stomping Grounds, and Trample over blockers.",
    cards: [
      ...Array(7).fill("forest"),
      ...Array(3).fill("mountain"),
      ...Array(3).fill("stomping_ground"),
      ...Array(4).fill("evolving_wilds"),
      ...Array(4).fill("llanowar_elves"),
      ...Array(3).fill("lotus_cobra"),
      ...Array(3).fill("scute_swarm"),
      ...Array(3).fill("cultivate"),
      ...Array(2).fill("rampaging_baloths"),
      ...Array(2).fill("colossal_dreadmaw"),
      ...Array(2).fill("overrun"),
      ...Array(2).fill("lightning_bolt"),
      ...Array(2).fill("goblin_rabblemaster")
    ]
  },
  {
    id: "red_storm",
    name: "Izzet Tempo & Prowess Storm ({U}/{R})",
    badge: "Izzet Tempo ({U}/{R})",
    colors: ["U", "R"],
    startingRelic: "impact_tremors",
    desc: "Bounce and freeze blockers with Vapor Snag & Cryptic Freeze, connive with Ledger Shredder, and chain rituals to supercharge Prowess flyers!",
    cards: [
      ...Array(5).fill("mountain"),
      ...Array(5).fill("island"),
      ...Array(3).fill("steam_vents"),
      ...Array(4).fill("evolving_wilds"),
      ...Array(3).fill("monastery_swiftspear"),
      ...Array(3).fill("delver_of_secrets"),
      ...Array(2).fill("ledger_shredder"),
      ...Array(3).fill("krenkos_command"),
      ...Array(2).fill("goblin_rabblemaster"),
      ...Array(2).fill("lightning_bolt"),
      ...Array(2).fill("unsummon"),
      ...Array(2).fill("frost_breath"),
      ...Array(2).fill("seething_song"),
      ...Array(2).fill("brainstorm")
    ]
  },
  {
    id: "rakdos_reanimator",
    name: "Rakdos Aristocrats & Reanimator ({B}/{R})",
    badge: "Rakdos Reanimator ({B}/{R})",
    colors: ["B", "R"],
    startingRelic: "cathars_crusade",
    desc: "Accelerate {B}{B}{B} with Dark Ritual, sacrifice tokens for cards, and cheat Archon of Cruelty ({3}{B}{B}) or Terror of the Peaks ({2}{R}{R}) into play.",
    cards: [
      ...Array(6).fill("swamp"),
      ...Array(4).fill("mountain"),
      ...Array(3).fill("blood_crypt"),
      ...Array(4).fill("evolving_wilds"),
      ...Array(3).fill("dark_ritual"),
      ...Array(3).fill("vampire_nighthawk"),
      ...Array(3).fill("village_rites"),
      ...Array(3).fill("reanimate"),
      ...Array(3).fill("archon_of_cruelty"),
      ...Array(3).fill("krenkos_command"),
      ...Array(3).fill("lightning_bolt"),
      ...Array(2).fill("terror_of_the_peaks")
    ]
  },
  {
    id: "boros_legion",
    name: "Boros Anthem & Lifegain Legion ({W}/{R})",
    badge: "Boros Legion ({W}/{R})",
    colors: ["W", "R"],
    startingRelic: "aetherflux_reservoir",
    desc: "Tax turns with Esper Sentinel ({W}), grow Ajani's Pridemate with lifegain, rally permanent Anthems with Unbreakable Formation, and recur threats with Sun Titan.",
    cards: [
      ...Array(7).fill("plains"),
      ...Array(4).fill("mountain"),
      ...Array(3).fill("sacred_foundry"),
      ...Array(3).fill("evolving_wilds"),
      ...Array(3).fill("esper_sentinel"),
      ...Array(3).fill("ajani_pridemate"),
      ...Array(2).fill("monastery_swiftspear"),
      ...Array(3).fill("swords_to_plowshares"),
      ...Array(2).fill("unbreakable_formation"),
      ...Array(2).fill("krenkos_command"),
      ...Array(3).fill("heroic_reinforcements"),
      ...Array(3).fill("serra_angel"),
      ...Array(2).fill("sun_titan")
    ]
  },
  {
    id: "golgari_graveyard",
    name: "Golgari Undergrowth & Dredge ({B}/{G})",
    badge: "Golgari Undergrowth ({B}/{G})",
    colors: ["B", "G"],
    startingRelic: "crucible_of_worlds",
    desc: "Self-mill creatures into your Graveyard with Stitcher's Supplier & Satyr Wayfinder to trigger Crucible of Worlds, scale massive Fiend Artisans, and reanimate Archon of Cruelty.",
    cards: [
      ...Array(5).fill("swamp"),
      ...Array(5).fill("forest"),
      ...Array(3).fill("overgrown_tomb"),
      ...Array(4).fill("evolving_wilds"),
      ...Array(3).fill("stitchers_supplier"),
      ...Array(3).fill("satyr_wayfinder"),
      ...Array(2).fill("llanowar_elves"),
      ...Array(3).fill("grisly_salvage"),
      ...Array(3).fill("fiend_artisan"),
      ...Array(3).fill("reanimate"),
      ...Array(2).fill("vampire_nighthawk"),
      ...Array(2).fill("izoni_undergrowth"),
      ...Array(2).fill("archon_of_cruelty")
    ]
  },
  {
    id: "artifact_constructs",
    name: "Colorless Affinity & Constructs ({C})",
    badge: "Artifact Constructs ({C})",
    colors: ["C"],
    startingRelic: "sol_ring",
    desc: "Hyper-accelerate with Sol Ring (+{C}{C}/turn) and pure Wastes, deploy modular Construct swarms with Steel Overseer & Thopter Foundry, and airlift your army with Cyberdrive Awakener.",
    cards: [
      ...Array(13).fill("wastes"),
      ...Array(4).fill("evolving_wilds"),
      ...Array(3).fill("vault_skirge"),
      ...Array(3).fill("steel_overseer"),
      ...Array(3).fill("arcbound_ravager"),
      ...Array(3).fill("thoughtcast"),
      ...Array(3).fill("thopter_foundry"),
      ...Array(3).fill("galvanic_blast"),
      ...Array(2).fill("cyberdrive_awakener"),
      ...Array(3).fill("myr_battlesphere")
    ]
  }
];

// === STARTER DECK AVAILABILITY (Separated from deck definitions so all decks remain testable) ===
const UNLOCKED_STARTER_DECK_IDS = new Set(STARTER_DECKS.map(d => d.id));

function isStarterDeckAvailable(deckOrId) {
  const id = typeof deckOrId === "string" ? deckOrId : deckOrId?.id;
  if (!id || !STARTER_DECKS.some(d => d.id === id)) return false;
  return UNLOCKED_STARTER_DECK_IDS.has(id);
}

function getAvailableStarterDecks() {
  return STARTER_DECKS.filter(d => isStarterDeckAvailable(d.id));
}

// === ARCANE SCROLL CONSUMABLES ===
const CONSUMABLE_DB = [
  {
    id: "black_lotus",
    name: "Black Lotus",
    icon: "🌸",
    cost: 4,
    desc: "Sacrifice: Add +3 Any-Color Wild Mana (★ Wild ×3) and +1 Resonance this turn."
  },
  {
    id: "time_walk",
    name: "Time Walk",
    icon: "⏳",
    cost: 5,
    desc: "Sacrifice: Gain +1 Extra Turn on the Turn Clock, draw 1 card, and gain +1 Resonance."
  },
  {
    id: "wrath_of_god",
    name: "Wrath of God",
    icon: "☀️",
    cost: 5,
    desc: "Sacrifice: Destroy ALL Enemy Blockers and gain +2 Resonance."
  },
  {
    id: "demonic_tutor",
    name: "Demonic Tutor",
    icon: "📜",
    cost: 4,
    desc: "Sacrifice: Search your Library for ANY card and put it directly into your Hand!"
  },
  {
    id: "wheel_of_fortune",
    name: "Wheel of Fortune",
    icon: "🎡",
    cost: 4,
    desc: "Sacrifice: Discard your Hand, draw 5 fresh cards, and gain +2 Resonance."
  }
];

// === ENCOUNTER / BOSS LADDER ===
const ENCOUNTERS = [
  {
    plane: 1, tier: "SKIRMISH WARD", name: "Garruk's Vanguard", maxLife: 78, reward: 7,
    rule: "WILD STAMPEDE: Spawns a 2/2 Beast Blocker each turn (spawns 2× Beasts on Turn 4+).",
    spawn: { name: "Timber Wolf", power: 2, toughness: 2, color: "G", keywords: [] },
    stampedeTurn: 4
  },
  {
    plane: 1, tier: "ELITE WARD", name: "Krenko, Mob Boss", maxLife: 120, reward: 8,
    rule: "GOBLIN HORDE: Spawns one 2/1 Goblin on odd turns, and DOUBLES spawns (two 2/1 Goblins) on even turns!",
    spawn: { name: "Goblin Raider", power: 2, toughness: 1, color: "R", keywords: [], count: 1 },
    evenTurnDoubleSpawn: true
  },
  {
    plane: 1, tier: "PLANAR OVERLORD", name: "Sheoldred, the Apocalypse", maxLife: 165, reward: 11,
    rule: "PHYREXIAN STAX: Spawns a 3/4 Blocker each turn, drains 1 Life/turn (healing Sheoldred), and halves direct Burn Power.",
    spawn: { name: "Phyrexian Obliterator", power: 3, toughness: 4, color: "B", keywords: [] },
    staxDrain: 1,
    burnResistance: 0.5
  },
  {
    plane: 2, tier: "SKIRMISH WARD", name: "Talrand, Sky Summoner", maxLife: 245, reward: 12,
    rule: "AERIAL WARD: Spawns a 3/3 Flying Drake each turn. Your first Instant/Sorcery each turn spawns a 1/1 Flying Drake unless you control 4+ Lands.",
    spawn: { name: "Sky Drake", power: 3, toughness: 3, color: "U", keywords: ["Flying"] },
    spellWardTax: true
  },
  {
    plane: 2, tier: "ELITE WARD", name: "Vorinclex, Monstrous Raider", maxLife: 380, reward: 14,
    rule: "IRON HIDE: Can't be burned (Direct Burn = 0)! Spawns a 4/4 Hydra each turn; surviving Blockers deal +1 extra damage.",
    spawn: { name: "Vorinclex Hydra", power: 4, toughness: 4, color: "G", keywords: [] },
    burnImmune: true,
    staxHideBonus: 1
  },
  {
    plane: 2, tier: "PLANAR OVERLORD", name: "Elesh Norn, Grand Cenobite", maxLife: 600, reward: 16,
    rule: "CENOBITE AURA: Spawns a 4/5 Praetor Guard each turn. Reinforces with an extra Guard on even turns!",
    spawn: { name: "Praetor Guard", power: 4, toughness: 4, color: "W", keywords: [], count: 1 },
    cenobiteAura: 1,
    evenTurnBonusGuard: 1
  }
];

// === BRANCHING ENCOUNTER MAP DEFINITIONS (Part 2) ===
const ROUTE_NODE_TYPES = {
  fight: { id: "fight", label: "Skirmish Ward", icon: "⚔️", badge: "FIGHT" },
  elite: { id: "elite", label: "Elite Ward", icon: "💀", badge: "ELITE" },
  boss: { id: "boss", label: "Planar Overlord", icon: "👑", badge: "BOSS" },
  shop: { id: "shop", label: "Blind Eternities Sanctum", icon: "🛒", badge: "SANCTUM" },
  rest: { id: "rest", label: "Planar Mana Leyline", icon: "🔥", badge: "REST SITE" },
  event: { id: "event", label: "Planar Rift Anomaly", icon: "✨", badge: "EVENT" }
};

const CAMPAIGN_ROUTE_NODES = [
  {
    id: "p1_start",
    step: 0,
    plane: 1,
    type: "fight",
    encounterIdx: 0,
    title: "Garruk's Vanguard",
    subtitle: "Plane 1 • Skirmish Ward",
    desc: "Break through Garruk's Beast vanguard to enter the Blind Eternities map.",
    next: ["p1_upper_rest", "p1_lower_event"]
  },
  {
    id: "p1_upper_rest",
    step: 1,
    plane: 1,
    type: "rest",
    encounterIdx: 0,
    title: "Emerald Leyline Camp",
    subtitle: "Plane 1 • Rest Site",
    desc: "Meditate at the leyline: Restore +10 Life and temper a Creature in your deck (+2/+2 & Foil).",
    healAmount: 10,
    buffBonus: 2,
    next: ["p1_elite"]
  },
  {
    id: "p1_lower_event",
    step: 1,
    plane: 1,
    type: "event",
    encounterIdx: 0,
    title: "Shrine of Forgotten Mana",
    subtitle: "Plane 1 • Planar Event",
    desc: "Channel the rift's unstable spark: Claim +$7 Gold, 1 Arcane Scroll, and +3 Life.",
    goldBonus: 7,
    healAmount: 3,
    grantScroll: true,
    next: ["p1_elite"]
  },
  {
    id: "p1_elite",
    step: 2,
    plane: 1,
    type: "elite",
    encounterIdx: 1,
    title: "Krenko, Mob Boss",
    subtitle: "Plane 1 • Elite Ward",
    desc: "Survive Krenko's doubling Goblin horde for an Elite Ward bounty.",
    next: ["p1_boss"]
  },
  {
    id: "p1_boss",
    step: 3,
    plane: 1,
    type: "boss",
    encounterIdx: 2,
    title: "Sheoldred, the Apocalypse",
    subtitle: "Plane 1 • Planar Overlord",
    desc: "Overcome Sheoldred's Phyrexian Stax to ascend to Plane 2.",
    next: ["p2_entry_fight", "p2_entry_shop"]
  },
  {
    id: "p2_entry_fight",
    step: 4,
    plane: 2,
    type: "fight",
    encounterIdx: 3,
    title: "Talrand, Sky Summoner",
    subtitle: "Plane 2 • Skirmish Ward",
    desc: "Challenge Talrand's aerial drake fleet for full combat bounty and Sanctum access.",
    next: ["p2_mid_elite", "p2_mid_rest"]
  },
  {
    id: "p2_entry_shop",
    step: 4,
    plane: 2,
    type: "shop",
    encounterIdx: 3,
    title: "Blind Eternities Caravan",
    subtitle: "Plane 2 • Sanctum Outpost",
    desc: "Bypass Talrand's sky patrol: Receive +$6 Caravan Stipend, +4 Life, and enter a Sanctum Shop directly.",
    goldBonus: 6,
    healAmount: 4,
    next: ["p2_mid_elite"]
  },
  {
    id: "p2_mid_elite",
    step: 5,
    plane: 2,
    type: "elite",
    encounterIdx: 4,
    title: "Vorinclex, Monstrous Raider",
    subtitle: "Plane 2 • Elite Ward",
    desc: "Smash through Vorinclex's Iron Hide before facing the Grand Cenobite.",
    next: ["p2_boss"]
  },
  {
    id: "p2_mid_rest",
    step: 5,
    plane: 2,
    type: "rest",
    encounterIdx: 4,
    title: "Sanctum of New Phyrexia",
    subtitle: "Plane 2 • Rest Site",
    desc: "Evade Vorinclex's hunting grounds: Restore +12 Life, gain +$5 Gold, and temper a Creature (+2/+2 & Foil).",
    healAmount: 12,
    goldBonus: 5,
    buffBonus: 2,
    next: ["p2_boss"]
  },
  {
    id: "p2_boss",
    step: 6,
    plane: 2,
    type: "boss",
    encounterIdx: 5,
    title: "Elesh Norn, Grand Cenobite",
    subtitle: "Plane 2 • Planar Overlord",
    desc: "Shatter Elesh Norn's Cenobite Aura to conquer Plane 2 and save the Multiverse!",
    next: []
  }
];
