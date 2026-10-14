/* oxlint-disable react/no-array-index-key */
/* Every list here is static geometry in painter's order; nothing reorders,
   so position is identity. */
import { Dots, Line, Solid, Wire, FaceText } from "../react/draw";
import {
  BASE_ART,
  BIN_ART,
  BIN_TOKENS,
  CABLE_DIAL,
  CABLE_SCREEN,
  DIAL_ART,
  GATE_ART,
  HOPPER_ART,
  NEEDLE_HUB,
  PLUNGER_ART,
  QUEUED_TOKENS,
  RAIL_ART,
  SCREEN_ART,
  TOKEN_ART,
} from "./geometry";
import { ResolveGateLive } from "./live";

/*
 * Painter's order, back to front: base → hopper (far back-left) → screen
 * (back-right) → rail → bin + dial (front) → gate. The moving token and
 * plunger render after the statics, inside ResolveGateLive.
 */
export function ResolveGateArt() {
  return (
    <ResolveGateLive
      label="The resolve gate: candidate streams leave the hopper one at a time, the plunger probes each, and the dial reads pass or fail — good candidates ride the rail to the mpv screen, dead ones drop into the reject hopper."
      token={
        <>
          <Solid paths={TOKEN_ART.body} tone="hi" lit />
          <Line d={TOKEN_ART.stripe} tone="hi" />
        </>
      }
      plunger={
        <>
          <Solid paths={PLUNGER_ART.stem} tone="mid" />
          <Solid paths={PLUNGER_ART.collar} tone="hi" />
          <Solid paths={PLUNGER_ART.tip} tone="hi" crease="mid" />
          <Line d={PLUNGER_ART.tipRing} tone="lo" />
        </>
      }
    >
      {/* base */}
      <path className="iso-halo" d={BASE_ART.halo} />
      {BASE_ART.feet.map(([rubber, foot], i) => (
        <g key={i}>
          <Solid paths={rubber} tone="faint" />
          <Solid paths={foot} tone="lo" />
        </g>
      ))}
      <Solid paths={BASE_ART.slab} tone="hi" />
      <Line d={BASE_ART.groove} tone="lo" />
      <Line d={BASE_ART.screwRings} tone="faint" />
      <Dots points={BASE_ART.screws} size={0.7} tone="lo" />
      <Solid paths={BASE_ART.plate} tone="mid" />
      <Line d={BASE_ART.plateLine} tone="lo" />
      <Dots points={BASE_ART.plateScrews} size={0.5} tone="faint" />
      <FaceText transform={BASE_ART.plateText} size={3.4} tone="mid">
        RESOLVE GATE
      </FaceText>

      {/* feed hopper + the queue inside it */}
      {QUEUED_TOKENS.map((t, i) => (
        <g key={i}>
          <Solid paths={t.body} tone="mid" />
          <Line d={t.stripe} tone="lo" />
        </g>
      ))}
      {HOPPER_ART.walls.map((paths, i) => (
        <Solid key={i} paths={paths} tone="mid" />
      ))}
      <Line d={HOPPER_ART.rims} tone="hi" />
      <Line d={HOPPER_ART.slot} tone="hi" />
      <FaceText transform={HOPPER_ART.label} size={3} tone="hi">
        candidates
      </FaceText>

      {/* mpv — the screen a probed stream earns */}
      <Solid paths={SCREEN_ART.foot} tone="lo" />
      <Solid paths={SCREEN_ART.stand} tone="mid" />
      <Solid paths={SCREEN_ART.body} tone="hi" />
      <Line d={SCREEN_ART.glassRing} tone="hi" />
      <Dots points={SCREEN_ART.screws} size={0.55} tone="mid" />
      <FaceText transform={SCREEN_ART.label} size={3} tone="hi">
        mpv
      </FaceText>
      <Solid paths={SCREEN_ART.pad} tone="lo" />
      <Line d={SCREEN_ART.padLine} tone="faint" />

      {/* rail */}
      <Solid paths={RAIL_ART.rail} tone="hi" />
      <Line d={RAIL_ART.channel} tone="lo" />
      <Line d={RAIL_ART.ticksMinor} tone="faint" />
      <Line d={RAIL_ART.ticksMajor} tone="lo" />
      <Solid paths={RAIL_ART.stop} tone="mid" />
      <Dots points={RAIL_ART.screws} size={0.6} tone="lo" />

      {/* reject hopper + its fallen */}
      {BIN_TOKENS.map((t, i) => (
        <Solid key={i} paths={t.body} tone="lo" />
      ))}
      {BIN_ART.walls.map((paths, i) => (
        <Solid key={i} paths={paths} tone="mid" />
      ))}
      <Line d={BIN_ART.rims} tone="hi" />
      <Solid paths={BIN_ART.chute} tone="lo" />
      <FaceText transform={BIN_ART.label} size={3} tone="hi">
        dead
      </FaceText>

      {/* dial gauge */}
      <Solid paths={DIAL_ART.stand} tone="mid" />
      <Dots points={DIAL_ART.standScrews} size={0.5} tone="faint" />
      <Solid paths={DIAL_ART.puck} tone="hi" />
      <Line d={DIAL_ART.bezel} tone="hi" />
      <Line d={DIAL_ART.face} tone="mid" />
      <Line d={DIAL_ART.minor} tone="faint" />
      <Line d={DIAL_ART.major} tone="mid" />
      <Line d={DIAL_ART.failZone} tone="red" />
      <Solid paths={DIAL_ART.crown} tone="mid" />
      <Solid paths={DIAL_ART.lug} tone="lo" />
      <FaceText transform={DIAL_ART.label} size={2.6} tone="hi">
        probe
      </FaceText>

      {/* gate frame */}
      {GATE_ART.feet.map((paths, i) => (
        <Solid key={i} paths={paths} tone="lo" />
      ))}
      <Dots points={GATE_ART.footScrews} size={0.55} tone="faint" />
      {GATE_ART.posts.map((paths, i) => (
        <Solid key={i} paths={paths} tone="hi" />
      ))}
      <Solid paths={GATE_ART.beam} tone="hi" />
      <Line d={GATE_ART.beamLine} tone="mid" />
      <Dots points={GATE_ART.beamScrews} size={0.55} tone="mid" />
      <Solid paths={GATE_ART.knob} tone="mid" />
      <Line d={GATE_ART.knobTop} tone="lo" />
      <Solid paths={GATE_ART.pointer} tone="hi" />
      <FaceText transform={GATE_ART.label} size={2.8} tone="mid">
        verifyCandidateStream
      </FaceText>

      {/* the loom — gate to dial, gate to screen */}
      <Wire {...CABLE_DIAL} tone="mid" />
      <Wire {...CABLE_SCREEN} tone="mid" />

      {/* needle pivot reads over the dial face */}
      <circle
        className="iso-wire-end"
        cx={NEEDLE_HUB[0]}
        cy={NEEDLE_HUB[1]}
        r={1.1}
        fill="var(--anatomy-lit)"
      />
    </ResolveGateLive>
  );
}
