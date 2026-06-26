import { describe, it, expect } from "vitest";
import {
  canonicalKey,
  titleSignature,
  normalizeTitle,
  extractPlatform,
  normalizeStoreUrl,
} from "./normalize";

/**
 * Real cross-source pairs pulled from the legacy freebies.db. Each pair is the
 * SAME giveaway seen on Reddit and on GamerPower under different titles/URLs.
 * The whole point of the rebuild is that these collapse to one canonical key.
 */
const REAL_DUPLICATE_PAIRS: Array<[string, string]> = [
  ["[Epic Games] (Game) Jotunnslayer Hordes of Hel", "Jotunnslayer Hordes of Hel (Epic Games) Giveaway"],
  ["[Epic Games] (Game) The Battle of Polytopia", "The Battle of Polytopia (Epic Games) Giveaway"],
  ["[Steam] (Game) Guntouchables", "Guntouchables (Steam) Giveaway"],
  ["[Steam] (Game) Fantasy General II", "Fantasy General II (Steam) Giveaway"],
  ["[Steam] (Game) Nocturnal", "Nocturnal (Steam) Giveaway"],
  ["[Steam] (Game) Puzzle Chambers", "Puzzle Chambers (Steam) Giveaway"],
  ["[Steam] (Game) Symmetry", "Symmetry (Epic Games) Giveaway"],
  ["[Epic Games] (Game) Lost in the Hole", "Lost in the Hole (Epic Games) Giveaway"],
  ["[Steam] (Game) IQ Under Construction", "IQ Under Construction (Steam) Giveaway"],
  ["[Steam] (Game) Super Panda Adventures", "Super Panda Adventures (Steam) Key Giveaway"],
  // platform label genuinely differs between sources — must STILL merge:
  ["[IndieGala] (Game) Leaper", "Leaper (PC) Giveaway"],
  ["[IndieGala] (Game) The Brave Little Cloud", "The Brave Little Cloud (PC) Giveaway"],
];

describe("cross-source dedup (real legacy pairs)", () => {
  for (const [reddit, gamerpower] of REAL_DUPLICATE_PAIRS) {
    it(`merges "${reddit}" with "${gamerpower}"`, () => {
      expect(canonicalKey({ title: reddit })).toBe(canonicalKey({ title: gamerpower }));
    });
  }
});

describe("distinct games stay distinct", () => {
  const distinct = [
    "[Steam] (Game) Nocturnal",
    "[Steam] (Game) Symmetry",
    "[Steam] (Game) Guntouchables",
    "[Epic Games] (Game) The Battle of Polytopia",
  ];
  it("produces unique keys for unrelated titles", () => {
    const keys = distinct.map((t) => canonicalKey({ title: t }));
    expect(new Set(keys).size).toBe(distinct.length);
  });
});

describe("store-URL identity takes priority", () => {
  it("merges two different storefront URLs pointing at the same Steam app", () => {
    const a = canonicalKey({
      title: "Some Game (Steam)",
      directUrl: "https://store.steampowered.com/app/12345/Some_Game/",
    });
    const b = canonicalKey({
      title: "Totally Different Marketing Title",
      directUrl: "https://store.steampowered.com/app/12345/",
    });
    expect(a).toBe(b);
    expect(a).toBe("url:steam:12345");
  });
});

describe("normalizeStoreUrl", () => {
  it("extracts steam app ids", () => {
    expect(normalizeStoreUrl("https://store.steampowered.com/app/999/Foo/")).toBe("steam:999");
  });
  it("returns null for aggregator/landing pages", () => {
    expect(normalizeStoreUrl("https://www.gamerpower.com/open/nocturnal-steam-giveaway")).toBeNull();
    expect(normalizeStoreUrl("https://www.reddit.com/r/FreeGameFindings/comments/x/y/")).toBeNull();
  });
});

describe("helpers", () => {
  it("normalizeTitle strips tags and giveaway noise", () => {
    expect(normalizeTitle("Nocturnal (Steam) Key Giveaway")).toBe("Nocturnal");
    expect(normalizeTitle("[Steam] (Game) Guntouchables")).toBe("Guntouchables");
  });
  it("titleSignature is order-independent", () => {
    expect(titleSignature("The Battle of Polytopia")).toBe(titleSignature("Polytopia Battle"));
  });
  it("extractPlatform reads tags and hints", () => {
    expect(extractPlatform("[Epic Games] (Game) Foo")).toBe("Epic Games");
    expect(extractPlatform("Foo", "PC, Steam")).toBe("Steam");
    expect(extractPlatform("Plain Title")).toBe("PC");
  });
});
