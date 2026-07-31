/** Does the commissioner always get the share link, and viewers never get controls? */
const fs = require("fs");
const { JSDOM } = require("jsdom");
const ROOT = "/Users/neej/Documents/Projects/FantasyDraftLottery";
const HTML = fs.readFileSync(ROOT + "/reveal.html", "utf8");
const JS = fs.readFileSync(ROOT + "/reveal.js", "utf8");

const PAYLOAD = {
  leagueName: "Dynasty Way Year 9", teamCount: 5, revealId: "moL7PcGSqgjE",
  teams: ["Ray", "will", "Liao", "Mau", "Kush"], weighted: true,
  sealedAt: new Date().toISOString(), commitmentHash: "abc123",
  mode: "scheduled", scheduledAt: new Date(Date.now() + 600000).toISOString(),
  showStartedAt: new Date(Date.now() + 600000).toISOString(),
  serverNow: new Date().toISOString(), pickGapSeconds: 0, live: false,
};

function run(query, label) {
  const dom = new JSDOM(HTML, { runScripts: "outside-only", url: "https://www.fantasydraftlottery.com/reveal.html" + query });
  const { window } = dom;
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) });
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
  window.HTMLMediaElement.prototype.load = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.eval(JS);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return new Promise((res) => setTimeout(() => {
    const d = window.document;
    const hidden = (id) => d.getElementById(id).classList.contains("hidden");
    res({
      label,
      controlsVisible: !hidden("hostPanel"),
      shareBoxVisible: !hidden("newPurchase"),
      shareLink: d.getElementById("shareLink").value,
      title: d.getElementById("npTitle").textContent,
    });
  }, 120));
}

(async () => {
  const cases = [
    ["?id=moL7PcGSqgjE&host=osMdDFH9oXDhUt7bAy26Ow&new=1", "commissioner, just bought"],
    ["?id=moL7PcGSqgjE&host=osMdDFH9oXDhUt7bAy26Ow", "commissioner, RETURN visit"],
    ["?id=moL7PcGSqgjE", "viewer (share link)"],
  ];
  let ok = true;
  for (const [q, label] of cases) {
    const r = await run(q, label);
    const isHost = q.includes("host=");
    const wantControls = isHost, wantShare = isHost;
    const pass = r.controlsVisible === wantControls && r.shareBoxVisible === wantShare &&
      (!isHost || (r.shareLink && !r.shareLink.includes("host=")));
    if (!pass) ok = false;
    console.log(`\n${pass ? "PASS" : "FAIL"}  ${r.label}`);
    console.log(`   commissioner controls : ${r.controlsVisible}`);
    console.log(`   share-link box        : ${r.shareBoxVisible}   "${r.title}"`);
    console.log(`   share link offered    : ${r.shareLink || "(none)"}`);
    if (r.shareLink && r.shareLink.includes("host=")) console.log("   !! share link LEAKS the host token");
  }
  console.log(ok ? "\nALL PASS" : "\nFAILURES");
  process.exit(ok ? 0 : 1);
})();
