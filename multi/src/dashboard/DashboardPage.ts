export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mGBA Gateway Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: monospace; }
    #header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    #grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
      padding: 16px;
    }
    .tile {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .tile:hover { border-color: var(--accent); }
    .tile-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .led {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
    }
    .led.error { background: var(--red); }
    .led.starting { background: var(--yellow); }
    canvas {
      width: 100%;
      height: auto;
      display: block;
      background: #000;
      border-radius: 4px;
    }
    #overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    #overlay.open { display: flex; }
    #expanded {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      max-width: 700px;
      width: 90%;
    }
    #expanded canvas {
      width: 100%;
      max-height: 400px;
      object-fit: contain;
    }
    .controls {
      display: grid;
      grid-template-columns: repeat(4, 40px);
      gap: 6px;
      margin-top: 12px;
      justify-content: center;
    }
    .btn {
      background: var(--border);
      border: none;
      color: var(--text);
      border-radius: 6px;
      padding: 8px;
      cursor: pointer;
      font-family: monospace;
      font-size: 12px;
    }
    .btn:hover { background: var(--accent); color: #000; }
    #log {
      margin-top: 12px;
      height: 100px;
      overflow-y: auto;
      font-size: 11px;
      background: var(--bg);
      border-radius: 4px;
      padding: 8px;
      border: 1px solid var(--border);
    }
    #close-btn {
      float: right;
      background: none;
      border: none;
      color: var(--text);
      cursor: pointer;
      font-size: 18px;
    }
  </style>
</head>
<body>
  <div id="header">
    <span style="font-size:18px;font-weight:bold">mGBA Gateway</span>
    <span id="status" style="font-size:12px;color:var(--accent)">Connecting...</span>
  </div>
  <div id="grid"></div>
  <div id="overlay">
    <div id="expanded">
      <button id="close-btn">&#x2715;</button>
      <div id="exp-header" style="margin-bottom:8px;font-size:13px"></div>
      <canvas id="exp-canvas" width="256" height="224"></canvas>
      <div class="controls">
        <div></div><button class="btn" data-btn="Up">&#x25B2;</button><div></div><div></div>
        <button class="btn" data-btn="Left">&#x25C4;</button>
        <button class="btn" data-btn="Down">&#x25BC;</button>
        <button class="btn" data-btn="Right">&#x25BA;</button>
        <div></div>
        <div></div><div></div>
        <button class="btn" data-btn="B">B</button>
        <button class="btn" data-btn="A">A</button>
        <button class="btn" data-btn="Select">Sel</button>
        <button class="btn" data-btn="Start">Sta</button>
        <div></div><div></div>
      </div>
      <div id="log"></div>
    </div>
  </div>
  <script>
    var adminToken = localStorage.getItem('pss-mgba-admin-token')
    if (!adminToken) {
      adminToken = prompt('Enter admin token for dashboard controls:')
      if (adminToken) localStorage.setItem('pss-mgba-admin-token', adminToken)
    }

    // State
    const tiles = new Map()
    const instanceMap = new Map()
    let expandedToken = null
    const expCanvas = document.getElementById('exp-canvas')
    const expCtx = expCanvas.getContext('2d')
    const grid = document.getElementById('grid')
    const overlay = document.getElementById('overlay')
    const log = document.getElementById('log')

    // WebSocket connection
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = wsProto + '//' + location.host + '/ws/dashboard'
    let ws = null

    async function refreshInstances() {
      try {
        const resp = await fetch('/api/instances' + (adminToken ? '?admin_token=' + encodeURIComponent(adminToken) : ''))
        if (!resp.ok) return

        const list = await resp.json()
        instanceMap.clear()
        list.forEach(function (inst) {
          instanceMap.set(inst.index, inst)
        })
        var activeIndices = new Set(list.map(function(inst) { return inst.index }))
        tiles.forEach(function(tileData, idx) {
          if (!activeIndices.has(idx)) {
            var el = tileData.canvas.parentElement
            if (el && el.parentElement) el.parentElement.removeChild(el)
            tiles.delete(idx)
          }
        })
      } catch (error) {
        console.error(error)
      }
    }

    function connect() {
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'

      ws.onopen = function () {
        document.getElementById('status').textContent = 'Connected'
      }

      ws.onclose = function () {
        document.getElementById('status').textContent = 'Disconnected — reconnecting...'
        setTimeout(connect, 2000)
      }

      ws.onmessage = function (event) {
        const data = new Uint8Array(event.data)
        if (data.length < 5) return

        const instanceIndex = data[0]
        const jpegBytes = data.slice(5)

        const inst = instanceMap.get(instanceIndex)
        const token = inst ? inst.token : null
        if (!token) return

        // Ensure tile exists for this instance
        if (!tiles.has(instanceIndex)) {
          ensureTile(instanceIndex, token, inst.id)
        }

        const blob = new Blob([jpegBytes], { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = function () {
          const tile = tiles.get(instanceIndex)
          if (tile) {
            tile.ctx.drawImage(img, 0, 0, tile.canvas.width, tile.canvas.height)
            if (expandedToken === tile.token) {
              expCtx.drawImage(img, 0, 0, expCanvas.width, expCanvas.height)
            }
          }
          URL.revokeObjectURL(url)
        }
        img.onerror = function () {
          URL.revokeObjectURL(url)
        }
        img.src = url
      }
    }

    function ensureTile(instanceIndex, token, instanceId) {
      if (tiles.has(instanceIndex)) return

      const tile = document.createElement('div')
      tile.className = 'tile'
      tile.dataset.index = String(instanceIndex)

      const header = document.createElement('div')
      header.className = 'tile-header'

      const led = document.createElement('div')
      led.className = 'led'

      const info = document.createElement('span')
      info.textContent = '#' + instanceIndex + ' ' + token.slice(0, 8) + '...'

      header.appendChild(led)
      header.appendChild(info)

      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 224
      const ctx = canvas.getContext('2d')

      tile.appendChild(header)
      tile.appendChild(canvas)
      grid.appendChild(tile)

      const tileData = { canvas: canvas, ctx: ctx, token: token, instanceId: instanceId, led: led }
      tiles.set(instanceIndex, tileData)

      tile.addEventListener('click', function () {
        expandTile(instanceIndex)
      })
    }

    function expandTile(instanceIndex) {
      const tile = tiles.get(instanceIndex)
      if (!tile) return
      expandedToken = tile.token
      document.getElementById('exp-header').textContent = 'Instance #' + instanceIndex + ' — ' + tile.token.slice(0, 16) + '...'
      overlay.classList.add('open')
      addLog('Expanded instance #' + instanceIndex)
    }

    function addLog(msg) {
      const line = document.createElement('div')
      line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg
      log.appendChild(line)
      log.scrollTop = log.scrollHeight
    }

    document.getElementById('close-btn').addEventListener('click', function () {
      overlay.classList.remove('open')
      expandedToken = null
    })

    document.querySelectorAll('.btn[data-btn]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!expandedToken) return
        const button = btn.dataset.btn
        fetch('/api/v1/' + expandedToken + '/mgba-http/button/tap?button=' + encodeURIComponent(button), { method: 'POST' })
          .then(function (resp) {
            if (!resp.ok) { addLog('Failed ' + button + ' (HTTP ' + resp.status + ')'); return }
            addLog('Pressed ' + button)
          })
          .catch(function (e) {
            addLog('Error pressing ' + button + ': ' + e.message)
          })
      })
    })

    connect()
    refreshInstances()
    setInterval(refreshInstances, 5000)
  </script>
</body>
</html>`
}
