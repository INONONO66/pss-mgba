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
      --text-dim: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body { background: var(--bg); color: var(--text); font-family: monospace; display: flex; flex-direction: column; }

    /* Toolbar */
    #toolbar {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-shrink: 0;
      background: var(--surface);
    }
    #toolbar-left, #toolbar-center, #toolbar-right { display: flex; align-items: center; gap: 12px; }
    #toolbar-left span.title { font-size: 18px; font-weight: bold; }
    #ws-status {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--border);
      color: var(--text-dim);
    }
    #ws-status.connected { background: rgba(63,185,80,0.15); color: var(--green); }
    #ws-status.disconnected { background: rgba(248,81,73,0.15); color: var(--red); }

    .col-btn {
      background: var(--border);
      border: 1px solid var(--border);
      color: var(--text-dim);
      border-radius: 4px;
      width: 28px; height: 28px;
      cursor: pointer; font-family: monospace; font-size: 12px;
    }
    .col-btn:hover { border-color: var(--accent); color: var(--text); }
    .col-btn.active { background: var(--accent); color: #000; border-color: var(--accent); }

    #add-btn {
      background: var(--accent);
      border: none;
      color: #000;
      border-radius: 6px;
      padding: 6px 12px;
      cursor: pointer;
      font-family: monospace;
      font-size: 12px;
      font-weight: bold;
    }
    #add-btn:hover { opacity: 0.9; }
    #admin-badge {
      font-size: 11px;
      color: var(--text-dim);
      background: var(--bg);
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid var(--border);
    }
    #instance-count { font-size: 12px; color: var(--text-dim); }

    /* Grid */
    #grid-wrap {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    #grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(var(--cols, 3), 1fr);
    }

    /* Tile */
    .tile {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: border-color 0.15s, opacity 0.15s, box-shadow 0.15s;
    }
    .tile.dragging { opacity: 0.4; }
    .tile.drag-over { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(88,166,255,0.25); }
    .tile.focused {
      grid-column: 1 / -1;
    }
    .tile-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      user-select: none;
    }
    .drag-handle {
      cursor: grab;
      color: var(--text-dim);
      font-size: 14px;
      line-height: 1;
    }
    .drag-handle:active { cursor: grabbing; }
    .tile-title { flex: 1; min-width: 0; }
    .tile-title .idx { color: var(--text-dim); }
    .tile-title .tok {
      color: var(--text);
      margin-left: 4px;
    }
    .led {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--green); flex-shrink: 0;
    }
    .led.error { background: var(--red); }
    .led.starting { background: var(--yellow); }
    .fps {
      font-size: 11px;
      color: var(--text-dim);
      min-width: 36px;
      text-align: right;
    }

    .tile-canvas-wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 256 / 224;
      background: #000;
    }
    .tile-canvas-wrap canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }

    .tile-controls {
      padding: 8px 10px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .dpad {
      display: grid;
      grid-template-columns: repeat(3, 28px);
      grid-template-rows: repeat(2, 28px);
      gap: 2px;
    }
    .dpad .btn {
      background: var(--border);
      border: none;
      color: var(--text);
      border-radius: 4px;
      cursor: pointer;
      font-family: monospace;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .dpad .btn:hover { background: var(--accent); color: #000; }
    .dpad .btn:active { opacity: 0.8; }
    .dpad .blank { visibility: hidden; }
    .dpad .up    { grid-column: 2; grid-row: 1; }
    .dpad .left  { grid-column: 1; grid-row: 2; }
    .dpad .down  { grid-column: 2; grid-row: 2; }
    .dpad .right { grid-column: 3; grid-row: 2; }

    .action-row {
      display: flex;
      gap: 4px;
    }
    .action-row .btn {
      background: var(--border);
      border: none;
      color: var(--text);
      border-radius: 4px;
      cursor: pointer;
      font-family: monospace;
      font-size: 11px;
      padding: 0 8px;
      height: 28px;
    }
    .action-row .btn:hover { background: var(--accent); color: #000; }
    .action-row .btn:active { opacity: 0.8; }

    .tile-log {
      border-top: 1px solid var(--border);
      background: var(--bg);
      font-size: 11px;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease;
    }
    .tile-log.open { max-height: 80px; }
    .tile-log-inner {
      padding: 6px 10px;
      line-height: 1.4;
      color: var(--text-dim);
    }
    .tile-log-inner div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile-log-toggle {
      font-size: 10px;
      color: var(--text-dim);
      cursor: pointer;
      padding: 2px 10px;
      border-top: 1px solid var(--border);
      user-select: none;
    }
    .tile-log-toggle:hover { color: var(--accent); }

    /* Focused tile overrides */
    .tile.focused .tile-controls {
      padding: 12px 16px;
      gap: 16px;
    }
    .tile.focused .dpad {
      grid-template-columns: repeat(3, 40px);
      grid-template-rows: repeat(2, 40px);
      gap: 4px;
    }
    .tile.focused .dpad .btn { font-size: 14px; }
    .tile.focused .action-row .btn {
      height: 40px;
      padding: 0 16px;
      font-size: 14px;
    }
    .tile.focused .tile-log.open { max-height: 200px; }
    .tile.focused .tile-log-inner { font-size: 12px; padding: 8px 16px; }
    .tile.focused .tile-log-toggle { padding: 4px 16px; font-size: 11px; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }
  </style>
</head>
<body>
  <div id="toolbar">
    <div id="toolbar-left">
      <span class="title">mGBA Gateway</span>
      <span id="ws-status">Connecting...</span>
    </div>
    <div id="toolbar-center">
      <button class="col-btn" data-cols="1">1</button>
      <button class="col-btn" data-cols="2">2</button>
      <button class="col-btn" data-cols="3">3</button>
      <button class="col-btn" data-cols="4">4</button>
      <button class="col-btn" data-cols="5">5</button>
    </div>
    <div id="toolbar-right">
      <span id="instance-count">0 instances</span>
      <button id="add-btn">+ Add Instance</button>
      <span id="admin-badge">No admin</span>
    </div>
  </div>

  <div id="grid-wrap">
    <div id="grid"></div>
  </div>

  <script>
    var adminToken = localStorage.getItem('pss-mgba-admin-token')
    if (!adminToken) {
      adminToken = prompt('Enter admin token for dashboard controls:')
      if (adminToken) localStorage.setItem('pss-mgba-admin-token', adminToken)
    }

    var COLS_KEY = 'mgba-dashboard-cols'
    var ORDER_KEY = 'mgba-dashboard-order'
    var cols = parseInt(localStorage.getItem(COLS_KEY), 10) || 3
    var tileOrder = []
    try {
      var saved = JSON.parse(localStorage.getItem(ORDER_KEY))
      if (Array.isArray(saved)) tileOrder = saved
    } catch (e) {}

    var tiles = new Map()
    var instanceMap = new Map()
    var focusedIndex = null
    var dragSrcIndex = null

    var grid = document.getElementById('grid')
    var wsStatus = document.getElementById('ws-status')
    var instanceCount = document.getElementById('instance-count')
    var adminBadge = document.getElementById('admin-badge')

    adminBadge.textContent = adminToken ? 'Admin: ' + adminToken.slice(0, 6) + '...' : 'No admin'

    function setCols(n) {
      cols = Math.max(1, Math.min(5, n))
      localStorage.setItem(COLS_KEY, String(cols))
      grid.style.setProperty('--cols', String(cols))
      document.querySelectorAll('.col-btn').forEach(function (b) {
        b.classList.toggle('active', parseInt(b.dataset.cols, 10) === cols)
      })
    }

    document.querySelectorAll('.col-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setCols(parseInt(btn.dataset.cols, 10))
      })
    })
    setCols(cols)

    function saveOrder() {
      var order = []
      grid.querySelectorAll('.tile').forEach(function (t) {
        order.push(parseInt(t.dataset.index, 10))
      })
      tileOrder = order
      localStorage.setItem(ORDER_KEY, JSON.stringify(order))
    }

    function applyOrder() {
      if (!tileOrder.length) return
      var els = Array.from(grid.querySelectorAll('.tile'))
      els.sort(function (a, b) {
        var ai = tileOrder.indexOf(parseInt(a.dataset.index, 10))
        var bi = tileOrder.indexOf(parseInt(b.dataset.index, 10))
        if (ai === -1) ai = 9999
        if (bi === -1) bi = 9999
        return ai - bi
      })
      els.forEach(function (el) { grid.appendChild(el) })
    }

    function makeTileEl(instanceIndex, token, instanceId) {
      var tile = document.createElement('div')
      tile.className = 'tile'
      tile.dataset.index = String(instanceIndex)
      tile.draggable = true

      var header = document.createElement('div')
      header.className = 'tile-header'

      var handle = document.createElement('span')
      handle.className = 'drag-handle'
      handle.textContent = '\u2630'
      handle.title = 'Drag to reorder'

      var title = document.createElement('span')
      title.className = 'tile-title'
      title.innerHTML = '<span class="idx">#' + instanceIndex + '</span><span class="tok">' + escapeHtml(token.slice(0, 6)) + '...</span>'

      var led = document.createElement('div')
      led.className = 'led'

      var fps = document.createElement('span')
      fps.className = 'fps'
      fps.textContent = '0fps'

      header.appendChild(handle)
      header.appendChild(title)
      header.appendChild(led)
      header.appendChild(fps)

      var canvasWrap = document.createElement('div')
      canvasWrap.className = 'tile-canvas-wrap'
      var canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 224
      canvasWrap.appendChild(canvas)

      var controls = document.createElement('div')
      controls.className = 'tile-controls'
      controls.innerHTML =
        '<div class="dpad">' +
          '<div class="btn up" data-btn="Up">&#x25B2;</div>' +
          '<div class="btn left" data-btn="Left">&#x25C4;</div>' +
          '<div class="btn down" data-btn="Down">&#x25BC;</div>' +
          '<div class="btn right" data-btn="Right">&#x25BA;</div>' +
        '</div>' +
        '<div class="action-row">' +
          '<button class="btn" data-btn="B">B</button>' +
          '<button class="btn" data-btn="A">A</button>' +
          '<button class="btn" data-btn="Select">Sl</button>' +
          '<button class="btn" data-btn="Start">St</button>' +
        '</div>'

      var logToggle = document.createElement('div')
      logToggle.className = 'tile-log-toggle'
      logToggle.textContent = '> Log'

      var logWrap = document.createElement('div')
      logWrap.className = 'tile-log'
      var logInner = document.createElement('div')
      logInner.className = 'tile-log-inner'
      logWrap.appendChild(logInner)

      tile.appendChild(header)
      tile.appendChild(canvasWrap)
      tile.appendChild(controls)
      tile.appendChild(logToggle)
      tile.appendChild(logWrap)

      var ctx = canvas.getContext('2d')
      var logLines = []

      function addLog(msg) {
        var time = new Date().toLocaleTimeString()
        logLines.push('[' + time + '] ' + msg)
        if (logLines.length > 20) logLines.shift()
        renderLog()
      }

      function renderLog() {
        logInner.innerHTML = logLines.slice(-3).map(function (line) {
          return '<div>' + escapeHtml(line) + '</div>'
        }).join('')
      }

      logToggle.addEventListener('click', function () {
        logWrap.classList.toggle('open')
        logToggle.textContent = logWrap.classList.contains('open') ? 'v Log' : '> Log'
      })

      controls.querySelectorAll('.btn[data-btn]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation()
          var button = btn.dataset.btn
          fetch('/api/v1/' + encodeURIComponent(token) + '/mgba-http/button/tap?button=' + encodeURIComponent(button), { method: 'POST' })
            .then(function (resp) {
              if (!resp.ok) { addLog('Failed ' + button + ' (HTTP ' + resp.status + ')'); return }
              addLog('Pressed ' + button)
            })
            .catch(function (err) {
              addLog('Error ' + button + ': ' + err.message)
            })
        })
      })

      // Drag and drop
      tile.addEventListener('dragstart', function (e) {
        dragSrcIndex = instanceIndex
        tile.classList.add('dragging')
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(instanceIndex))
      })
      tile.addEventListener('dragend', function () {
        tile.classList.remove('dragging')
        grid.querySelectorAll('.tile.drag-over').forEach(function (t) { t.classList.remove('drag-over') })
        dragSrcIndex = null
        saveOrder()
      })
      tile.addEventListener('dragover', function (e) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (dragSrcIndex !== null && dragSrcIndex !== instanceIndex) {
          tile.classList.add('drag-over')
        }
      })
      tile.addEventListener('dragleave', function () {
        tile.classList.remove('drag-over')
      })
      tile.addEventListener('drop', function (e) {
        e.preventDefault()
        tile.classList.remove('drag-over')
        var srcIdx = parseInt(e.dataTransfer.getData('text/plain'), 10)
        if (isNaN(srcIdx) || srcIdx === instanceIndex) return
        var srcEl = grid.querySelector('.tile[data-index="' + srcIdx + '"]')
        var dstEl = grid.querySelector('.tile[data-index="' + instanceIndex + '"]')
        if (!srcEl || !dstEl) return
        var siblings = Array.from(grid.children)
        var srcPos = siblings.indexOf(srcEl)
        var dstPos = siblings.indexOf(dstEl)
        if (srcPos < dstPos) {
          grid.insertBefore(srcEl, dstEl.nextSibling)
        } else {
          grid.insertBefore(srcEl, dstEl)
        }
        saveOrder()
      })

      // Focus mode
      tile.addEventListener('dblclick', function () {
        if (focusedIndex === instanceIndex) {
          tile.classList.remove('focused')
          focusedIndex = null
          logWrap.classList.remove('open')
          logToggle.textContent = '> Log'
        } else {
          if (focusedIndex !== null) {
            var prev = grid.querySelector('.tile[data-index="' + focusedIndex + '"]')
            if (prev) {
              prev.classList.remove('focused')
              prev.querySelector('.tile-log').classList.remove('open')
              prev.querySelector('.tile-log-toggle').textContent = '> Log'
            }
          }
          tile.classList.add('focused')
          focusedIndex = instanceIndex
          logWrap.classList.add('open')
          logToggle.textContent = 'v Log'
        }
      })

      return {
        el: tile,
        canvas: canvas,
        ctx: ctx,
        token: token,
        instanceId: instanceId,
        led: led,
        fps: fps,
        addLog: addLog,
        lastFrameTime: 0,
        frameCount: 0,
        fpsTimer: null
      }
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    function ensureTile(instanceIndex, token, instanceId) {
      if (tiles.has(instanceIndex)) return tiles.get(instanceIndex)
      var tileData = makeTileEl(instanceIndex, token, instanceId)
      grid.appendChild(tileData.el)
      tiles.set(instanceIndex, tileData)
      applyOrder()
      return tileData
    }

    function updateInstanceCount() {
      instanceCount.textContent = instanceMap.size + ' instance' + (instanceMap.size === 1 ? '' : 's')
    }

    async function refreshInstances() {
      try {
        var url = '/api/instances' + (adminToken ? '?admin_token=' + encodeURIComponent(adminToken) : '')
        var resp = await fetch(url)
        if (!resp.ok) return
        var list = await resp.json()
        instanceMap.clear()
        list.forEach(function (inst) {
          instanceMap.set(inst.index, inst)
        })
        var activeIndices = new Set(list.map(function (inst) { return inst.index }))
        tiles.forEach(function (tileData, idx) {
          if (!activeIndices.has(idx)) {
            if (tileData.el && tileData.el.parentElement) {
              tileData.el.parentElement.removeChild(tileData.el)
            }
            tiles.delete(idx)
          }
        })
        updateInstanceCount()
      } catch (err) {
        console.error(err)
      }
    }

    // WebSocket
    var wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    var wsUrl = wsProto + '//' + location.host + '/ws/dashboard'
    var ws = null

    function connect() {
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'

      ws.onopen = function () {
        wsStatus.textContent = 'Connected'
        wsStatus.className = 'connected'
      }

      ws.onclose = function () {
        wsStatus.textContent = 'Disconnected \u2014 reconnecting...'
        wsStatus.className = 'disconnected'
        setTimeout(connect, 2000)
      }

      ws.onmessage = function (event) {
        var data = new Uint8Array(event.data)
        if (data.length < 5) return

        var instanceIndex = data[0]
        var jpegBytes = data.slice(5)

        var inst = instanceMap.get(instanceIndex)
        var token = inst ? inst.token : null
        if (!token) return

        var tileData = tiles.get(instanceIndex)
        if (!tileData) {
          tileData = ensureTile(instanceIndex, token, inst.id)
        }

        var now = performance.now()
        tileData.frameCount++
        if (!tileData.fpsTimer) {
          tileData.fpsTimer = setInterval(function () {
            tileData.fps.textContent = tileData.frameCount + 'fps'
            tileData.frameCount = 0
          }, 1000)
        }

        var blob = new Blob([jpegBytes], { type: 'image/jpeg' })
        var url = URL.createObjectURL(blob)
        var img = new Image()
        img.onload = function () {
          tileData.ctx.drawImage(img, 0, 0, tileData.canvas.width, tileData.canvas.height)
          URL.revokeObjectURL(url)
        }
        img.onerror = function () {
          URL.revokeObjectURL(url)
        }
        img.src = url
      }
    }

    document.getElementById('add-btn').addEventListener('click', function () {
      if (!adminToken) {
        alert('Admin token required')
        return
      }
      fetch('/admin/instances', {
        method: 'POST',
        headers: {
          'X-Admin-Token': adminToken,
          'Content-Type': 'application/json'
        }
      })
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status)
          return resp.json()
        })
        .then(function (data) {
          refreshInstances()
        })
        .catch(function (err) {
          console.error('Failed to add instance:', err)
        })
    })

    connect()
    refreshInstances()
    setInterval(refreshInstances, 5000)
  </script>
</body>
</html>`
}
