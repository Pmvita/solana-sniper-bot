/** Create build/icon.icns (and reinforce icon.ico) from build/icon.png. */
const fs = require("node:fs");
const path = require("node:path");
const png2icons = require("png2icons");

const root = path.join(__dirname, "..");
const pngPath = path.join(root, "build", "icon.png");
const input = fs.readFileSync(pngPath);

const icns = png2icons.createICNS(input, png2icons.BILINEAR, 0);
if (!icns) {
  console.error("ICNS conversion failed");
  process.exit(1);
}
fs.writeFileSync(path.join(root, "build", "icon.icns"), icns);
console.log("Wrote build/icon.icns", icns.length, "bytes");

const ico = png2icons.createICO(input, png2icons.BILINEAR, 0, false);
if (ico) {
  fs.writeFileSync(path.join(root, "build", "icon.ico"), ico);
  console.log("Wrote build/icon.ico", ico.length, "bytes");
}
