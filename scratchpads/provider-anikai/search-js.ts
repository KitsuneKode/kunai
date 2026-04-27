import * as fs from "fs";

const code = fs.readFileSync("scratchpads/provider-anikai/chunks/scripts-BzTinek-.js", "utf8");

// The strings are likely encrypted, so let's use the 'r' functions I found earlier.
// Wait, I can't run them here.
// But I can search for the structure of the call.
// Usually $.ajax({url: '...'})

const matches = code.match(/\/ajax\/[a-zA-Z0-9\/]+/g);
console.log("AJAX URL matches:", matches);

const result = code.match(/data-lid/g);
console.log("data-lid found:", result);
