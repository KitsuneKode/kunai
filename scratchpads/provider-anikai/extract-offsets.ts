import * as fs from "fs";

const code = fs.readFileSync("scratchpads/provider-anikai/chunks/scripts-BzTinek-.js", "utf8");

const offsets = [445306, 445968, 128109];

offsets.forEach((off) => {
  console.log(`\n--- Code at offset ${off} ---`);
  console.log(code.substring(off - 500, off + 500));
});
