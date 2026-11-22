export const ACTIVITIES = [
  { id: "tiny-zine", title: "Fold a tiny zine", description: "Turn one sheet of paper into a pocket-sized story or mini magazine.", duration: 25, cost: 0, moods: ["make", "meet"], setting: "Maker table" },
  { id: "button-badge", title: "Design a button badge", description: "Make a small badge with a color, word, or doodle that feels like you.", duration: 20, cost: 2, moods: ["make", "meet"], setting: "Maker table" },
  { id: "photo-prompt", title: "Make a campus photo prompt", description: "Pick a tiny theme and capture three details you usually walk past.", duration: 15, cost: 0, moods: ["make", "move"], setting: "Around campus" },
  { id: "sketch-swap", title: "Sketch and swap", description: "Draw a two-minute doodle, then trade prompts with someone new.", duration: 20, cost: 0, moods: ["make", "meet"], setting: "Maker table" },
  { id: "postcard-print", title: "Print a mini postcard set", description: "Choose a campus photo and turn it into a little postcard to keep or share.", duration: 20, cost: 3, moods: ["make", "meet"], setting: "Maker table" },
  { id: "collage-kit", title: "Build a pocket collage", description: "Pick from a small paper-and-sticker kit to make a tiny collage card.", duration: 25, cost: 5, moods: ["make", "meet"], setting: "Maker table" },
  { id: "woven-keytag", title: "Weave a color key tag", description: "Try a simple cord pattern and make a bright tag for your keys or bag.", duration: 25, cost: 6, moods: ["make", "meet"], setting: "Maker table" },
  { id: "photo-walk-kit", title: "Campus photo walk kit", description: "Take a short photo walk with a printed prompt card and a mini photo frame.", duration: 25, cost: 5, moods: ["move", "make"], setting: "Around campus" },
];

export function getActivities() {
  return { source: "Makers Studio", updated: "Demo listings", activities: ACTIVITIES.map((item) => ({ ...item, moods: [...item.moods] })) };
}
