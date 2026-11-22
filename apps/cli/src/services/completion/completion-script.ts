import { CLI_SUBCOMMANDS, KNOWN_FLAGS, VALUE_FLAGS } from "@/cli-args";

/**
 * Shell completion scripts for `kunai`.
 *
 * The flag and subcommand vocabulary is imported from `cli-args.ts` rather than
 * restated here: a flag the parser accepts is a flag completion offers, and a
 * flag it drops stops being offered, without a second list to keep in sync.
 */
export const COMPLETION_SHELLS = ["bash", "zsh", "fish", "powershell"] as const;

export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export function isCompletionShell(value: string): value is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(value);
}

/** Flags handled by an earlier, more specific `case` arm in the generated scripts. */
const SPECIALISED_VALUE_FLAGS = new Set([
  "-t",
  "--type",
  "--quality",
  "--audio",
  "--sub",
  "--player",
  "--hdr",
  "--format",
  "--download-path",
  "--mpv-log-file",
]);

/**
 * Value-taking flags that have no better completion than "expect a value".
 * Excludes the ones an earlier case arm already answers, so the generated
 * `case` statement has no dead duplicate patterns.
 */
function valueFlags(): readonly string[] {
  return [...VALUE_FLAGS].filter((flag) => !SPECIALISED_VALUE_FLAGS.has(flag)).sort();
}

/** Every flag token, long and short. */
function allFlags(): readonly string[] {
  return [...KNOWN_FLAGS].sort();
}

const TYPE_VALUES = ["movie", "tv"] as const;
const QUALITY_VALUES = ["best", "2160p", "1440p", "1080p", "720p", "480p"] as const;
const AUDIO_VALUES = ["original", "en", "ja", "hi", "pt", "es", "fr", "de", "dub"] as const;
const SUB_VALUES = ["en", "interactive", "none", "hi", "pt", "ar", "de", "es", "fr", "ja"] as const;
const PLAYER_VALUES = ["auto", "mpv", "vlc"] as const;
const HDR_VALUES = ["auto", "passthrough", "tone-map", "sdr-only"] as const;
const FORMAT_VALUES = ["pretty", "jsonl", "markdown"] as const;
const PROVIDERS_SUBCOMMANDS = ["status", "update", "verify", "rollback", "reset"] as const;

function bashScript(): string {
  return `# kunai bash completion. Install:
#   kunai completion bash > /etc/bash_completion.d/kunai
# or append to ~/.bashrc:
#   eval "$(kunai completion bash)"
_kunai_complete() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
    -t|--type)
      COMPREPLY=( $(compgen -W "${TYPE_VALUES.join(" ")}" -- "$cur") ); return ;;
    --quality)
      COMPREPLY=( $(compgen -W "${QUALITY_VALUES.join(" ")}" -- "$cur") ); return ;;
    --audio)
      COMPREPLY=( $(compgen -W "${AUDIO_VALUES.join(" ")}" -- "$cur") ); return ;;
    --sub)
      COMPREPLY=( $(compgen -W "${SUB_VALUES.join(" ")}" -- "$cur") ); return ;;
    --player)
      COMPREPLY=( $(compgen -W "${PLAYER_VALUES.join(" ")}" -- "$cur") ); return ;;
    --hdr)
      COMPREPLY=( $(compgen -W "${HDR_VALUES.join(" ")}" -- "$cur") ); return ;;
    --format)
      COMPREPLY=( $(compgen -W "${FORMAT_VALUES.join(" ")}" -- "$cur") ); return ;;
    --download-path|--mpv-log-file)
      COMPREPLY=( $(compgen -d -- "$cur") ); return ;;
    completion)
      COMPREPLY=( $(compgen -W "${COMPLETION_SHELLS.join(" ")}" -- "$cur") ); return ;;
    providers)
      COMPREPLY=( $(compgen -W "${PROVIDERS_SUBCOMMANDS.join(" ")}" -- "$cur") ); return ;;
    ${valueFlags().join("|")})
      COMPREPLY=(); return ;;
  esac

  if [[ $COMP_CWORD -eq 1 && "$cur" != -* ]]; then
    COMPREPLY=( $(compgen -W "${CLI_SUBCOMMANDS.join(" ")}" -- "$cur") ); return
  fi

  COMPREPLY=( $(compgen -W "${allFlags().join(" ")}" -- "$cur") )
}
complete -F _kunai_complete kunai
`;
}

function zshScript(): string {
  return `#compdef kunai
# kunai zsh completion. Install:
#   kunai completion zsh > "\${fpath[1]}/_kunai"
# or append to ~/.zshrc:
#   eval "$(kunai completion zsh)"
_kunai() {
  local -a subcommands flags shells providers_subs types qualities audios subs players hdrs formats
  subcommands=(${CLI_SUBCOMMANDS.map((c) => `'${c}'`).join(" ")})
  flags=(${allFlags()
    .map((f) => `'${f}'`)
    .join(" ")})
  shells=(${COMPLETION_SHELLS.map((s) => `'${s}'`).join(" ")})
  providers_subs=(${PROVIDERS_SUBCOMMANDS.map((p) => `'${p}'`).join(" ")})
  types=(${TYPE_VALUES.map((t) => `'${t}'`).join(" ")})
  qualities=(${QUALITY_VALUES.map((q) => `'${q}'`).join(" ")})
  audios=(${AUDIO_VALUES.map((a) => `'${a}'`).join(" ")})
  subs=(${SUB_VALUES.map((s) => `'${s}'`).join(" ")})
  players=(${PLAYER_VALUES.map((p) => `'${p}'`).join(" ")})
  hdrs=(${HDR_VALUES.map((h) => `'${h}'`).join(" ")})
  formats=(${FORMAT_VALUES.map((f) => `'${f}'`).join(" ")})

  case "\${words[CURRENT-1]}" in
    -t|--type) _describe 'type' types; return ;;
    --quality) _describe 'quality' qualities; return ;;
    --audio) _describe 'audio' audios; return ;;
    --sub) _describe 'subtitle' subs; return ;;
    --player) _describe 'player' players; return ;;
    --hdr) _describe 'hdr mode' hdrs; return ;;
    --format) _describe 'format' formats; return ;;
    --download-path|--mpv-log-file) _files -/; return ;;
    completion) _describe 'shell' shells; return ;;
    providers) _describe 'providers action' providers_subs; return ;;
  esac

  if (( CURRENT == 2 )) && [[ "\${words[CURRENT]}" != -* ]]; then
    _describe 'subcommand' subcommands
    return
  fi

  _describe 'flag' flags
}
compdef _kunai kunai
`;
}

function fishScript(): string {
  const sub = CLI_SUBCOMMANDS.join(" ");
  const lines = [
    `# kunai fish completion. Install:`,
    `#   kunai completion fish > ~/.config/fish/completions/kunai.fish`,
    ``,
    `complete -c kunai -f`,
    `complete -c kunai -n "not __fish_seen_subcommand_from ${sub}" -a "${sub}"`,
    `complete -c kunai -n "__fish_seen_subcommand_from completion" -a "${COMPLETION_SHELLS.join(" ")}"`,
    `complete -c kunai -n "__fish_seen_subcommand_from providers" -a "${PROVIDERS_SUBCOMMANDS.join(" ")}"`,
    `complete -c kunai -s t -l type -x -a "${TYPE_VALUES.join(" ")}"`,
    `complete -c kunai -l quality -x -a "${QUALITY_VALUES.join(" ")}"`,
    `complete -c kunai -l audio -x -a "${AUDIO_VALUES.join(" ")}"`,
    `complete -c kunai -l sub -x -a "${SUB_VALUES.join(" ")}"`,
    `complete -c kunai -l player -x -a "${PLAYER_VALUES.join(" ")}"`,
    `complete -c kunai -l hdr -x -a "${HDR_VALUES.join(" ")}"`,
    `complete -c kunai -l format -x -a "${FORMAT_VALUES.join(" ")}"`,
    `complete -c kunai -l download-path -r -F`,
    `complete -c kunai -l mpv-log-file -r -F`,
  ];
  for (const flag of allFlags()) {
    if (SPECIALISED_VALUE_FLAGS.has(flag)) continue;
    const takesValue = VALUE_FLAGS.has(flag);
    const spec = flag.startsWith("--") ? `-l ${flag.slice(2)}` : `-s ${flag.slice(1)}`;
    lines.push(`complete -c kunai ${spec}${takesValue ? " -x" : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

function powershellScript(): string {
  return `# kunai PowerShell completion. Install:
#   kunai completion powershell | Out-String | Invoke-Expression
# or persist it:
#   kunai completion powershell >> $PROFILE
Register-ArgumentCompleter -Native -CommandName kunai -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $subcommands = @(${CLI_SUBCOMMANDS.map((c) => `'${c}'`).join(", ")})
  $flags = @(${allFlags()
    .map((f) => `'${f}'`)
    .join(", ")})
  $shells = @(${COMPLETION_SHELLS.map((s) => `'${s}'`).join(", ")})
  $providersSubs = @(${PROVIDERS_SUBCOMMANDS.map((p) => `'${p}'`).join(", ")})
  $types = @(${TYPE_VALUES.map((t) => `'${t}'`).join(", ")})
  $qualities = @(${QUALITY_VALUES.map((q) => `'${q}'`).join(", ")})
  $audios = @(${AUDIO_VALUES.map((a) => `'${a}'`).join(", ")})
  $subs = @(${SUB_VALUES.map((s) => `'${s}'`).join(", ")})
  $players = @(${PLAYER_VALUES.map((p) => `'${p}'`).join(", ")})
  $hdrs = @(${HDR_VALUES.map((h) => `'${h}'`).join(", ")})
  $formats = @(${FORMAT_VALUES.map((f) => `'${f}'`).join(", ")})

  $elements = $commandAst.CommandElements
  $previous = if ($elements.Count -ge 2) { $elements[$elements.Count - 2].ToString() } else { '' }

  $candidates = switch ($previous) {
    '-t' { $types }
    '--type' { $types }
    '--quality' { $qualities }
    '--audio' { $audios }
    '--sub' { $subs }
    '--player' { $players }
    '--hdr' { $hdrs }
    '--format' { $formats }
    'completion' { $shells }
    'providers' { $providersSubs }
    default {
      if ($elements.Count -le 2 -and -not $wordToComplete.StartsWith('-')) { $subcommands } else { $flags }
    }
  }

  $candidates |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`;
}

export function renderCompletionScript(shell: CompletionShell): string {
  switch (shell) {
    case "bash":
      return bashScript();
    case "zsh":
      return zshScript();
    case "fish":
      return fishScript();
    case "powershell":
      return powershellScript();
  }
}
