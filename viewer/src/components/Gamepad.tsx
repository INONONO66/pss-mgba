import type { GameButton } from "../api/types";

const DPAD: Array<{ button: GameButton; label: string; gridArea: string }> = [
  { button: "Up", label: "\u25b2", gridArea: "1/2" },
  { button: "Left", label: "\u25c0", gridArea: "2/1" },
  { button: "Right", label: "\u25b6", gridArea: "2/3" },
  { button: "Down", label: "\u25bc", gridArea: "3/2" },
];

function sendPress(button: GameButton) {
  fetch("/api/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ button, frames: 5 }),
  }).catch(() => undefined);
}

export default function Gamepad() {
  return (
    <div className="card v2-gamepad">
      <div className="v2-dpad">
        {DPAD.map((d) => (
          <button type="button" key={d.button} className="v2-dpad-btn" style={{ gridArea: d.gridArea }} onClick={() => sendPress(d.button)}>{d.label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="v2-meta-btn" onClick={() => sendPress("Select")}>SELECT</button>
        <button type="button" className="v2-meta-btn" onClick={() => sendPress("Start")}>START</button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="v2-action-btn v2-action-b" onClick={() => sendPress("B")}>B</button>
        <button type="button" className="v2-action-btn v2-action-a" onClick={() => sendPress("A")}>A</button>
      </div>
    </div>
  );
}
