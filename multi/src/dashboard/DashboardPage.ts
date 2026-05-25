export function renderDashboard(): string {
  return '<!DOCTYPE html>' +
  '<html lang="en">' +
  '<head>' +
  '  <meta charset="utf-8">' +
  '  <meta name="viewport" content="width=device-width, initial-scale=1">' +
  '  <title>mGBA Gateway Dashboard</title>' +
  '  <script src="https://cdn.jsdelivr.net/npm/web-animations-js@2.3.2/web-animations.min.js"></script>' +
  '  <script src="https://cdn.jsdelivr.net/npm/muuri@0.9.5/dist/muuri.min.js"></script>' +
  '  <style>' +
  '    :root {' +
  '      --bg: #0d1117; --surface: #161b22; --border: #30363d;' +
  '      --text: #c9d1d9; --text-dim: #8b949e; --accent: #58a6ff;' +
  '      --green: #3fb950; --red: #f85149; --yellow: #d29922;' +
  '    }' +
  '    * { box-sizing: border-box; margin: 0; padding: 0; }' +
  '    html, body { height: 100%; }' +
  '    body { background: var(--bg); color: var(--text); font-family: -apple-system, monospace; overflow: hidden; }' +
  '    #header { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--surface); }' +
  '    #header-left { display: flex; align-items: center; gap: 8px; }' +
  '    #header-left .title { font-size: 16px; font-weight: bold; }' +
  '    #conn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); }' +
  '    #conn-dot.connected { background: var(--green); }' +
  '    #header-right { display: flex; align-items: center; gap: 12px; }' +
  '    #instance-count { font-size: 12px; color: var(--text-dim); }' +
  '    #add-btn {' +
  '      background: var(--accent); border: none; color: #000; border-radius: 6px;' +
  '      padding: 6px 12px; cursor: pointer; font-family: monospace; font-size: 12px; font-weight: bold;' +
  '    }' +
  '    #add-btn:hover { opacity: 0.9; }' +
  '    #grid { position: relative; width: 100%; height: calc(100vh - 48px); overflow-y: auto; }' +
  '    .muuri-item { position: absolute; z-index: 1; }' +
  '    .muuri-item.muuri-item-hidden { z-index: 0; }' +
  '    .muuri-item.muuri-item-releasing { z-index: 2; }' +
  '    .muuri-item.muuri-item-dragging { z-index: 3; }' +
  '    .muuri-item-content { position: relative; width: 100%; height: 100%; }' +
  '    .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; width: 100%; height: 100%; cursor: pointer; }' +
  '    .tile-header { height: 24px; display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 11px; cursor: grab; background: rgba(0,0,0,0.2); user-select: none; }' +
  '    .tile-header:active { cursor: grabbing; }' +
  '    .led { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex-shrink: 0; }' +
  '    .led.error { background: var(--red); }' +
  '    .led.starting { background: var(--yellow); }' +
  '    .tile-id { color: var(--text-dim); }' +
  '    .tile canvas { display: block; width: 100%; height: calc(100% - 24px); background: #000; }' +
  '    ::-webkit-scrollbar { width: 8px; }' +
  '    ::-webkit-scrollbar-track { background: var(--bg); }' +
  '    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }' +
  '    ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }' +
  '    /* Modal */' +
  '    #modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center; }' +
  '    #modal-backdrop.open { display: flex; }' +
  '    #modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; }' +
  '    #modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }' +
  '    #modal-title { font-size: 14px; font-weight: bold; }' +
  '    #modal-status { font-size: 11px; color: var(--text-dim); margin-top: 2px; }' +
  '    #modal-close { background: none; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; padding: 0 4px; }' +
  '    #modal-close:hover { color: var(--text); }' +
  '    #modal-canvas-wrap { width: 100%; aspect-ratio: 256 / 224; background: #000; border-radius: 6px; overflow: hidden; }' +
  '    #modal-canvas { display: block; width: 100%; height: 100%; }' +
  '    .modal-controls { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 12px; }' +
  '    .dpad { display: grid; grid-template: 32px 32px 32px / 32px 32px 32px; gap: 2px; }' +
  '    .dpad .btn { background: var(--border); border: none; color: var(--text); border-radius: 4px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }' +
  '    .dpad .btn:active { background: var(--accent); }' +
  '    .dpad .blank { visibility: hidden; }' +
  '    .action-btns { display: flex; gap: 4px; }' +
  '    .action-btns .btn { width: 40px; height: 32px; background: var(--border); border: none; color: var(--text); border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; }' +
  '    .action-btns .btn:active { background: var(--accent); }' +
  '    #modal-log { margin-top: 12px; max-height: 120px; overflow-y: auto; font-size: 11px; background: var(--bg); border-radius: 4px; padding: 8px; border: 1px solid var(--border); }' +
  '    #modal-log div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.5; color: var(--text-dim); }' +
  '  </style>' +
  '</head>' +
  '<body>' +
  '  <div id="header">' +
  '    <div id="header-left">' +
  '      <span class="title">mGBA Gateway</span>' +
  '      <span id="conn-dot"></span>' +
  '    </div>' +
  '    <div id="header-right">' +
  '      <span id="instance-count">0 instances</span>' +
  '      <button id="add-btn">+ Add Instance</button>' +
  '    </div>' +
  '  </div>' +
  '  <div id="grid"></div>' +
  '  <div id="modal-backdrop">' +
  '    <div id="modal">' +
  '      <div id="modal-header">' +
  '        <div>' +
  '          <div id="modal-title">Instance #0</div>' +
  '          <div id="modal-status">Status: running</div>' +
  '        </div>' +
  '        <button id="modal-close">&times;</button>' +
  '      </div>' +
  '      <div id="modal-canvas-wrap">' +
  '        <canvas id="modal-canvas" width="512" height="448"></canvas>' +
  '      </div>' +
  '      <div class="modal-controls">' +
  '        <div class="dpad">' +
  '          <div class="blank"></div>' +
  '          <button class="btn" data-btn="Up">&#x25B2;</button>' +
  '          <div class="blank"></div>' +
  '          <button class="btn" data-btn="Left">&#x25C4;</button>' +
  '          <button class="btn" data-btn="Down">&#x25BC;</button>' +
  '          <button class="btn" data-btn="Right">&#x25BA;</button>' +
  '          <div class="blank"></div>' +
  '          <div class="blank"></div>' +
  '          <div class="blank"></div>' +
  '        </div>' +
  '        <div class="action-btns">' +
  '          <button class="btn" data-btn="B">B</button>' +
  '          <button class="btn" data-btn="A">A</button>' +
  '          <button class="btn" data-btn="Select">Sel</button>' +
  '          <button class="btn" data-btn="Start">St</button>' +
  '        </div>' +
  '      </div>' +
  '      <div id="modal-log"></div>' +
  '    </div>' +
  '  </div>' +
  '  <script>' +
  '    var adminToken = localStorage.getItem(\'pss-mgba-admin-token\')' +
  '    if (!adminToken) {' +
  '      adminToken = prompt(\'Enter admin token for dashboard controls:\')' +
  '      if (adminToken) localStorage.setItem(\'pss-mgba-admin-token\', adminToken)' +
  '    }' +
  '' +
  '    var tiles = new Map()' +
  '    var instanceMap = new Map()' +
  '    var modalIndex = null' +
  '    var modalCtx = null' +
  '    var grid = null' +
  '' +
  '    var gridEl = document.getElementById(\'grid\')' +
  '    var connDot = document.getElementById(\'conn-dot\')' +
  '    var instanceCount = document.getElementById(\'instance-count\')' +
  '    var modalBackdrop = document.getElementById(\'modal-backdrop\')' +
  '    var modalTitle = document.getElementById(\'modal-title\')' +
  '    var modalStatus = document.getElementById(\'modal-status\')' +
  '    var modalCanvas = document.getElementById(\'modal-canvas\')' +
  '    var modalLog = document.getElementById(\'modal-log\')' +
  '' +
  '    modalCtx = modalCanvas.getContext(\'2d\')' +
  '' +
  '    function getTileSize(count) {' +
  '      var cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 6 ? 3 : 4' +
  '      var headerH = 48' +
  '      var gap = 8' +
  '      var availW = window.innerWidth - gap * (cols + 1)' +
  '      var tileW = Math.floor(availW / cols)' +
  '      var rows = Math.ceil(Math.min(count, 8) / cols)' +
  '      var availH = window.innerHeight - headerH - gap * (rows + 1)' +
  '      var tileH = Math.floor(availH / rows)' +
  '      var aspectW = tileH * (256 / 224)' +
  '      if (aspectW > tileW) { tileH = Math.floor(tileW * (224 / 256)) }' +
  '      else { tileW = Math.floor(aspectW) }' +
  '      return { w: tileW, h: tileH + 24, cols: cols }' +
  '    }' +
  '' +
  '    function resizeAllTiles() {' +
  '      var count = tiles.size' +
  '      if (count === 0) return' +
  '      var size = getTileSize(count)' +
  '      tiles.forEach(function (tileData) {' +
  '        tileData.el.style.width = size.w + \'px\'' +
  '        tileData.el.style.height = size.h + \'px\'' +
  '      })' +
  '    }' +
  '' +
  '    function escapeHtml(str) {' +
  '      return str.replace(/&/g, \'&amp;\').replace(/</g, \'&lt;\').replace(/>/g, \'&gt;\')' +
  '    }' +
  '' +
  '    function createTileElement(instanceIndex, token, instanceId) {' +
  '      var item = document.createElement(\'div\')' +
  '      item.className = \'muuri-item\'' +
  '      var content = document.createElement(\'div\')' +
  '      content.className = \'muuri-item-content\'' +
  '      var tile = document.createElement(\'div\')' +
  '      tile.className = \'tile\'' +
  '      tile.dataset.index = String(instanceIndex)' +
  '' +
  '      var header = document.createElement(\'div\')' +
  '      header.className = \'tile-header\'' +
  '      var led = document.createElement(\'span\')' +
  '      led.className = \'led\'' +
  '      var idSpan = document.createElement(\'span\')' +
  '      idSpan.className = \'tile-id\'' +
  '      idSpan.textContent = \'#\' + instanceIndex' +
  '      header.appendChild(led)' +
  '      header.appendChild(idSpan)' +
  '' +
  '      var canvas = document.createElement(\'canvas\')' +
  '      canvas.width = 256' +
  '      canvas.height = 224' +
  '' +
  '      tile.appendChild(header)' +
  '      tile.appendChild(canvas)' +
  '      content.appendChild(tile)' +
  '      item.appendChild(content)' +
  '' +
  '      var ctx = canvas.getContext(\'2d\')' +
  '      var logLines = []' +
  '' +
  '      function addLog(msg) {' +
  '        var time = new Date().toLocaleTimeString()' +
  '        logLines.push(\'[\' + time + \'] \' + msg)' +
  '        if (logLines.length > 20) logLines.shift()' +
  '        if (modalIndex === instanceIndex) renderModalLog()' +
  '      }' +
  '' +
  '      function renderModalLog() {' +
  '        var html = logLines.slice(-20).map(function (line) {' +
  '          return \'<div>\' + escapeHtml(line) + \'</div>\'' +
  '        }).join(\'\')' +
  '        modalLog.innerHTML = html' +
  '        modalLog.scrollTop = modalLog.scrollHeight' +
  '      }' +
  '' +
  '      tile.addEventListener(\'click\', function () {' +
  '        openModal(instanceIndex)' +
  '      })' +
  '' +
  '      return {' +
  '        el: item,' +
  '        tileEl: tile,' +
  '        canvas: canvas,' +
  '        ctx: ctx,' +
  '        token: token,' +
  '        instanceId: instanceId,' +
  '        led: led,' +
  '        addLog: addLog,' +
  '        renderModalLog: renderModalLog,' +
  '        logLines: logLines,' +
  '        lastFrameTime: 0,' +
  '        frameCount: 0,' +
  '        fpsTimer: null' +
  '      }' +
  '    }' +
  '' +
  '    function openModal(instanceIndex) {' +
  '      var tileData = tiles.get(instanceIndex)' +
  '      if (!tileData) return' +
  '      modalIndex = instanceIndex' +
  '      modalTitle.textContent = \'Instance #\' + instanceIndex + \' \u2014 \' + tileData.token.slice(0, 8) + \'...\'' +
  '      modalStatus.textContent = \'Status: running\'' +
  '      tileData.renderModalLog()' +
  '      modalBackdrop.classList.add(\'open\')' +
  '    }' +
  '' +
  '    function closeModal() {' +
  '      modalIndex = null' +
  '      modalBackdrop.classList.remove(\'open\')' +
  '    }' +
  '' +
  '    document.getElementById(\'modal-close\').addEventListener(\'click\', closeModal)' +
  '    modalBackdrop.addEventListener(\'click\', function (e) {' +
  '      if (e.target === modalBackdrop) closeModal()' +
  '    })' +
  '' +
  '    function initGrid() {' +
  '      grid = new Muuri(\'#grid\', {' +
  '        dragEnabled: true,' +
  '        dragHandle: \'.tile-header\',' +
  '        layoutDuration: 300,' +
  '        layoutEasing: \'ease\',' +
  '        dragStartPredicate: { distance: 10 },' +
  '        layout: {' +
  '          fillGaps: true,' +
  '          rounding: false' +
  '        }' +
  '      })' +
  '    }' +
  '' +
  '    function ensureTile(instanceIndex, token, instanceId) {' +
  '      if (tiles.has(instanceIndex)) return tiles.get(instanceIndex)' +
  '      var tileData = createTileElement(instanceIndex, token, instanceId)' +
  '      if (grid) {' +
  '        grid.add(tileData.el)' +
  '        grid.refreshItems().layout()' +
  '      } else {' +
  '        gridEl.appendChild(tileData.el)' +
  '      }' +
  '      tiles.set(instanceIndex, tileData)' +
  '      resizeAllTiles()' +
  '      if (grid) grid.refreshItems().layout()' +
  '      return tileData' +
  '    }' +
  '' +
  '    function removeTile(instanceIndex) {' +
  '      var tileData = tiles.get(instanceIndex)' +
  '      if (!tileData) return' +
  '      if (grid) {' +
  '        var items = grid.getItems(tileData.el)' +
  '        grid.remove(items, { removeElements: true })' +
  '        grid.layout()' +
  '      } else if (tileData.el.parentElement) {' +
  '        tileData.el.parentElement.removeChild(tileData.el)' +
  '      }' +
  '      tiles.delete(instanceIndex)' +
  '      if (modalIndex === instanceIndex) closeModal()' +
  '      resizeAllTiles()' +
  '      if (grid) grid.refreshItems().layout()' +
  '    }' +
  '' +
  '    function updateInstanceCount() {' +
  '      instanceCount.textContent = instanceMap.size + \' instance\' + (instanceMap.size === 1 ? \'\' : \'s\')' +
  '    }' +
  '' +
  '    async function refreshInstances() {' +
  '      try {' +
  '        var url = \'/api/instances\' + (adminToken ? \'?admin_token=\' + encodeURIComponent(adminToken) : \'\')' +
  '        var resp = await fetch(url)' +
  '        if (!resp.ok) return' +
  '        var list = await resp.json()' +
  '        instanceMap.clear()' +
  '        list.forEach(function (inst) {' +
  '          instanceMap.set(inst.index, inst)' +
  '        })' +
  '        var activeIndices = new Set(list.map(function (inst) { return inst.index }))' +
  '        tiles.forEach(function (tileData, idx) {' +
  '          if (!activeIndices.has(idx)) {' +
  '            removeTile(idx)' +
  '          }' +
  '        })' +
  '        updateInstanceCount()' +
  '      } catch (err) {' +
  '        console.error(err)' +
  '      }' +
  '    }' +
  '' +
  '    // WebSocket' +
  '    var wsProto = location.protocol === \'https:\' ? \'wss:\' : \'ws:\'' +
  '    var wsUrl = wsProto + \'//\' + location.host + \'/ws/dashboard\'' +
  '    var ws = null' +
  '' +
  '    function connect() {' +
  '      ws = new WebSocket(wsUrl)' +
  '      ws.binaryType = \'arraybuffer\'' +
  '' +
  '      ws.onopen = function () {' +
  '        connDot.classList.add(\'connected\')' +
  '      }' +
  '' +
  '      ws.onclose = function () {' +
  '        connDot.classList.remove(\'connected\')' +
  '        setTimeout(connect, 2000)' +
  '      }' +
  '' +
  '      ws.onmessage = function (event) {' +
  '        var data = new Uint8Array(event.data)' +
  '        if (data.length < 5) return' +
  '' +
  '        var instanceIndex = data[0]' +
  '        var jpegBytes = data.slice(5)' +
  '' +
  '        var inst = instanceMap.get(instanceIndex)' +
  '        var token = inst ? inst.token : null' +
  '        if (!token) return' +
  '' +
  '        var tileData = tiles.get(instanceIndex)' +
  '        if (!tileData) {' +
  '          tileData = ensureTile(instanceIndex, token, inst.id)' +
  '        }' +
  '' +
  '        var now = performance.now()' +
  '        tileData.frameCount++' +
  '        if (!tileData.fpsTimer) {' +
  '          tileData.fpsTimer = setInterval(function () {' +
  '            tileData.frameCount = 0' +
  '          }, 1000)' +
  '        }' +
  '' +
  '        var blob = new Blob([jpegBytes], { type: \'image/jpeg\' })' +
  '        var url = URL.createObjectURL(blob)' +
  '        var img = new Image()' +
  '        img.onload = function () {' +
  '          tileData.ctx.drawImage(img, 0, 0, tileData.canvas.width, tileData.canvas.height)' +
  '          if (modalIndex === instanceIndex) {' +
  '            modalCtx.drawImage(img, 0, 0, modalCanvas.width, modalCanvas.height)' +
  '          }' +
  '          URL.revokeObjectURL(url)' +
  '        }' +
  '        img.onerror = function () {' +
  '          URL.revokeObjectURL(url)' +
  '        }' +
  '        img.src = url' +
  '      }' +
  '    }' +
  '' +
  '    document.getElementById(\'add-btn\').addEventListener(\'click\', function () {' +
  '      if (!adminToken) {' +
  '        alert(\'Admin token required\')' +
  '        return' +
  '      }' +
  '      fetch(\'/admin/instances\', {' +
  '        method: \'POST\',' +
  '        headers: {' +
  '          \'X-Admin-Token\': adminToken,' +
  '          \'Content-Type\': \'application/json\'' +
  '        }' +
  '      })' +
  '        .then(function (resp) {' +
  '          if (!resp.ok) throw new Error(\'HTTP \' + resp.status)' +
  '          return resp.json()' +
  '        })' +
  '        .then(function (data) {' +
  '          refreshInstances()' +
  '        })' +
  '        .catch(function (err) {' +
  '          console.error(\'Failed to add instance:\', err)' +
  '        })' +
  '    })' +
  '' +
  '    // Modal controls' +
  '    document.querySelectorAll(\'#modal .btn[data-btn]\').forEach(function (btn) {' +
  '      btn.addEventListener(\'click\', function (e) {' +
  '        e.stopPropagation()' +
  '        if (modalIndex === null) return' +
  '        var tileData = tiles.get(modalIndex)' +
  '        if (!tileData) return' +
  '        var button = btn.dataset.btn' +
  '        fetch(\'/api/v1/\' + encodeURIComponent(tileData.token) + \'/mgba-http/button/tap?button=\' + encodeURIComponent(button), { method: \'POST\' })' +
  '          .then(function (resp) {' +
  '            if (!resp.ok) { tileData.addLog(\'Failed \' + button + \' (HTTP \' + resp.status + \')\'); return }' +
  '            tileData.addLog(\'Pressed \' + button)' +
  '          })' +
  '          .catch(function (err) {' +
  '            tileData.addLog(\'Error \' + button + \': \' + err.message)' +
  '          })' +
  '      })' +
  '    })' +
  '' +
  '    window.addEventListener(\'resize\', function () {' +
  '      resizeAllTiles()' +
  '      if (grid) grid.refreshItems().layout()' +
  '    })' +
  '' +
  '    initGrid()' +
  '    connect()' +
  '    refreshInstances()' +
  '    setInterval(refreshInstances, 5000)' +
  '  </script>' +
  '</body>' +
  '</html>'
}
