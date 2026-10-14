import { Plate } from "../react/draw";
import { ResolveGateArt } from "./art";

import "../iso.css";
import "./resolve-gate.css";

export function ResolveGateFigure() {
  return (
    <div className="iso">
      <Plate
        fig="Fig 1"
        title="The resolve gate"
        hint="it never stops probing"
        readout="probed 0 · passed 0 · dropped 0"
        keys={[
          { mark: "lit", label: "A live candidate on the rail" },
          { mark: "dim", label: "The verdict arc — red side drops" },
          { mark: "edge", label: "The loom — probe signal to dial and screen" },
        ]}
        caption="Every stream a provider returns is a candidate, nothing more. Each one rides the rail to the gate; the plunger stamps it — a real probe of the URL — and the dial reads out the verdict. Pass and it parks at the mpv screen; fail and it drops straight into the dead hopper. A provider never reports success for a stream it has not probed: the gate is the only path to the screen."
      >
        <ResolveGateArt />
      </Plate>
    </div>
  );
}
