/**
 * Build an argv that runs `command` under a PTY and records a typescript.
 *
 * Ink refuses to mount without a raw-mode TTY. Linux util-linux `script -c`
 * allocates a PTY without probing the caller's stdin, so Bun's `stdin:"ignore"`
 * is fine there. BSD `script` on macOS calls `tcgetattr` on its own stdin and
 * aborts (or forwards EOF as `^D`) when that stdin is a pipe/socket — exactly
 * what CI and `stdin:"ignore"` provide. `expect(1)` allocates a PTY via
 * `ptyfork` without probing the caller's stdin, and is part of the macOS base
 * system.
 */
export function buildPtyCommand(
  command: string,
  transcript: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "darwin") {
    return ["expect", "-c", buildDarwinExpectScript(command, transcript)];
  }
  return ["script", "-qec", command, transcript];
}

/** Escape a string for embedding inside a Tcl double-quoted word. */
function escapeTclDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

export function buildDarwinExpectScript(command: string, transcript: string): string {
  const tclCommand = escapeTclDoubleQuoted(command);
  const tclTranscript = escapeTclDoubleQuoted(transcript);
  // expect's `wait` does not return a raw wait(2) status. Normal exits are
  // `{pid spawn_id 0 exitCode}`; signal deaths are
  // `{pid spawn_id 0 0 CHILDKILLED SIGNAME ...}`. Map those to shell-style
  // 128+signal codes so the shutdown suite matches util-linux `script -e`.
  return [
    `log_file "${tclTranscript}"`,
    "log_user 0",
    "set timeout -1",
    `spawn /bin/sh -c "${tclCommand}"`,
    "expect eof",
    "set w [wait]",
    "set os_error [lindex $w 2]",
    "set code [lindex $w 3]",
    "set why [lindex $w 4]",
    "set signame [lindex $w 5]",
    "if {$os_error != 0} { exit 1 }",
    'if {$why eq "CHILDKILLED"} { switch -exact -- $signame { SIGHUP { exit 129 } SIGINT { exit 130 } SIGTERM { exit 143 } default { exit [expr {128 + [exec kill -l $signame]}] } } }',
    "exit $code",
  ].join("; ");
}
