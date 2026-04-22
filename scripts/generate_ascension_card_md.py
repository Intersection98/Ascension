import csv
import io
import urllib.request
from pathlib import Path


BASE = "https://raw.githubusercontent.com/obi1kenobi/ascension-bot/master/src/input/"
URLS = {
    "acquirable.csv": BASE + "acquirable.csv",
    "defeatable.csv": BASE + "defeatable.csv",
    "counts.txt": BASE + "counts.txt",
    "effects.txt": BASE + "effects.txt",
}

STARTER_COUNTS = {
    "Apprentice": "8 per player (32 total for 4 players)",
    "Militia": "2 per player (8 total for 4 players)",
}

ALWAYS_AVAILABLE_COUNTS = {
    "Mystic": "30",
    "Heavy Infantry": "29",
    "Cultist": "1",
}


def fetch_all() -> dict[str, str]:
    return {
        name: urllib.request.urlopen(url, timeout=20).read().decode("utf-8", "ignore")
        for name, url in URLS.items()
    }


def load_counts(raw_counts: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for line in raw_counts.splitlines():
        if not line.strip():
            continue
        name, value = line.split(":", 1)
        counts[name.strip()] = int(value.strip())
    return counts


def split_top_level(text: str) -> list[str]:
    out: list[str] = []
    cur: list[str] = []
    depth = 0
    for ch in text:
        if ch == ";" and depth == 0:
            out.append("".join(cur))
            cur = []
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        cur.append(ch)
    if cur:
        out.append("".join(cur))
    return [item.strip() for item in out if item.strip()]


def decode_effect(effect_str: str, effects: list[str]) -> str:
    optional = effect_str.endswith("?")
    core = effect_str[:-1] if optional else effect_str

    if core.startswith("AND(") or core.startswith("OR("):
        mode = "AND" if core.startswith("AND(") else "OR"
        inner = core[4:-1]
        parts = [decode_effect(part, effects) for part in split_top_level(inner)]
        joined = "; ".join(parts) if mode == "AND" else " OR ".join(parts)
        return ("Optional: " if optional else "") + joined

    left = core.index("(")
    right = core.rindex(")")
    index = int(core[:left])
    arg = core[left + 1 : right]

    text = effects[index]
    if "%d" in text:
        text = text % int(arg)
    if optional:
        text = "Optional: " + text
    return text


def safe_decode_effect(effect_str: str, effects: list[str]) -> str:
    try:
        return decode_effect(effect_str, effects)
    except Exception:
        return f"RAW:{effect_str}"


def classify(card_type: str) -> tuple[str, str]:
    faction = "Neutral"
    kind = "Monster" if card_type == "Monster" else ("Construct" if "Construct" in card_type else "Hero")
    if card_type.startswith("Enlightened"):
        faction = "Enlightened"
    elif card_type.startswith("Lifebound"):
        faction = "Lifebound"
    elif card_type.startswith("Mechana"):
        faction = "Mechana"
    elif card_type.startswith("Void"):
        faction = "Void"
    return faction, kind


def cost_text(raw_cost: str) -> str:
    return raw_cost[:-1] + (" Runes" if raw_cost.endswith("R") else " Power")


def build_records(raw: dict[str, str]) -> list[dict[str, str]]:
    effects = [""] + [line.strip() for line in raw["effects.txt"].splitlines() if line.strip()]
    counts = load_counts(raw["counts.txt"])
    records: list[dict[str, str]] = []

    for row in csv.reader(io.StringIO(raw["acquirable.csv"])):
        name, cost, honor, card_type, *effect_parts = row
        faction, kind = classify(card_type)
        if name in STARTER_COUNTS:
            copies = STARTER_COUNTS[name]
            section = "Starter Cards"
        elif name in ALWAYS_AVAILABLE_COUNTS:
            copies = ALWAYS_AVAILABLE_COUNTS[name]
            section = "Always Available"
        else:
            copies = str(counts.get(name, "UNKNOWN"))
            section = "Center Deck"

        records.append(
            {
                "name": name,
                "faction": faction,
                "kind": kind,
                "type": card_type,
                "cost": cost_text(cost),
                "honor": honor,
                "copies": copies,
                "effect": " | ".join(safe_decode_effect(x, effects) for x in effect_parts)
                if effect_parts
                else "-",
                "section": section,
            }
        )

    for row in csv.reader(io.StringIO(raw["defeatable.csv"])):
        name, cost, card_type, *effect_parts = row
        records.append(
            {
                "name": name,
                "faction": "Monster",
                "kind": "Monster",
                "type": card_type,
                "cost": cost_text(cost),
                "honor": "-",
                "copies": ALWAYS_AVAILABLE_COUNTS.get(name, str(counts.get(name, "UNKNOWN"))),
                "effect": " | ".join(safe_decode_effect(x, effects) for x in effect_parts)
                if effect_parts
                else "-",
                "section": "Always Available" if name == "Cultist" else "Center Deck Monsters",
            }
        )

    return records


def make_table(items: list[dict[str, str]]) -> list[str]:
    lines = [
        "| Name | Faction | Type | Cost | Honor | Copies | Effect |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for item in items:
        effect = item["effect"].replace("|", "\\|")
        lines.append(
            f"| {item['name']} | {item['faction']} | {item['kind']} | {item['cost']} | {item['honor']} | {item['copies']} | {effect} |"
        )
    return lines


def render(records: list[dict[str, str]]) -> str:
    starters = [item for item in records if item["section"] == "Starter Cards"]
    always = [item for item in records if item["section"] == "Always Available"]
    center = [item for item in records if item["section"] == "Center Deck"]
    monsters = [item for item in records if item["section"] == "Center Deck Monsters"]

    center.sort(key=lambda item: (item["faction"], item["kind"], item["name"]))
    monsters.sort(key=lambda item: item["name"])

    lines: list[str] = []
    lines.append("# Ascension 10th Anniversary Edition Card List")
    lines.append("")
    lines.append(
        "This file organizes the full core card pool used by **Ascension: 10th Anniversary Edition**, "
        "based on public data for **Chronicle of the Godslayer / core set**, which multiple retailer "
        "and product pages describe as the gameplay basis for the anniversary printing."
    )
    lines.append("")
    lines.append("## Source Notes")
    lines.append("")
    lines.append(
        "- Retail/product pages describe the anniversary edition as a remastered or reprinted version of the original core set / Chronicle of the Godslayer."
    )
    lines.append(
        "- Card identities, costs, printed honor, effect text templates, and center-deck counts are taken from the public data files in the `obi1kenobi/ascension-bot` repository:"
    )
    for url in URLS.values():
        lines.append(f"  - `{url}`")
    lines.append(
        "- Online retailer pages disagree on physical card count (`181` vs `200`). The list below focuses on the gameplay card list and per-card counts used by the classic core set data."
    )
    lines.append("")
    lines.append("## Starter Cards")
    lines.append("")
    lines.extend(make_table(starters))
    lines.append("")
    lines.append("## Always Available Cards And Monster")
    lines.append("")
    lines.extend(make_table(always))
    lines.append("")
    lines.append("## Center Deck Acquirable Cards")
    lines.append("")
    lines.extend(make_table(center))
    lines.append("")
    lines.append("## Center Deck Monsters")
    lines.append("")
    lines.extend(make_table(monsters))
    lines.append("")
    lines.append("## Notes")
    lines.append("")
    lines.append("- `Copies` for center-deck cards come from `counts.txt`.")
    lines.append(
        "- `Mystic`, `Heavy Infantry`, and `Cultist` are listed as always-available piles; this file uses the classic core-set distribution of `30 Mystic`, `29 Heavy Infantry`, and `1 Cultist`."
    )
    lines.append("- `Apprentice` and `Militia` are starter cards dealt per player, not part of the center deck.")
    lines.append("- Some effect lines use `Optional:` or `OR` because the public input files encode branching choices directly.")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    raw = fetch_all()
    records = build_records(raw)
    out_dir = Path("/Users/bytedance/Documents/Ascension/docs")
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / "ascension-10th-anniversary-card-list.md"
    out_file.write_text(render(records), encoding="utf-8")
    print(out_file)
    print(f"records={len(records)}")


if __name__ == "__main__":
    main()
