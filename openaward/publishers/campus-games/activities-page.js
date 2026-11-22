import { getActivities } from "./activities.js";

const data = getActivities();
const grid = document.querySelector("#activity-grid");
const money = (value) => value === 0 ? "Free" : `$${value} materials`;
for (const [index, activity] of data.activities.entries()) {
  const card = document.createElement("article");
  card.className = "activity-card";
  const top = document.createElement("div");
  top.className = "activity-top";
  const number = document.createElement("span");
  number.className = "activity-number";
  number.textContent = String(index + 1).padStart(2, "0");
  const time = document.createElement("span");
  time.textContent = `${activity.duration} MIN`;
  top.append(number, time);
  const title = document.createElement("h3");
  title.textContent = activity.title;
  const text = document.createElement("p");
  text.textContent = activity.description;
  const foot = document.createElement("div");
  foot.className = "activity-foot";
  const setting = document.createElement("span");
  setting.textContent = activity.setting;
  const cost = document.createElement("b");
  cost.textContent = money(activity.cost);
  foot.append(setting, cost);
  card.append(top, title, text, foot);
  grid.append(card);
}
