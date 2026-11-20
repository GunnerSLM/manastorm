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
    id: "stomping_ground", name: "Cinderwood Basin", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["G", "R"],
    rules: "Dual Land — Tap: Add {G} or {R} (Auto-tapper saves this for missing colored pips!)."
  },
  steam_vents: {
    id: "steam_vents", name: "Stormvapor Rift", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["U", "R"],
    rules: "Dual Land — Tap: Add {U} or {R}."
  },
  blood_crypt: {
    id: "blood_crypt", name: "Ashblood Vault", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["B", "R"],
    rules: "Dual Land — Tap: Add {B} or {R}."
  },
  overgrown_tomb: {
    id: "overgrown_tomb", name: "Blightroot Barrow", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["B", "G"],
    rules: "Dual Land — Tap: Add {B} or {G}."
  },
  sacred_foundry: {
    id: "sacred_foundry", name: "Sunforge Crucible", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["R", "W"],
    rules: "Dual Land — Tap: Add {R} or {W}."
  },
  hallowed_fountain: {
    id: "hallowed_fountain", name: "Aetherwell Spring", type: "Land", subtype: "Dual", color: "L",
    manaCost: "", produces: ["W", "U"],
    rules: "Dual Land — Tap: Add {W} or {U}."
  },
  wastes: {
    id: "wastes", name: "Wastes", type: "Land", subtype: "Basic", color: "C",
    manaCost: "", produces: ["C"],
    rules: "Tap: Add {C} to your mana pool."
  },
  evolving_wilds: {
    id: "evolving_wilds", name: "Riftway Crossing (Fetch)", type: "Land", subtype: "Fetch", color: "L",
    manaCost: "", produces: [], isFetch: true,
    rules: "Fetch Land: Choose a Basic Land from your Library, put it onto the battlefield untapped, thin your deck & trigger Landfall TWICE!"
  },

  // === GREEN CARDS ===
  llanowar_elves: {
    id: "llanowar_elves", name: "Sylvan Leyweaver", type: "Creature", subtype: "Elf", color: "G",
    manaCost: "{G}",
    power: 1, toughness: 1, keywords: ["Mana +1 {G}"],
    etb: "mana_dork",
    rules: "Adds +1 {G} to your mana pool at the start of each of your turns."
  },
  lotus_cobra: {
    id: "lotus_cobra", name: "Leyline Viper", type: "Creature", subtype: "Snake", color: "G",
    manaCost: "{1}{G}",
    power: 2, toughness: 1, keywords: ["Landfall"],
    landfall: "cobra",
    rules: "Landfall: Whenever a Land enters, add +1 Any-Color Treasure Mana & +1 Resonance."
  },
  scute_swarm: {
    id: "scute_swarm", name: "Chitin Brood", type: "Creature", subtype: "Insect", color: "G",
    manaCost: "{2}{G}",
    power: 2, toughness: 2, keywords: ["Landfall", "Haste"],
    landfall: "scute",
    rules: "Haste. Landfall: Create a 1/1 Haste Insect token (or clone Chitin Brood if you control 4+ Lands!)."
  },
  cultivate: {
    id: "cultivate", name: "Leyline Surge", type: "Sorcery", color: "G",
    manaCost: "{2}{G}",
    keywords: ["Ramp"],
    effect: "cultivate",
    rules: "Choose a Basic Land from your Library and put it onto the battlefield untapped (triggers Landfall!)."
  },
  rampaging_baloths: {
    id: "rampaging_baloths", name: "Stampeding Behemoth", type: "Creature", subtype: "Beast", color: "G",
    manaCost: "{2}{G}{G}",
    power: 6, toughness: 6, keywords: ["Trample", "Haste", "Landfall"],
    landfall: "baloth",
    rules: "Trample, Haste. Landfall: Create a 4/4 Beast token with Trample."
  },
  briarback_colossus: {
    id: "briarback_colossus", name: "Briarback Colossus", type: "Creature", subtype: "Beast", color: "G",
    manaCost: "{3}{G}{G}",
    power: 5, toughness: 5, keywords: ["Trample", "Landfall"],
    landfall: "briarback",
    rules: "Trample. Landfall: This creature gets +2/+2 until end of turn."
  },
  overrun: {
    id: "overrun", name: "Primal Stampede", type: "Sorcery", color: "G",
    manaCost: "{2}{G}{G}",
    keywords: ["Buff", "Trample"],
    effect: "overrun",
    rules: "All Creatures you control gain +3/+3 and Trample until end of turn, plus +2 Resonance!"
  },
  colossal_dreadmaw: {
    id: "colossal_dreadmaw", name: "Riftjaw Titan", type: "Creature", subtype: "Dinosaur", color: "G",
    manaCost: "{2}{G}{G}",
    power: 6, toughness: 6, keywords: ["Trample", "Haste"],
    rules: "Trample, Haste. Excess damage dealt to blockers hits the Boss!"
  },

  // === RED CARDS ===
  monastery_swiftspear: {
    id: "monastery_swiftspear", name: "Cinderblade Adept", type: "Creature", subtype: "Monk", color: "R",
    manaCost: "{R}",
    power: 1, toughness: 2, keywords: ["Haste", "Prowess"],
    rules: "Haste. Prowess: Gains +2/+2 and +1 Resonance whenever you cast an Instant or Sorcery."
  },
  emberline_daredevil: {
    id: "emberline_daredevil", name: "Emberline Daredevil", type: "Creature", subtype: "Rogue", color: "R",
    manaCost: "{1}{R}",
    power: 2, toughness: 1, keywords: ["Haste", "Prowess"],
    rules: "Haste. Prowess: Gets +2/+2 and gains +1 Resonance whenever you cast an Instant or Sorcery."
  },
  furnace_arc: {
    id: "furnace_arc", name: "Furnace Arc", type: "Instant", color: "R",
    manaCost: "{1}{R}",
    keywords: ["Burn 3"],
    effect: "furnace_arc",
    rules: "Deal 3 Burn damage to the Boss and gain +1 Resonance."
  },
  goblin_guide: {
    id: "goblin_guide", name: "Ember Trailblazer", type: "Creature", subtype: "Goblin", color: "R",
    manaCost: "{R}",
    power: 2, toughness: 2, keywords: ["Haste"],
    rules: "Haste. Ready to attack the turn it enters."
  },
  lightning_bolt: {
    id: "lightning_bolt", name: "Aether Bolt", type: "Instant", color: "R",
    manaCost: "{R}",
    keywords: ["Burn"],
    effect: "bolt",
    rules: "Destroy target Enemy Blocker (or deal 4 Base Burn Damage to Boss) and gain +1 Resonance."
  },
  krenkos_command: {
    id: "krenkos_command", name: "Warband Rally", type: "Sorcery", color: "R",
    manaCost: "{1}{R}",
    keywords: ["Tokens"],
    effect: "goblins_2",
    rules: "Create two 1/1 Red Goblin Creature tokens with Haste."
  },
  goblin_rabblemaster: {
    id: "goblin_rabblemaster", name: "Cinder Warcaller", type: "Creature", subtype: "Goblin", color: "R",
    manaCost: "{2}{R}",
    power: 2, toughness: 2, keywords: ["Haste", "Tribal"],
    etb: "rabble",
    rules: "Haste. ETB: Create a 1/1 Haste Goblin token and give all your Goblins +1/+1."
  },
  seething_song: {
    id: "seething_song", name: "Pyre Chant (Ritual)", type: "Instant", color: "R",
    manaCost: "{1}{R}",
    keywords: ["Ritual"],
    effect: "ritual",
    rules: "Add {R}{R}{R}{R} to your mana pool and gain +2 Resonance this turn!"
  },
  temur_battle_rage: {
    id: "temur_battle_rage", name: "Stormfury Cleave", type: "Instant", color: "R",
    manaCost: "{1}{R}",
    keywords: ["Double Strike", "Trample"],
    effect: "battle_rage",
    rules: "Target Creature gains Double Strike (2× Power) and Trample this turn!"
  },
  terror_of_the_peaks: {
    id: "terror_of_the_peaks", name: "Cinderpeak Wyrm", type: "Creature", subtype: "Dragon", color: "R",
    manaCost: "{2}{R}{R}",
    power: 5, toughness: 4, keywords: ["Flying", "Haste"],
    etb: "terror",
    rules: "Flying, Haste. ETB: Deal 5 Burn Damage and gain +2 Resonance."
  },

  // === BLACK CARDS ===
  vampire_nighthawk: {
    id: "vampire_nighthawk", name: "Duskfang Stalker", type: "Creature", subtype: "Vampire", color: "B",
    manaCost: "{1}{B}{B}",
    power: 2, toughness: 3, keywords: ["Flying", "Deathtouch", "Lifelink"],
    rules: "Flying, Deathtouch, Lifelink. Heals you and kills any blocker with 1 damage!"
  },
  dark_ritual: {
    id: "dark_ritual", name: "Void Offering", type: "Instant", color: "B",
    manaCost: "{B}",
    keywords: ["Ritual"],
    effect: "dark_ritual",
    rules: "Add {B}{B}{B} to your mana pool and +1 Resonance this turn."
  },
  ashen_bargain: {
    id: "ashen_bargain", name: "Ashen Bargain", type: "Instant", color: "B",
    manaCost: "{B}",
    lifeCost: 2,
    keywords: ["Draw 2", "Life Cost"],
    effect: "ashen_bargain",
    rules: "Pay 2 Life: Draw 2 cards and gain +1 Resonance. You must have more than 2 Life to cast this."
  },
  village_rites: {
    id: "village_rites", name: "Grim Tithe", type: "Instant", color: "B",
    manaCost: "{B}",
    keywords: ["Sacrifice", "Draw 2"],
    effect: "village_rites",
    rules: "Sacrifice 1 of your weakest Creatures (if any): Draw 2 cards and gain +2 Resonance!"
  },
  reanimate: {
    id: "reanimate", name: "Rift Revival", type: "Sorcery", color: "B",
    manaCost: "{B}",
    keywords: ["Graveyard"],
    effect: "reanimate",
    rules: "Return a Creature from your Graveyard to the Battlefield with Haste (or spawn a 3/3 Haste Fiend if empty)!"
  },
  archon_of_cruelty: {
    id: "archon_of_cruelty", name: "Dread Sovereign", type: "Creature", subtype: "Archon", color: "B",
    manaCost: "{3}{B}{B}",
    power: 6, toughness: 6, keywords: ["Flying", "Lifelink", "Haste"],
    etb: "archon",
    rules: "Flying, Lifelink, Haste. ETB: Destroy an Enemy Blocker, Draw 1 card, and gain +2 Resonance."
  },

  // === BLUE CARDS (TEMPO, BOUNCE, FREEZE & PROWESS) ===
  delver_of_secrets: {
    id: "delver_of_secrets", name: "Riftbound Seeker", type: "Creature", subtype: "Wizard", color: "U",
    manaCost: "{U}",
    power: 2, toughness: 2, keywords: ["Flying", "Haste", "Prowess"],
    rules: "Flying, Haste, Prowess. Gains +2/+2 and +1 Resonance whenever you cast an Instant or Sorcery."
  },
  unsummon: {
    id: "unsummon", name: "Aether Gale (Bounce)", type: "Instant", color: "U",
    manaCost: "{U}",
    keywords: ["Bounce", "Draw 1"],
    effect: "unsummon",
    rules: "Tempo Bounce: Return target Enemy Blocker to the Æther, draw 1 card, and gain +1 Resonance."
  },
  ledger_shredder: {
    id: "ledger_shredder", name: "Cipher Owl", type: "Creature", subtype: "Bird", color: "U",
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
  tideglass_sentry: {
    id: "tideglass_sentry", name: "Tideglass Sentry", type: "Creature", subtype: "Scout", color: "U",
    manaCost: "{1}{U}",
    power: 1, toughness: 3, keywords: ["Flying"],
    etb: "tideglass",
    rules: "Flying. ETB: Freeze the strongest Enemy Blocker this turn and draw 1 card."
  },
  slipstream_reversal: {
    id: "slipstream_reversal", name: "Slipstream Reversal", type: "Instant", color: "U",
    manaCost: "{1}{U}",
    keywords: ["Bounce"],
    effect: "slipstream_reversal",
    rules: "Return target Enemy Blocker to the Æther and gain +2 Resonance."
  },
  brainstorm: {
    id: "brainstorm", name: "Aether Insight", type: "Sorcery", color: "U",
    manaCost: "{U}{R}",
    keywords: ["Draw 2", "Treasure"],
    effect: "draw_2",
    rules: "Draw 2 cards from your deck, add +1 Any-Color Treasure Mana, and gain +1 Resonance."
  },
  tempest_djinn: {
    id: "tempest_djinn", name: "Stormcrest Djinn", type: "Creature", subtype: "Djinn", color: "U",
    manaCost: "{1}{U}{U}",
    power: 4, toughness: 4, keywords: ["Flying", "Haste"],
    etb: "djinn",
    rules: "Flying, Haste. ETB: Bounce an Enemy Blocker and gain +2 Resonance (+1 extra Power per Blue/Dual Land you control)!"
  },

  // === WHITE CARDS (ANTHEM, LIFEGAIN & RADIANCE) ===
  esper_sentinel: {
    id: "esper_sentinel", name: "Aetherbound Warden", type: "Creature", subtype: "Soldier", color: "W",
    manaCost: "{W}",
    power: 1, toughness: 2, keywords: ["Lifelink"],
    upkeep: "sentinel",
    rules: "Lifelink. At the start of each of your turns, draw 1 extra card and gain +1 Resonance."
  },
  swords_to_plowshares: {
    id: "swords_to_plowshares", name: "Radiant Banish", type: "Instant", color: "W",
    manaCost: "{W}",
    keywords: ["Exile", "Heal 3"],
    effect: "plowshares",
    rules: "Exile target Enemy Blocker, heal 3 Life, and gain +1 Resonance."
  },
  ajani_pridemate: {
    id: "ajani_pridemate", name: "Sunblade Vanguard", type: "Creature", subtype: "Soldier", color: "W",
    manaCost: "{1}{W}",
    power: 2, toughness: 2, keywords: ["Lifelink", "Haste"],
    onLifegain: "pridemate",
    rules: "Lifelink, Haste. Whenever you gain Life, permanently put +2/+2 on Sunblade Vanguard and gain +1 Resonance!"
  },
  unbreakable_formation: {
    id: "unbreakable_formation", name: "Aegis Phalanx", type: "Instant", color: "W",
    manaCost: "{1}{W}",
    keywords: ["Anthem", "Heal 3"],
    effect: "formation",
    rules: "Anthem: Permanently put +2/+2 on ALL Creatures you control, heal 3 Life, and gain +2 Resonance!"
  },
  heroic_reinforcements: {
    id: "heroic_reinforcements", name: "Dawnbreak Charge", type: "Sorcery", color: "W",
    manaCost: "{2}{R}{W}",
    keywords: ["Tokens", "Anthem"],
    effect: "reinforcements",
    rules: "Create two 1/1 White Soldier tokens with Haste, then all your Creatures gain +2/+2 and Haste this turn (+2 Resonance)!"
  },
  dawnbell_acolyte: {
    id: "dawnbell_acolyte", name: "Dawnbell Acolyte", type: "Creature", subtype: "Cleric", color: "W",
    manaCost: "{1}{W}",
    power: 1, toughness: 3, keywords: ["Lifelink"],
    etb: "dawnbell",
    rules: "Lifelink. ETB: Heal 2 Life and gain +1 Resonance."
  },
  sunlit_rally: {
    id: "sunlit_rally", name: "Sunlit Rally", type: "Sorcery", color: "W",
    manaCost: "{2}{W}",
    keywords: ["Tokens"],
    effect: "sunlit_rally",
    rules: "Create two 1/1 White Soldier tokens with Haste and gain +1 Resonance."
  },
  serra_angel: {
    id: "serra_angel", name: "Solstice Seraph", type: "Creature", subtype: "Angel", color: "W",
    manaCost: "{2}{W}{W}",
    power: 5, toughness: 5, keywords: ["Flying", "Lifelink", "Haste"],
    etb: "serra",
    rules: "Flying, Lifelink, Haste. ETB: Heal 4 Life and gain +2 Resonance."
  },
  sun_titan: {
    id: "sun_titan", name: "Solar Colossus", type: "Creature", subtype: "Giant", color: "W",
    manaCost: "{3}{W}{W}",
    power: 6, toughness: 6, keywords: ["Trample", "Haste"],
    etb: "sun_titan",
    rules: "Trample, Haste. ETB: Return a Creature or Land from your Graveyard to the Battlefield and gain +2 Resonance!"
  },

  // === ROTBLOOM GRAVEYARD & UNDERGROWTH CARDS ({B}/{G}) ===
  stitchers_supplier: {
    id: "stitchers_supplier", name: "Blight Harvester", type: "Creature", subtype: "Zombie", color: "B",
    manaCost: "{B}",
    power: 1, toughness: 1, keywords: ["Haste", "Dredge"],
    etb: "supplier",
    rules: "Haste. ETB: Mill 3 cards from your Library into your Graveyard and gain +1 Resonance!"
  },
  satyr_wayfinder: {
    id: "satyr_wayfinder", name: "Grove Pathbreaker", type: "Creature", subtype: "Satyr", color: "G",
    manaCost: "{1}{G}",
    power: 2, toughness: 1, keywords: ["Haste", "Dredge"],
    etb: "wayfinder",
    rules: "Haste. ETB: Mill 3 cards into your Graveyard, return a Land from your Graveyard to your Hand, and gain +1 Resonance!"
  },
  mosswake_forager: {
    id: "mosswake_forager", name: "Mosswake Forager", type: "Creature", subtype: "Scout", color: "G",
    manaCost: "{1}{G}",
    power: 2, toughness: 2, keywords: ["Dredge"],
    etb: "mosswake",
    rules: "ETB: Mill 2 cards, return a Land from your Graveyard to your Hand, and gain +1 Resonance."
  },
  grisly_salvage: {
    id: "grisly_salvage", name: "Graveyard Plunder", type: "Instant", color: "B",
    manaCost: "{B}{G}",
    keywords: ["Dredge", "Recur"],
    effect: "grisly_salvage",
    rules: "Mill 3 cards into your Graveyard, return the strongest Creature from your Graveyard to your Hand (or draw 1), and gain +2 Resonance!"
  },
  fiend_artisan: {
    id: "fiend_artisan", name: "Marrow Sculptor", type: "Creature", subtype: "Nightmare", color: "B",
    manaCost: "{1}{B}{G}",
    power: 2, toughness: 2, keywords: ["Trample", "Haste"],
    etb: "fiend_artisan",
    rules: "Trample, Haste. Undergrowth ETB: Permanently gains +1/+1 for each Creature card in your Graveyard and +1 Resonance!"
  },
  izoni_undergrowth: {
    id: "izoni_undergrowth", name: "Brood Awakening", type: "Sorcery", color: "G",
    manaCost: "{2}{B}{G}",
    keywords: ["Tokens", "Undergrowth"],
    effect: "spider_spawning",
    rules: "Undergrowth: Create a 2/2 Green Spider token with Haste & Lifelink for each Creature in your Graveyard (min 2, max 5) and gain +2 Resonance!"
  },
  floodplain_cartographer: {
    id: "floodplain_cartographer", name: "Floodplain Cartographer", type: "Creature", subtype: "Scout", color: "G",
    manaCost: "{G}{U}",
    power: 2, toughness: 2, keywords: ["Landfall"],
    landfall: "cartographer",
    rules: "Landfall: This creature gets +1/+1 until end of turn and you draw a card."
  },

  // === COLORLESS / AETHERFORGE CONSTRUCT CARDS ({C}) ===
  vault_skirge: {
    id: "vault_skirge", name: "Shardwing Drone", type: "Creature", subtype: "Construct", color: "C",
    manaCost: "{2}",
    power: 1, toughness: 1, keywords: ["Flying", "Lifelink", "Haste"],
    rules: "Flying, Lifelink, Haste. Swift metallic construct that drains life from above."
  },
  steel_overseer: {
    id: "steel_overseer", name: "Clockwork Regent", type: "Creature", subtype: "Construct", color: "C",
    manaCost: "{3}",
    power: 1, toughness: 3, keywords: ["Anthem"],
    etb: "overseer",
    upkeep: "overseer",
    rules: "ETB & Start of Turn: Permanently put +1/+1 on ALL Creatures you control and gain +1 Resonance!"
  },
  arcbound_ravager: {
    id: "arcbound_ravager", name: "Aethercore Crusher", type: "Creature", subtype: "Construct", color: "C",
    manaCost: "{3}",
    power: 2, toughness: 2, keywords: ["Trample", "Haste"],
    etb: "modular",
    rules: "Trample, Haste. Modular ETB: Permanently gains +1/+1 for each other Creature you control and +1 Resonance!"
  },
  thoughtcast: {
    id: "thoughtcast", name: "Mindstream Surge", type: "Instant", color: "C",
    manaCost: "{3}",
    keywords: ["Draw 2"],
    effect: "thoughtcast",
    rules: "Affinity Draw: Draw 2 cards and gain +1 Resonance."
  },
  thopter_foundry: {
    id: "thopter_foundry", name: "Skyforge Assembly", type: "Sorcery", color: "C",
    manaCost: "{3}",
    keywords: ["Tokens", "Heal 2"],
    effect: "thopter_foundry",
    rules: "Create two 1/1 Colorless Drone Construct tokens with Flying & Haste, heal 2 Life, and gain +1 Resonance."
  },
  galvanic_blast: {
    id: "galvanic_blast", name: "Arc Discharge", type: "Instant", color: "C",
    manaCost: "{2}",
    keywords: ["Metalcraft", "Burn 5"],
    effect: "galvanic_blast",
    rules: "Metalcraft: Destroy target Enemy Blocker (or deal 5 Burn Damage to the Boss if no Blockers) and gain +1 Resonance!"
  },
  cyberdrive_awakener: {
    id: "cyberdrive_awakener", name: "Aetherdrive Sovereign", type: "Sorcery", color: "C",
    manaCost: "{5}",
    keywords: ["Flying", "Overdrive"],
    effect: "cyberdrive",
    rules: "Overdrive: All Creatures you control gain +3/+3, Flying, and Haste this turn, plus +2 Resonance!"
  },
  myr_battlesphere: {
    id: "myr_battlesphere", name: "Aetherium Juggernaut", type: "Creature", subtype: "Construct", color: "C",
    manaCost: "{6}",
    power: 5, toughness: 5, keywords: ["Trample", "Haste"],
    etb: "battlesphere",
    rules: "Trample, Haste. ETB: Create three 1/1 Colorless Shard Construct tokens with Haste and gain +2 Resonance!"
  }
};

const CARD_EVOLUTION_COST = 4;
const CARD_EVOLUTION_OPTIONS = [
  {
    id: "veteran",
    name: "Veteran's Might",
    desc: "Permanently gain +3/+3.",
    powerBonus: 3,
    toughnessBonus: 3,
    keywords: []
  },
  {
    id: "trampler",
    name: "Predator's Instinct",
    desc: "Permanently gain +1/+1 and Trample.",
    powerBonus: 1,
    toughnessBonus: 1,
    keywords: ["Trample"]
  }
];

function getCardEvolutionDefinition(evolutionId) {
  return CARD_EVOLUTION_OPTIONS.find(option => option.id === evolutionId) || null;
}

function isValidCardEvolution(card, evolutionId) {
  return Boolean(card && card.type === "Creature" && getCardEvolutionDefinition(evolutionId));
}

function isValidCardEvolutionState(card, cardState) {
  const option = cardState && getCardEvolutionDefinition(cardState.evolutionId);
  return Boolean(
    option &&
    isValidCardEvolution(card, option.id) &&
    Number(cardState.permPowerBonus) >= option.powerBonus &&
    Number(cardState.permToughnessBonus) >= option.toughnessBonus &&
    option.keywords.every(keyword => Array.isArray(cardState.keywords) && cardState.keywords.includes(keyword))
  );
}

// === LIVING LANDS: ENHANCEMENTS & LAND FUSION ===
const LAND_ENHANCEMENT_COST = 4;
const LAND_ENHANCEMENT_OPTIONS = [
  {
    id: "volcanic",
    name: "Volcanic",
    icon: "🌋",
    desc: "When tapped: Deal 1 damage to an enemy blocker (destroying it if lethal), or +1 Burn Power if none."
  },
  {
    id: "resonant",
    name: "Resonant",
    icon: "⚡",
    desc: "When tapped: Gain +1 Resonance this turn."
  },
  {
    id: "blighted",
    name: "Blighted",
    icon: "🪦",
    desc: "When tapped: Mill the top card of your Library into your Graveyard."
  },
  {
    id: "prismatic",
    name: "Prismatic",
    icon: "🌈",
    desc: "Taps for ANY color of mana and counts as all 5 colors for Prismatic Court."
  }
];

function getLandEnhancementDefinition(enhancementId) {
  return LAND_ENHANCEMENT_OPTIONS.find(option => option.id === enhancementId) || null;
}

function isValidLandEnhancement(card, enhancementId) {
  return Boolean(card && card.type === "Land" && !card.isFetch && getLandEnhancementDefinition(enhancementId));
}

function isValidLandEnhancementState(card, cardState) {
  return Boolean(cardState && cardState.landEnhancement && isValidLandEnhancement(card, cardState.landEnhancement));
}

const LAND_FUSION_COST = 4;
const FUSED_LAND_VALID_COLORS = ["B", "C", "G", "R", "U", "W"];
const FUSED_LAND_RECIPES = {
  G_G: { name: "Primeval Canopy", passiveId: "resonance_1", passiveDesc: "gain +1 Resonance" },
  R_R: { name: "Caldera Core", passiveId: "burn_2", passiveDesc: "deal +2 Burn Power" },
  B_B: { name: "Dreadmire Depths", passiveId: "mill_resonance", passiveDesc: "Mill 1 and gain +1 Resonance" },
  U_U: { name: "Abyssal Spire", passiveId: "resonance_1", passiveDesc: "gain +1 Resonance" },
  W_W: { name: "Radiant Citadel", passiveId: "heal_resonance", passiveDesc: "Heal 1 Life and gain +1 Resonance" },
  C_C: { name: "Aether Monolith", passiveId: "burn_2", passiveDesc: "deal +2 Burn Power" },
  B_G: { name: "Rotbloom Bog", passiveId: "mill_resonance", passiveDesc: "Mill 1 and gain +1 Resonance" },
  B_R: { name: "Ashvein Crucible", passiveId: "mill_burn", passiveDesc: "Mill 1 and deal +1 Burn Power" },
  B_U: { name: "Gloomtide Trench", passiveId: "mill_resonance", passiveDesc: "Mill 1 and gain +1 Resonance" },
  B_W: { name: "Eclipse Reliquary", passiveId: "heal_mill", passiveDesc: "Heal 1 Life and Mill 1" },
  G_R: { name: "Cinderroot Caldera", passiveId: "burn_resonance", passiveDesc: "deal +1 Burn Power and gain +1 Resonance" },
  G_U: { name: "Tidewood Nexus", passiveId: "resonance_1", passiveDesc: "gain +1 Resonance" },
  G_W: { name: "Verdant Sanctum", passiveId: "heal_resonance", passiveDesc: "Heal 1 Life and gain +1 Resonance" },
  R_U: { name: "Stormspire Conduit", passiveId: "burn_resonance", passiveDesc: "deal +1 Burn Power and gain +1 Resonance" },
  R_W: { name: "Sunforge Bastion", passiveId: "heal_burn", passiveDesc: "Heal 1 Life and deal +1 Burn Power" },
  U_W: { name: "Aetherfrost Spire", passiveId: "heal_resonance", passiveDesc: "Heal 1 Life and gain +1 Resonance" }
};

function createFusedLandDefinition(colA, colB) {
  if (!FUSED_LAND_VALID_COLORS.includes(colA) || !FUSED_LAND_VALID_COLORS.includes(colB)) return null;
  const sorted = [colA, colB].sort();
  const [a, b] = sorted;
  const key = `${a}_${b}`;
  const isMono = a === b;
  const recipe = FUSED_LAND_RECIPES[key] || {
    name: `Aether Conduit (${a}/${b})`,
    passiveId: "burn_2",
    passiveDesc: "deal +2 Burn Power"
  };
  const produces = isMono ? [a] : [a, b];
  const manaText = isMono ? `{${a}}` : `{${a}} or {${b}}`;
  return {
    id: `fused_${key}`,
    name: recipe.name,
    type: "Land",
    subtype: "Fused",
    color: isMono ? a : "L",
    manaCost: "",
    produces,
    keywords: [],
    fused: true,
    fusedColors: [a, b],
    fusedPassive: recipe.passiveId,
    rules: `Fused Land — Tap: Add ${manaText} and ${recipe.passiveDesc}.`
  };
}

function normalizeFusedLandDefinition(raw) {
  if (!raw || typeof raw !== "object" || raw.fused !== true) return null;
  if (!Array.isArray(raw.fusedColors) || raw.fusedColors.length !== 2) return null;
  const canonical = createFusedLandDefinition(raw.fusedColors[0], raw.fusedColors[1]);
  if (!canonical || (raw.id && raw.id !== canonical.id)) return null;
  return canonical;
}

// === STARTER DECKS (40 CARDS: 17 LANDS + 23 SPELLS) ===
const STARTER_DECKS = [
  {
    id: "gruul",
    name: "Wildfire Landfall & Stompy ({G}/{R})",
    badge: "Wildfire Landfall ({G}/{R})",
    colors: ["G", "R"],
    startingRelic: "panharmonicon",
    desc: "Ramp Lands out of your 40-card deck with Fetch Lands & Leyline Surge, fix {G}/{R} pips with Cinderwood Basin, and Trample over blockers.",
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
    name: "Stormspire Tempo & Prowess ({U}/{R})",
    badge: "Stormspire Tempo ({U}/{R})",
    colors: ["U", "R"],
    startingRelic: "impact_tremors",
    desc: "Bounce and freeze blockers with Aether Gale & Cryptic Freeze, connive with Cipher Owl, and chain rituals to supercharge Prowess flyers!",
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
    name: "Ashvein Sacrifice & Revival ({B}/{R})",
    badge: "Ashvein Revival ({B}/{R})",
    colors: ["B", "R"],
    startingRelic: "cathars_crusade",
    desc: "Accelerate {B}{B}{B} with Void Offering, sacrifice tokens for cards, and cheat Dread Sovereign ({3}{B}{B}) or Cinderpeak Wyrm ({2}{R}{R}) into play.",
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
    name: "Sunforge Anthem & Lifegain ({W}/{R})",
    badge: "Sunforge Legion ({W}/{R})",
    colors: ["W", "R"],
    startingRelic: "aetherflux_reservoir",
    desc: "Draw ahead with Aetherbound Warden ({W}), grow Sunblade Vanguard with lifegain, rally permanent Anthems with Aegis Phalanx, and recur threats with Solar Colossus.",
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
    name: "Rotbloom Undergrowth & Dredge ({B}/{G})",
    badge: "Rotbloom Dredge ({B}/{G})",
    colors: ["B", "G"],
    startingRelic: "crucible_of_worlds",
    desc: "Self-mill creatures into your Graveyard with Blight Harvester & Grove Pathbreaker to trigger Worldshard Crucible, scale Marrow Sculptor, and revive Dread Sovereign.",
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
    name: "Aetherforge Constructs ({C})",
    badge: "Aetherforge Constructs ({C})",
    colors: ["C"],
    startingRelic: "sol_ring",
    desc: "Hyper-accelerate with Solar Conduit (+{C}{C}/turn) and pure Wastes, deploy modular Construct swarms with Clockwork Regent & Skyforge Assembly, and airlift your army with Aetherdrive Sovereign.",
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
  },
  {
    id: "simic_tidecallers",
    name: "Tidewood Landfall & Tempo ({G}/{U})",
    badge: "Tidewood Landfall ({G}/{U})",
    colors: ["G", "U"],
    startingRelic: "crucible_of_worlds",
    desc: "Build a tide of Landfall creatures, then use blue tempo spells to freeze or bounce blockers while your board grows.",
    cards: [
      ...Array(7).fill("forest"),
      ...Array(5).fill("island"),
      ...Array(5).fill("evolving_wilds"),
      ...Array(3).fill("llanowar_elves"),
      ...Array(3).fill("lotus_cobra"),
      ...Array(3).fill("scute_swarm"),
      ...Array(2).fill("cultivate"),
      ...Array(2).fill("rampaging_baloths"),
      ...Array(2).fill("satyr_wayfinder"),
      ...Array(2).fill("ledger_shredder"),
      ...Array(2).fill("frost_breath"),
      ...Array(2).fill("unsummon"),
      ...Array(2).fill("colossal_dreadmaw")
    ]
  }
];

// === STARTER DECK AVAILABILITY (Separated from deck definitions so all decks remain testable) ===
const STARTER_DECK_UNLOCK_REQUIREMENTS = {
  simic_tidecallers: {
    campaignClears: 1,
    description: "Clear any campaign"
  }
};
const UNLOCKED_STARTER_DECK_IDS = new Set(
  STARTER_DECKS.filter(deck => !STARTER_DECK_UNLOCK_REQUIREMENTS[deck.id]).map(deck => deck.id)
);

function isStarterDeckAvailable(deckOrId) {
  const id = typeof deckOrId === "string" ? deckOrId : deckOrId?.id;
  if (!id || !STARTER_DECKS.some(d => d.id === id)) return false;
  if (UNLOCKED_STARTER_DECK_IDS.has(id)) return true;
  return typeof isStarterDeckUnlockedInProfile === "function" && isStarterDeckUnlockedInProfile(id);
}

function getAvailableStarterDecks() {
  return STARTER_DECKS.filter(d => isStarterDeckAvailable(d.id));
}

// === ARCANE SCROLL CONSUMABLES ===
const CONSUMABLE_DB = [
  {
    id: "black_lotus",
    name: "Aether Bloom",
    icon: "🌸",
    cost: 4,
    desc: "Sacrifice: Add +3 Any-Color Wild Mana (★ Wild ×3) and +1 Resonance this turn."
  },
  {
    id: "time_walk",
    name: "Chrono Rift",
    icon: "⏳",
    cost: 5,
    desc: "Sacrifice: Gain +1 Extra Turn on the Turn Clock, draw 1 card, and gain +1 Resonance."
  },
  {
    id: "wrath_of_god",
    name: "Solar Cataclysm",
    icon: "☀️",
    cost: 5,
    desc: "Sacrifice: Destroy ALL Enemy Blockers and gain +2 Resonance."
  },
  {
    id: "demonic_tutor",
    name: "Void Codex",
    icon: "📜",
    cost: 4,
    desc: "Sacrifice: Search your Library for ANY card and put it directly into your Hand!"
  },
  {
    id: "wheel_of_fortune",
    name: "Tempest Cycle",
    icon: "🎡",
    cost: 4,
    desc: "Sacrifice: Discard your Hand, draw 5 fresh cards, and gain +2 Resonance."
  }
];

// === ENCOUNTER / BOSS LADDER ===
const ENCOUNTERS = [
  {
    plane: 1, tier: "SKIRMISH WARD", name: "Thornback Warden", maxLife: 78, reward: 7,
    rule: "WILD STAMPEDE: Spawns a 2/2 Beast Blocker each turn (spawns 2× Beasts on Turn 4+).",
    spawn: { name: "Briar Wolf", power: 2, toughness: 2, color: "G", keywords: [] },
    stampedeTurn: 4
  },
  {
    plane: 1, tier: "ELITE WARD", name: "Cinderking Krag", maxLife: 120, reward: 8,
    rule: "EMBER HORDE: Spawns one 2/1 Raider on odd turns, and DOUBLES spawns (two 2/1 Raiders) on even turns!",
    spawn: { name: "Ember Raider", power: 2, toughness: 1, color: "R", keywords: [], count: 1 },
    evenTurnDoubleSpawn: true
  },
  {
    plane: 1, tier: "PLANAR OVERLORD", name: "Vaelor, the Dusk Sovereign", maxLife: 165, reward: 11,
    rule: "DUSK STAX: Spawns a 3/4 Blocker each turn, drains 1 Life/turn (healing Vaelor), and halves direct Burn Power.",
    spawn: { name: "Dusk Enforcer", power: 3, toughness: 4, color: "B", keywords: [] },
    staxDrain: 1,
    burnResistance: 0.5
  },
  {
    plane: 2, tier: "SKIRMISH WARD", name: "Zephyra, Storm Herald", maxLife: 245, reward: 12,
    rule: "AERIAL WARD: Spawns a 3/3 Flying Drake each turn. Your first Instant/Sorcery each turn spawns a 1/1 Flying Drake unless you control 4+ Lands.",
    spawn: { name: "Storm Drake", power: 3, toughness: 3, color: "U", keywords: ["Flying"] },
    spellWardTax: true
  },
  {
    plane: 2, tier: "ELITE WARD", name: "Ironbark Behemoth", maxLife: 380, reward: 14,
    rule: "IRON HIDE: Can't be burned (Direct Burn = 0)! Spawns a 4/4 Hydra each turn; surviving Blockers deal +1 extra damage.",
    spawn: { name: "Ironbark Hydra", power: 4, toughness: 4, color: "G", keywords: [] },
    burnImmune: true,
    staxHideBonus: 1
  },
  {
    plane: 2, tier: "PLANAR OVERLORD", name: "Aurelia, the Radiant Arbiter", maxLife: 600, reward: 16,
    rule: "RADIANT AURA: Spawns a 4/5 Radiant Guard each turn. Reinforces with an extra Guard on even turns!",
    spawn: { name: "Radiant Guard", power: 4, toughness: 4, color: "W", keywords: [], count: 1 },
    cenobiteAura: 1,
    evenTurnBonusGuard: 1
  }
];

const RUN_CHALLENGES = [
  {
    id: "standard",
    name: "Standard",
    description: "Five turns per ward. Begin with $6.",
    maxTurns: 5,
    startingGoldBonus: 0,
    extraEnemyPerWave: 0
  },
  {
    id: "short_fuse",
    name: "Short Fuse",
    description: "Defeat each ward in four turns. Begin with +$5 gold.",
    maxTurns: 4,
    startingGoldBonus: 5,
    extraEnemyPerWave: 0
  },
  {
    id: "swarm_surge",
    name: "Swarm Surge",
    description: "Even-turn enemy waves add one blocker. Begin with +$5 gold.",
    maxTurns: 5,
    startingGoldBonus: 5,
    extraEnemyOnEvenTurns: 1
  }
];

function getRunChallengeById(id) {
  return RUN_CHALLENGES.find(challenge => challenge.id === id) || RUN_CHALLENGES[0];
}

function normalizeRunChallengeId(id) {
  return getRunChallengeById(id).id;
}

// === BRANCHING ENCOUNTER MAP DEFINITIONS (Part 2) ===
const ROUTE_NODE_TYPES = {
  fight: { id: "fight", label: "Skirmish Ward", icon: "⚔️", badge: "FIGHT" },
  elite: { id: "elite", label: "Elite Ward", icon: "💀", badge: "ELITE" },
  boss: { id: "boss", label: "Planar Overlord", icon: "👑", badge: "BOSS" },
  shop: { id: "shop", label: "Aether Sanctum", icon: "🛒", badge: "SANCTUM" },
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
    title: "Thornback Warden",
    subtitle: "Plane 1 • Skirmish Ward",
    desc: "Break through the Thornback Beast vanguard to enter the Shattered Expanse.",
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
    desc: "The shrine offers power at a price. Trade Life for Gold, spend Gold to heal, or leave without a bargain.",
    choices: [
      {
        id: "blood_tithe",
        title: "Pay 5 Life for $8 Gold",
        desc: "Lose 5 Life and claim $8 Gold.",
        effect: "life_for_gold",
        requires: { lifeAbove: 5 },
        lifeCost: 5,
        goldGain: 8
      },
      {
        id: "purify",
        title: "Spend $5 to restore 8 Life",
        desc: "Pay $5 Gold and restore up to 8 Life.",
        effect: "gold_for_life",
        requires: { minGold: 5, missingLife: true },
        goldCost: 5,
        healAmount: 8
      },
      {
        id: "leave",
        title: "Leave the Shrine",
        desc: "Take no reward and pay no cost.",
        effect: "leave"
      }
    ],
    next: ["p1_elite"]
  },
  {
    id: "p1_elite",
    step: 2,
    plane: 1,
    type: "elite",
    encounterIdx: 1,
    title: "Cinderking Krag",
    subtitle: "Plane 1 • Elite Ward",
    desc: "Survive Cinderking Krag's doubling Ember horde for an Elite Ward bounty.",
    next: ["p1_boss"]
  },
  {
    id: "p1_boss",
    step: 3,
    plane: 1,
    type: "boss",
    encounterIdx: 2,
    title: "Vaelor, the Dusk Sovereign",
    subtitle: "Plane 1 • Planar Overlord",
    desc: "Overcome Vaelor's Dusk Stax to ascend to Plane 2.",
    next: ["p2_entry_fight", "p2_entry_shop"]
  },
  {
    id: "p2_entry_fight",
    step: 4,
    plane: 2,
    type: "fight",
    encounterIdx: 3,
    title: "Zephyra, Storm Herald",
    subtitle: "Plane 2 • Skirmish Ward",
    desc: "Challenge Zephyra's aerial storm drakes for full combat bounty and Sanctum access.",
    next: ["p2_mid_elite", "p2_mid_rest"]
  },
  {
    id: "p2_entry_shop",
    step: 4,
    plane: 2,
    type: "shop",
    encounterIdx: 3,
    title: "Aether Caravan",
    subtitle: "Plane 2 • Sanctum Outpost",
    desc: "Bypass Zephyra's sky patrol: Receive +$6 Caravan Stipend, +4 Life, and enter a Sanctum Shop directly.",
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
    title: "Ironbark Behemoth",
    subtitle: "Plane 2 • Elite Ward",
    desc: "Smash through the Behemoth's Iron Hide before facing the Radiant Arbiter.",
    next: ["p2_boss"]
  },
  {
    id: "p2_mid_rest",
    step: 5,
    plane: 2,
    type: "rest",
    encounterIdx: 4,
    title: "Sanctum of the Spire",
    subtitle: "Plane 2 • Rest Site",
    desc: "Evade the Behemoth's hunting grounds: Restore +12 Life, gain +$5 Gold, and temper a Creature (+2/+2 & Foil).",
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
    title: "Aurelia, the Radiant Arbiter",
    subtitle: "Plane 2 • Planar Overlord",
    desc: "Shatter Aurelia's Radiant Aura to conquer Plane 2 and calm the Manastorm!",
    next: []
  }
];

const DEFAULT_CAMPAIGN_ID = "blind_eternities";
const CAMPAIGN_DEFINITIONS = [
  {
    id: DEFAULT_CAMPAIGN_ID,
    name: "Shattered Expanse",
    description: "Traverse the two-plane Aether Expanse through escalating wards to the Radiant Arbiter.",
    ending: "You conquered the Shattered Expanse and calmed the Manastorm.",
    victoryBadge: "PLANE 2 CONQUERED • EXPANSE CALMED",
    encounters: ENCOUNTERS,
    routeNodes: CAMPAIGN_ROUTE_NODES
  },
  {
    id: "riftfall",
    name: "Riftfall",
    description: "Cross a collapsing realm where the final Warden combines draining rites with relentless reinforcements.",
    ending: "You sealed the Riftfall and restored the fractured realm.",
    victoryBadge: "RIFTFALL SEALED • REALM RESTORED",
    encounters: [
      {
        plane: 1, tier: "SKIRMISH WARD", name: "Riftling Broodmother", maxLife: 74, reward: 7,
        rule: "BROOD SURGE: A Riftling joins each turn; the brood doubles on Turn 4+.",
        spawn: { name: "Riftling", power: 2, toughness: 2, color: "B", keywords: [] },
        stampedeTurn: 4
      },
      {
        plane: 1, tier: "ELITE WARD", name: "Ashen Vanguard", maxLife: 116, reward: 8,
        rule: "EMBER HOST: One Ashen Guard joins on odd turns and two join on even turns.",
        spawn: { name: "Ashen Guard", power: 2, toughness: 2, color: "R", keywords: [], count: 1 },
        evenTurnDoubleSpawn: true
      },
      {
        plane: 1, tier: "PLANAR OVERLORD", name: "Shardbound Tyrant", maxLife: 158, reward: 11,
        rule: "SHARD DRAIN: Spawns a 3/4 Shard Sentinel, drains 1 Life each turn, and resists half of direct Burn.",
        spawn: { name: "Shard Sentinel", power: 3, toughness: 4, color: "C", keywords: [] },
        staxDrain: 1,
        burnResistance: 0.5
      },
      {
        plane: 2, tier: "SKIRMISH WARD", name: "Aetherstorm Sentinel", maxLife: 232, reward: 12,
        rule: "AETHER WARD: Spawns a 3/3 Flying Wisp each turn and taxes the first spell each turn until you control 4+ Lands.",
        spawn: { name: "Aether Wisp", power: 3, toughness: 3, color: "U", keywords: ["Flying"] },
        spellWardTax: true
      },
      {
        plane: 2, tier: "ELITE WARD", name: "Worldroot Colossus", maxLife: 360, reward: 14,
        rule: "WORLDROOT HIDE: Immune to direct Burn; a 4/4 Rootguard joins each turn and surviving Blockers hit harder.",
        spawn: { name: "Rootguard", power: 4, toughness: 4, color: "G", keywords: [] },
        burnImmune: true,
        staxHideBonus: 1
      },
      {
        plane: 2, tier: "PLANAR OVERLORD", name: "The Void Architect", maxLife: 570, reward: 18,
        rule: "VOID ENGINE: Spawns a 4/5 Void Guard each turn, reinforces on even turns, drains 1 Life, and resists half of direct Burn.",
        spawn: { name: "Void Guard", power: 4, toughness: 5, color: "C", keywords: [], count: 1 },
        staxDrain: 1,
        burnResistance: 0.5,
        evenTurnBonusGuard: 1
      }
    ],
    routeNodes: CAMPAIGN_ROUTE_NODES.map(node => {
      const story = {
        p1_start: {
          title: "Riftfall Border",
          subtitle: "Plane 1 • Rift Skirmish",
          desc: "Hold the border against the first wave spilling from the fracture."
        },
        p1_upper_rest: {
          title: "Sunwell Refuge",
          subtitle: "Plane 1 • Rest Site",
          desc: "Recover at the sunwell and temper a Creature before the Rift Devourer."
        },
        p1_lower_event: {
          title: "Fractured Shrine",
          subtitle: "Plane 1 • Planar Event",
          desc: "A broken shrine offers power for Life, healing for Gold, or a safe retreat."
        },
        p1_elite: {
          title: "Rift Devourer",
          subtitle: "Plane 1 • Elite Ward",
          desc: "Break the Devourer's reinforced guard before it can consume the border."
        },
        p1_boss: {
          title: "Shardbound Tyrant",
          subtitle: "Plane 1 • Planar Overlord",
          desc: "Defeat the Tyrant to cross into the collapsing heart of Riftfall."
        },
        p2_entry_fight: {
          title: "Aetherstorm Sentinel",
          subtitle: "Plane 2 • Skirmish Ward",
          desc: "Push through the storm and its spell-taxing Aether Wisp patrols."
        },
        p2_entry_shop: {
          title: "Driftwood Caravan",
          subtitle: "Plane 2 • Sanctum Outpost",
          desc: "Trade combat bounty for a safer crossing, a small stipend, and a Sanctum visit."
        },
        p2_mid_elite: {
          title: "Worldroot Colossus",
          subtitle: "Plane 2 • Elite Ward",
          desc: "Outlast the burn-proof Colossus and its heavy Rootguard."
        },
        p2_mid_rest: {
          title: "The Quiet Spire",
          subtitle: "Plane 2 • Rest Site",
          desc: "Restore Life, gather Gold, and temper a Creature before the final breach."
        },
        p2_boss: {
          title: "The Void Architect",
          subtitle: "Plane 2 • Final Warden",
          desc: "Shatter the Void Engine's draining rites and reinforcements to seal Riftfall."
        }
      }[node.id];
      return {
        ...node,
        ...(story || {}),
        next: [...(node.next || [])],
        ...(Array.isArray(node.choices)
          ? { choices: node.choices.map(choice => ({ ...choice, ...(choice.requires ? { requires: { ...choice.requires } } : {}) })) }
          : {})
      };
    })
  }
];

function getCampaignById(campaignId) {
  const id = typeof campaignId === "string" ? campaignId : DEFAULT_CAMPAIGN_ID;
  return CAMPAIGN_DEFINITIONS.find(campaign => campaign.id === id) ||
    CAMPAIGN_DEFINITIONS.find(campaign => campaign.id === DEFAULT_CAMPAIGN_ID);
}

function normalizeCampaignId(campaignId) {
  return CAMPAIGN_DEFINITIONS.some(campaign => campaign.id === campaignId)
    ? campaignId
    : DEFAULT_CAMPAIGN_ID;
}

function getCampaignEncounters(campaignId) {
  return getCampaignById(campaignId).encounters;
}

function getCampaignRouteNodes(campaignId) {
  return getCampaignById(campaignId).routeNodes;
}
