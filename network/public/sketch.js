let mappa = new Mappa("Leaflet");
let myMap;
let canvas;  // p5 canvas
let currentLongitude = 0;
let currentLatitude = 0;
let mapInit = false;
let me; // MyPoint instance

// user identity
let username = localStorage.getItem("user-nameTEST");

// === Day system: 2 real-world minutes = 1 virtual day; 2 days since last message = broken ===
// Uses wall-clock time (Date.now()) — no tab-visibility tracking needed.
// Both users independently compute the same day number, so broken-connection state is identical.
const MS_PER_DAY = 2 * 60 * 1000;

function getOnlineTime() { return Date.now(); }

// Per-pair wall-clock timestamps of last message (persisted, v4 = wall-clock based)
let lastMsgTimes = JSON.parse(localStorage.getItem("network-last-msg-times-v4") || "{}");
// Permanently broken pairs (persisted, v3)
let brokenConnPairs = new Set(JSON.parse(localStorage.getItem("network-broken-conns-v3") || "[]"));
let currentInAppDay = Math.floor(Date.now() / MS_PER_DAY);
let prevInAppDay = currentInAppDay;

// Assign a stable userId per browser, persisted across reloads
function getOrCreateUserId() {
  let userID = localStorage.getItem("user-id");
  if (userID == undefined) {
    userID = crypto.randomUUID();
    localStorage.setItem("user-id", userID);
  }
  return userID;
}

const myUserId = getOrCreateUserId();
console.log("My userId:", myUserId);

let myInfo = { userId: myUserId, username: username };

// Auth: tell the server who we are before any event fires
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/ting/port-4280/socket.io", auth: myInfo });
} else {
  socket = io({ auth: myInfo });
}

// State variables
let pendingLocation = null;   // double-tap → dashed circle → pending location
let selectedUserId = null;    // single-tap: the user I tapped
let inspectedUserId = null;   // double-tap on connected user: inspect their chat web

// Data
let connections = [];
let loopingMessages = {};
let pendingMessages = {}; // queued next message per key, promoted when current loop enters pause
/* MESSAGE key = "fromUserId-toUserId" (directional; A→B and B→A are two separate keys)
   value = { fromUserId, toUserId, text, duration, charDelay, startTime } */

// Touch-event state
let changingLocation = false;
let lastTouch = 0;
let doubleTouchInterval = 250;
let lastPoint = 0;
let touchStartTime = 0;
let touchStartX = 0;
let touchStartY = 0;
let isDoubleTap = false;
let longPressThreshold = 500;
let wasMultiTouch = false;  // prevents interference with pinch-zoom

// History mode
let clientMessages = [];       // full message log
let historyViewUserId = null;
let historyStartTime = 0;

let newUserComing = [];

// blink: userId → blink-end timestamp (ms)
let blinkingUsers = {};

// Suppress the browser's long-press context menu
document.addEventListener("contextmenu", function (e) {
  e.preventDefault();
});

// Re-identify to server on every (re)connect
socket.on("connect", function () {
  socket.emit("identify", myInfo);
});

// Auto-request GPS on page load
requestGPS();

// ============================================================
// Touch helpers
// ============================================================

// Return the userId of the user whose circle was hit at (tx, ty), or null.
// Skips "me" when skipSelf is true.
function findUserAtTouch(tx, ty, skipSelf) {
  for (let loc of locations) {
    if (skipSelf && loc.userId === myUserId) continue;
    let pos = myMap.latLngToPixel(loc.lat, loc.lng);
    let d = dist(tx, ty, pos.x, pos.y);
    if (d < metersToPixel(10, loc.lat) + 10) return loc.userId;
  }
  return null;
}

/* TOUCH EVENT */
function touchStarted() {
  if (!mapInit) return;

  // Multi-touch (pinch-zoom): ignore all single-touch gestures
  if (touches.length > 1) {
    wasMultiTouch = true;
    return false;
  }
  wasMultiTouch = false;
  if (!touches[0]) return;

  touchStartX = touches[0].x;
  touchStartY = touches[0].y;

  const isSecondTap =
    millis() - lastTouch < doubleTouchInterval &&
    millis() - lastPoint > 1000;

  if (isSecondTap) {
    // Double-tap confirmed
    isDoubleTap = true;
    lastPoint = millis();

    if (changingLocation) {
      // Save the pending map position and show the confirm button
      let pos = myMap.pixelToLatLng(touches[0].x, touches[0].y);
      pendingLocation = { lat: pos.lat, lng: pos.lng };
      document.getElementById("confirmLocationGroup").style.display = "flex";
      document.getElementById("locationHint").style.display = "none";
    } else {
      // Double-tap on a connected user → toggle inspect view
      let tappedUserId = findUserAtTouch(touches[0].x, touches[0].y, true);
      if (tappedUserId) {
        let connected = clientMessages.some(function (m) {
          return (m.fromUserId === myUserId && m.toUserId === tappedUserId) ||
                 (m.fromUserId === tappedUserId && m.toUserId === myUserId);
        });
        if (connected) {
          inspectedUserId = inspectedUserId === tappedUserId ? null : tappedUserId;
        }
      }
    }
  } else {
    // Not a double-tap yet; may be single-tap or long-press — decide on touch-end
    isDoubleTap = false;
    touchStartTime = millis();
  }
}

function touchEnded() {
  lastTouch = millis(); // record for double-tap detection

  // Ignore if map not ready, was a double-tap, or was multi-touch (pinch-zoom)
  if (!mapInit || isDoubleTap || wasMultiTouch) {
    isDoubleTap = false;
    if (touches.length === 0) wasMultiTouch = false;
    return;
  }

  let touchDuration = millis() - touchStartTime;
  let foundUserId = findUserAtTouch(touchStartX, touchStartY, true);

  // Long press → enter (or exit) history mode
  if (touchDuration >= longPressThreshold && foundUserId) {
    if (historyViewUserId === foundUserId) {
      exitHistoryView();
    } else {
      historyViewUserId = foundUserId;
      historyStartTime = Date.now();
    }
    return;
  }

  // Single tap: select or deselect a user
  if (foundUserId) {
    selectedUserId = foundUserId;
    // Leave history mode if a different user is tapped
    if (historyViewUserId && historyViewUserId !== foundUserId) exitHistoryView();
    socket.emit("connection-from-client", { toUserId: selectedUserId });
  } else {
    // Tap on empty space: clear selection and inspection
    selectedUserId = null;
    inspectedUserId = null;
    socket.emit("connection-from-client", { toUserId: null });
  }
}

// Change Location button
document.getElementById("changeLocationButton").addEventListener("click", function () {
  changingLocation = true;
  this.style.display = "none";
  document.getElementById("locationHint").style.display = "block";
});

function exitLocationMode() {
  pendingLocation = null;
  changingLocation = false;
  const btn = document.getElementById("changeLocationButton");
  btn.style.display = "block";
  syncLocationButton();
  document.getElementById("confirmLocationGroup").style.display = "none";
  document.getElementById("locationHint").style.display = "none";
}

// Confirm Location button
document.getElementById("confirmLocationButton").addEventListener("click", function () {
  if (pendingLocation) {
    updateOrAddLocation({
      lat: pendingLocation.lat,
      lng: pendingLocation.lng,
      userId: myUserId,
      username: username,
    });
    socket.emit("location-from-client", pendingLocation);
    exitLocationMode();
  }
});

// Cancel location-change mode button
document.getElementById("cancelLocationButton").addEventListener("click", exitLocationMode);

// ============================================================
// Location data
// ============================================================
let locations = []; // { userId, username, lat, lng }

function findLocByUserId(userId) {
  for (let loc of locations) {
    if (loc.userId === userId) return loc;
  }
  return null;
}

function updateOrAddLocation(data) {
  const i = locations.findIndex(loc => loc.userId === data.userId);
  if (i >= 0) locations[i] = data;
  else locations.push(data);
}

function exitHistoryView() {
  historyViewUserId = null;
  delete loopingMessages["__history__"];
}

// Compute travel duration (ms) from real geo distance.
// speed in m/s, min = minimum ms, fallback used when locations are missing.
function computeTravelDuration(fromLoc, toLoc, speed, min, fallback) {
  if (!fromLoc || !toLoc) return fallback;
  return Math.max(min, (geoDistanceMeters(fromLoc.lat, fromLoc.lng, toLoc.lat, toLoc.lng) / speed) * 1000);
}

// Total duration of one full message loop (ms):
// characters leave one by one (charDelay apart), last char travels for duration, then pause.
function cycleLen(text, charDelay, duration, pause) {
  return (text.length - 1) * charDelay + duration + pause;
}

// Return all messages between two users (both directions).
function getConversationMessages(userId1, userId2) {
  return clientMessages.filter(function (m) {
    return (
      (m.fromUserId === userId1 && m.toUserId === userId2) ||
      (m.fromUserId === userId2 && m.toUserId === userId1)
    );
  });
}

// ============================================================
// Socket event listeners
// ============================================================

// Server pushes all historical locations on first connect
socket.on("historical-locations", function (historicalLocs) {
  for (let locationData of historicalLocs) updateOrAddLocation(locationData);
  syncLocationButton();
});

// Server broadcasts any location update (including our own)
socket.on("location-from-server", function (locationData) {
  updateOrAddLocation(locationData);
  syncLocationButton();
});

// New user joined: show animated "xxx joined" banner
socket.on("new-user-joined", function (data) {
  newUserComing.push({ username: data.username, startTime: Date.now() });
});

// Connection list: both historical snapshot and live updates use the same assignment
function applyConnections(conns) { connections = conns; }
socket.on("historical-connections", applyConnections);
socket.on("connections-from-server", applyConnections);

// Server sends full message history on connect/reconnect.
// Rule: for each pair, only loop the most recent message per direction.
// If the last two messages in a pair were sent by the same person, suppress the other direction.
socket.on("historical-messages", function (msgs) {
  clientMessages = msgs.slice();

  // Initialise last-message timestamps from the server's wall-clock timestamp on each message
  for (let msg of msgs) {
    if (!msg.fromUserId || !msg.toUserId) continue;
    let k = mkPKey(msg.fromUserId, msg.toUserId);
    const t = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
    if (!lastMsgTimes[k] || t > lastMsgTimes[k]) lastMsgTimes[k] = t;
  }
  localStorage.setItem("network-last-msg-times-v4", JSON.stringify(lastMsgTimes));

  // Step 1: keep only the latest message per directional key (later entries overwrite earlier)
  const latestPerKey = {};
  for (let msg of msgs) {
    if (!msg.fromUserId || !msg.toUserId) continue;
    latestPerKey[msg.fromUserId + "-" + msg.toUserId] = msg;
  }

  // Step 2: if the last two messages in a pair were from the same sender,
  // suppress the other direction so only one side animates
  const suppressedKeys = new Set();
  const seenPairs = new Set();
  for (let key in latestPerKey) {
    let msg = latestPerKey[key];
    let pairId = [msg.fromUserId, msg.toUserId].sort().join("|");
    if (seenPairs.has(pairId)) continue;
    seenPairs.add(pairId);

    let pairMsgs = msgs.filter(function (m) {
      return (
        (m.fromUserId === msg.fromUserId && m.toUserId === msg.toUserId) ||
        (m.fromUserId === msg.toUserId && m.toUserId === msg.fromUserId)
      );
    });

    if (pairMsgs.length >= 2) {
      let last = pairMsgs[pairMsgs.length - 1];
      let prev = pairMsgs[pairMsgs.length - 2];
      if (last.fromUserId === prev.fromUserId) {
        suppressedKeys.add(last.toUserId + "-" + last.fromUserId);
      }
    }
  }

  // Step 3: create/restore a looping animation for each unsuppressed direction
  for (let key in latestPerKey) {
    if (suppressedKeys.has(key)) continue;
    let msg = latestPerKey[key];
    let fromLoc = findLocByUserId(msg.fromUserId);
    let toLoc = findLocByUserId(msg.toUserId);
    let travelDuration = computeTravelDuration(fromLoc, toLoc, 100, 500, 2000);

    // If this direction was already animating (e.g. on reconnect), preserve phase
    // by back-dating startTime so the animation continues from where it was
    let histStartTime = Date.now();
    if (loopingMessages[key]) {
      let prev = loopingMessages[key];
      let prevPhase = (Date.now() - prev.startTime) % cycleLen(prev.text, prev.charDelay, prev.duration, 500);
      histStartTime = Date.now() - Math.min(prevPhase, cycleLen(msg.text, 200, travelDuration, 500) - 1);
    }
    loopingMessages[key] = {
      fromUserId: msg.fromUserId,
      toUserId: msg.toUserId,
      text: msg.text,
      duration: travelDuration,
      charDelay: 200,
      startTime: histStartTime,
    };
  }
});

// Haversine formula: great-circle distance between two lat/lng points in meters
function geoDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// New message received: create/update the flying animation for this direction,
// then decide whether the reverse direction should keep animating.
socket.on("message-travel", function (data) {
  const charDelay = 200;   // ms between consecutive characters departing
  const SPEED_MPS = 100;   // virtual flight speed (m/s), determines animation duration

  let fromLoc = findLocByUserId(data.fromUserId);
  let toLoc = findLocByUserId(data.toUserId);
  let travelDuration = computeTravelDuration(fromLoc, toLoc, SPEED_MPS, 500, 2000);

  const key = data.fromUserId + "-" + data.toUserId;
  const newMsgData = {
    fromUserId: data.fromUserId,
    toUserId: data.toUserId,
    text: data.text,
    duration: travelDuration,
    charDelay: charDelay,
  };

  if (loopingMessages[key]) {
    // Current loop still playing — queue; draw loop promotes it after pause
    pendingMessages[key] = newMsgData;
  } else {
    loopingMessages[key] = { ...newMsgData, startTime: Date.now() };
  }

  markMsgTime(data.fromUserId, data.toUserId, data.timestamp ? new Date(data.timestamp).getTime() : Date.now());

  // Append to history; trim when it grows too large to prevent memory pressure
  clientMessages.push({ fromUserId: data.fromUserId, toUserId: data.toUserId, text: data.text });
  if (clientMessages.length > 500) clientMessages = clientMessages.slice(-400);

  // If the previous message in this pair was also from the same sender (consecutive sends),
  // stop the reverse animation — only one direction should fly at a time
  const otherKey = data.toUserId + "-" + data.fromUserId;
  let pairMsgs = getConversationMessages(data.fromUserId, data.toUserId);
  let previousMsg = pairMsgs.length >= 2 ? pairMsgs[pairMsgs.length - 2] : null;
  if (!previousMsg || previousMsg.fromUserId === data.fromUserId) {
    delete loopingMessages[otherKey];
    delete pendingMessages[otherKey];
  }

  // If we're in history mode for either participant, exit back to live view
  if (historyViewUserId && (data.fromUserId === historyViewUserId || data.toUserId === historyViewUserId)) {
    exitHistoryView();
  }
});

// ============================================================
// Map configuration
// Initialized after first GPS fix so the map centers on the user
// ============================================================
let mappa_options = {
  lat: 0,
  lng: 0,
  zoom: 16,  // street-level zoom
  style: "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}",
};

// ============================================================
// p5.js lifecycle
// ============================================================

// Time-system utilities
function getInAppDay() { return Math.floor(getOnlineTime() / MS_PER_DAY); }
function mkPKey(a, b) { return [a, b].sort().join("|"); }
function markMsgTime(uid1, uid2, t) {
  lastMsgTimes[mkPKey(uid1, uid2)] = t !== undefined ? t : Date.now();
  localStorage.setItem("network-last-msg-times-v4", JSON.stringify(lastMsgTimes));
}
function isLineBroken(uid1, uid2) { return brokenConnPairs.has(mkPKey(uid1, uid2)); }
function doBreakLine(uid1, uid2) {
  let k = mkPKey(uid1, uid2);
  if (!brokenConnPairs.has(k)) {
    brokenConnPairs.add(k);
    localStorage.setItem("network-broken-conns-v3", JSON.stringify([...brokenConnPairs]));
  }
}

// Message color: green → yellow → orange → red → pink as count grows (0–40 messages)
function getMsgColor(count, alpha) {
  let t = constrain(count / 40, 0, 1);
  let c;
  if (t < 0.25)
    c = lerpColor(color(57, 255, 20), color(255, 255, 0), t / 0.25);
  else if (t < 0.5)
    c = lerpColor(color(255, 255, 0), color(255, 140, 0), (t - 0.25) / 0.25);
  else if (t < 0.75)
    c = lerpColor(color(255, 140, 0), color(255, 49, 49), (t - 0.5) / 0.25);
  else
    c = lerpColor(color(255, 49, 49), color(255, 100, 200), (t - 0.75) / 0.25);
  if (alpha !== undefined) c.setAlpha(alpha);
  return c;
}

// Draw n interleaved sine waves between two points, simulating a "rope" or chat-web effect
function drawWindingLines(x1, y1, x2, y2, exchanges, lineColor) {
  let n = min(exchanges, 8);
  let dx = x2 - x1, dy = y2 - y1;
  let len = Math.sqrt(dx * dx + dy * dy) || 1;
  let perpX = -dy / len, perpY = dx / len;
  let amplitude = 7;
  let freq = 3;
  noFill();
  if (lineColor) stroke(lineColor);
  else stroke(57, 255, 20, 180);
  strokeWeight(1);
  for (let s = 0; s < n; s++) {
    let phase = (s / n) * TWO_PI;
    beginShape();
    for (let t = 0; t <= 1; t += 0.01) {
      let offset = sin(t * TWO_PI * freq + phase) * amplitude;
      vertex(lerp(x1, x2, t) + perpX * offset, lerp(y1, y2, t) + perpY * offset);
    }
    endShape();
  }
}

// setup() runs once
function setup() {
  canvas = createCanvas(windowWidth, windowHeight - 120); // bottom 120px reserved for keyboard
  canvas.parent("p5-canvas-container");
  me = new MyPoint();
}

// draw() runs every frame (~60 fps)
function draw() {
  clear();

  // Initialize the map the first time we have a GPS fix (runs only once)
  if (!mapInit && GPS_GRANTED && currentLongitude != 0) {
    console.log("starting map");
    mappa_options.lat = currentLatitude;
    mappa_options.lng = currentLongitude;
    myMap = mappa.tileMap(mappa_options);
    myMap.overlay(canvas);
    myMap.onChange(updateMapContent);
    mapInit = true;
  }

  if (mapInit) {
    noStroke();
    fill(0, 0, 0, 150);
    rect(0, 0, width, height);

    // History mode: warm yellow overlay
    if (historyViewUserId) {
      fill(255, 200, 0, 28);
      rect(0, 0, width, height);
    }

    // --- Time system: detect day advancement and broken connections ---
    currentInAppDay = getInAppDay();
    if (currentInAppDay > prevInAppDay) {
      prevInAppDay = currentInAppDay;
    }
    for (let k in lastMsgTimes) {
      if (brokenConnPairs.has(k)) continue;
      let parts = k.split("|");
      let lastDay = Math.floor(lastMsgTimes[k] / MS_PER_DAY);
      if (currentInAppDay - lastDay >= 2) {
        doBreakLine(parts[0], parts[1]);
        // Auto-deselect if the broken pair involves the currently selected user
        if (selectedUserId === parts[0] || selectedUserId === parts[1]) {
          if (parts[0] === myUserId || parts[1] === myUserId) {
            selectedUserId = null;
            socket.emit("connection-from-client", { toUserId: null });
          }
        }
      }
    }

    // Update the day counter UI
    document.getElementById("day-counter").textContent = "Day " + currentInAppDay;

    // Dashed preview circle for pending location (after double-tap, before confirm)
    if (pendingLocation) {
      let pendingPos = myMap.latLngToPixel(pendingLocation.lat, pendingLocation.lng);
      push();
      noFill();
      stroke("#39ff14");
      strokeWeight(2);
      drawingContext.setLineDash([6, 4]);
      circle(pendingPos.x, pendingPos.y, 30);
      drawingContext.setLineDash([]);
      pop();
    }

    // Build O(1) lookup map and pre-compute per-frame sets
    const locMap = {};
    for (let loc of locations) locMap[loc.userId] = loc;

    // msgDirections: which directional pairs have ever exchanged a message
    // myMsgCountTo: how many messages I sent to each user (for color gradient)
    const msgDirections = new Set();
    const myMsgCountTo = {};
    for (let msg of clientMessages) {
      if (msg.fromUserId && msg.toUserId) {
        msgDirections.add(msg.fromUserId + "-" + msg.toUserId);
        if (msg.fromUserId === myUserId) {
          myMsgCountTo[msg.toUserId] = (myMsgCountTo[msg.toUserId] || 0) + 1;
        }
      }
    }
    const connSet = new Set();
    for (let conn of connections) connSet.add(conn.fromUserId + "-" + conn.toUserId);

    // --- Draw lines between users who have chatted (one line per pair) ---
    // Mutually selected → bright green; otherwise → dim green
    const chattedPairs = new Set();
    for (let msg of clientMessages) {
      if (msg.fromUserId && msg.toUserId) {
        chattedPairs.add([msg.fromUserId, msg.toUserId].sort().join("|"));
      }
    }
    for (let pairKey of chattedPairs) {
      let [uid1, uid2] = pairKey.split("|");
      let loc1 = locMap[uid1];
      let loc2 = locMap[uid2];
      if (!loc1 || !loc2) continue;
      let pos1 = myMap.latLngToPixel(loc1.lat, loc1.lng);
      let pos2 = myMap.latLngToPixel(loc2.lat, loc2.lng);
      let isMutuallySelected = connSet.has(uid1 + "-" + uid2) && connSet.has(uid2 + "-" + uid1);
      if (isLineBroken(uid1, uid2)) {
        stroke(100, 100, 100, 110);
      } else {
        stroke(isMutuallySelected ? color(57, 255, 20) : color(57, 255, 20, 110));
      }
      strokeWeight(1);
      line(pos1.x, pos1.y, pos2.x, pos2.y);
    }

    // Draw selection lines for connections that haven't exchanged messages yet
    const drawnConnPairs = new Set();
    for (let conn of connections) {
      let pairKey = [conn.fromUserId, conn.toUserId].sort().join("|");
      if (drawnConnPairs.has(pairKey)) continue;
      drawnConnPairs.add(pairKey);
      // Already represented by the chatted-pairs line above — skip
      if (msgDirections.has(conn.fromUserId + "-" + conn.toUserId) &&
          msgDirections.has(conn.toUserId + "-" + conn.fromUserId)) continue;
      let fromLoc = locMap[conn.fromUserId];
      let toLoc = locMap[conn.toUserId];
      if (!fromLoc || !toLoc) continue;
      let fromPos = myMap.latLngToPixel(fromLoc.lat, fromLoc.lng);
      let toPos = myMap.latLngToPixel(toLoc.lat, toLoc.lng);
      let isMutual = connSet.has(conn.fromUserId + "-" + conn.toUserId) &&
                     connSet.has(conn.toUserId + "-" + conn.fromUserId);
      stroke(isMutual ? "#39ff14" : "#ff3131");
      strokeWeight(1);
      line(fromPos.x, fromPos.y, toPos.x, toPos.y);
    }

    // Guard: clean up stale __history__ data if history mode was exited
    if (!historyViewUserId && loopingMessages["__history__"]) {
      delete loopingMessages["__history__"];
    }

    // --- History playback mode ---
    // Long-press on a user: loop their last 10 messages with us in sequence
    if (historyViewUserId) {
      let historyMsgs = getConversationMessages(myUserId, historyViewUserId).slice(-10);
      const histCharDelay = 70;
      const histPauseBetweenMessages = 250;

      let slots = historyMsgs.map(function (histMsg) {
        let fromLoc = locMap[histMsg.fromUserId];
        let toLoc = locMap[histMsg.toUserId];
        let travelDuration = computeTravelDuration(fromLoc, toLoc, 200, 333, 1333);
        return {
          msg: histMsg,
          travelDuration: travelDuration,
          slotLength: cycleLen(histMsg.text, histCharDelay, travelDuration, histPauseBetweenMessages),
        };
      });

      let totalCycleDuration = slots.reduce(function (sum, s) { return sum + s.slotLength; }, 0);

      if (totalCycleDuration > 0) {
        let elapsedInCycle = (Date.now() - historyStartTime) % totalCycleDuration;
        let cursor = 0;
        for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
          let currentSlot = slots[slotIndex];
          if (elapsedInCycle < cursor + currentSlot.slotLength) {
            let elapsedWithinSlot = elapsedInCycle - cursor;
            let currentMsg = currentSlot.msg;
            // Back-date startTime so the render loop treats this as mid-flight
            loopingMessages["__history__"] = {
              fromUserId: currentMsg.fromUserId,
              toUserId: currentMsg.toUserId,
              text: currentMsg.text,
              duration: currentSlot.travelDuration,
              charDelay: histCharDelay,
              startTime: Date.now() - elapsedWithinSlot,
            };
            break;
          }
          cursor += currentSlot.slotLength;
        }
      }
    }

    // --- Flying message animation ---
    const LOOP_PAUSE = 500;   // pause (ms) at end of each loop cycle
    const SIDE_OFFSET = 10;   // pixel offset perpendicular to the line, to separate A→B from B→A
    for (let key in loopingMessages) {
      let msg = loopingMessages[key];

      // History mode: only render the __history__ slot
      if (historyViewUserId && key !== "__history__") continue;

      let fromLoc = locMap[msg.fromUserId];
      let toLoc = locMap[msg.toUserId];
      // Fall back to live GPS if "me" hasn't appeared in locations yet
      if (!fromLoc && msg.fromUserId === myUserId)
        fromLoc = { lat: currentLatitude, lng: currentLongitude };
      if (!toLoc && msg.toUserId === myUserId)
        toLoc = { lat: currentLatitude, lng: currentLongitude };
      if (!fromLoc || !toLoc) continue;

      let fromPos = myMap.latLngToPixel(fromLoc.lat, fromLoc.lng);
      let toPos = myMap.latLngToPixel(toLoc.lat, toLoc.lng);

      // Perpendicular offset direction — determined by userId sort order so both
      // ends of the connection see the same offset side
      let canonicalFromPos = msg.fromUserId < msg.toUserId ? fromPos : toPos;
      let canonicalToPos = msg.fromUserId < msg.toUserId ? toPos : fromPos;
      let cdx = canonicalToPos.x - canonicalFromPos.x;
      let cdy = canonicalToPos.y - canonicalFromPos.y;
      let clen = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
      let perpX = -cdy / clen;
      let perpY = cdx / clen;

      // Smaller userId → positive side; larger → negative side
      let side = msg.fromUserId < msg.toUserId ? 1 : -1;
      let offsetX = perpX * SIDE_OFFSET * side;
      let offsetY = perpY * SIDE_OFFSET * side;

      // Rotate characters to face the flight direction
      let angle = atan2(toPos.y - fromPos.y, toPos.x - fromPos.x);

      let cycleLength = cycleLen(msg.text, msg.charDelay, msg.duration, LOOP_PAUSE);
      let cycleElapsed = (Date.now() - msg.startTime) % cycleLength;

      // All characters have landed and a new message is queued → swap it in
      let allLandedAt = (msg.text.length - 1) * msg.charDelay + msg.duration;
      if (cycleElapsed >= allLandedAt && pendingMessages[key]) {
        loopingMessages[key] = { ...pendingMessages[key], startTime: Date.now() };
        delete pendingMessages[key];
        continue; // fresh render next frame
      }

      // Broken-connection messages render grey; mine use the warm gradient; others are green
      let msgFillColor;
      let msgBroken = key !== "__history__" && isLineBroken(msg.fromUserId, msg.toUserId);
      if (msgBroken) {
        msgFillColor = color(100, 100, 100, 150);
      } else if (msg.fromUserId === myUserId) {
        let count = myMsgCountTo[msg.toUserId] || 0;
        msgFillColor = key === "__history__" ? getMsgColor(count, 110) : getMsgColor(count);
      } else {
        msgFillColor = key === "__history__" ? color(57, 255, 20, 110) : color(57, 255, 20);
      }
      noStroke();
      fill(msgFillColor);
      textAlign(CENTER, CENTER);
      textSize(20);

      // Conversations not involving me show garbled characters (count preserved, content hidden)
      const GARBLE_CHARS = "!@#$%^&*()_+-=[]{}|;':\",./<>?~`\\'";
      let isMyConversation = msg.fromUserId === myUserId || msg.toUserId === myUserId;

      // Precompute garble seed once per message (depends only on key)
      let garbleSeed = 0;
      if (!isMyConversation) {
        for (let k = 0; k < key.length; k++) garbleSeed += key.charCodeAt(k) * (k + 1);
      }

      // Render each character at its interpolated position along the line
      for (let i = 0; i < msg.text.length; i++) {
        let charElapsed = cycleElapsed - i * msg.charDelay;

        // Character just landed (50ms window) → trigger blink on recipient
        if (key !== "__history__" && !msgBroken && charElapsed >= msg.duration && charElapsed < msg.duration + 50) {
          blinkingUsers[msg.toUserId] = Date.now() + 280;
        }

        if (charElapsed < 0 || charElapsed > msg.duration) continue;

        let progress = charElapsed / msg.duration;
        let x = lerp(fromPos.x, toPos.x, progress) + offsetX;
        let y = lerp(fromPos.y, toPos.y, progress) + offsetY;

        let displayChar = isMyConversation
          ? msg.text[i]
          : GARBLE_CHARS[Math.abs(Math.floor(Math.sin(garbleSeed + i * 97) * GARBLE_CHARS.length)) % GARBLE_CHARS.length];

        push();
        translate(x, y);
        rotate(angle);
        if (fromPos.x > toPos.x) rotate(PI); // flip text when line goes right-to-left
        text(displayChar, 0, 0);
        pop();
      }
    }

    // --- Chat-web inspection view (triggered by double-tapping a connected user) ---
    if (inspectedUserId) {
      let inspLoc = locMap[inspectedUserId];
      if (inspLoc) {
        let inspPos = myMap.latLngToPixel(inspLoc.lat, inspLoc.lng);
        const inspFrom = {}, inspTo = {};
        for (let msg of clientMessages) {
          if (msg.fromUserId === inspectedUserId && msg.toUserId) {
            inspFrom[msg.toUserId] = (inspFrom[msg.toUserId] || 0) + 1;
          } else if (msg.toUserId === inspectedUserId && msg.fromUserId) {
            inspTo[msg.fromUserId] = (inspTo[msg.fromUserId] || 0) + 1;
          }
        }
        const partners = new Set([...Object.keys(inspFrom), ...Object.keys(inspTo)]);
        for (let uid of partners) {
          let otherLoc = locMap[uid];
          if (!otherLoc) continue;
          let otherPos = myMap.latLngToPixel(otherLoc.lat, otherLoc.lng);
          let exchanges = min(inspFrom[uid] || 0, inspTo[uid] || 0);
          if (exchanges < 1) continue;
          let wColor = isLineBroken(inspectedUserId, uid) ? color(100, 100, 100, 110) : null;
          drawWindingLines(inspPos.x, inspPos.y, otherPos.x, otherPos.y, exchanges, wColor);
        }
      }
    }

    // --- Draw user dots and usernames ---
    for (let loc of locations) {
      let posOnCanvas = myMap.latLngToPixel(loc.lat, loc.lng);
      let x = posOnCanvas.x;
      let y = posOnCanvas.y;
      if (x > 0 && x < width && y > 0 && y < height) {
        // Dot size corresponds to a real 10-meter radius, consistent across zoom levels
        let diameter = 2 * metersToPixel(10, loc.lat);
        let isSelected = loc.userId === selectedUserId;
        if (isSelected) diameter *= 2;

        noStroke();
        if (loc.userId !== myUserId && isLineBroken(myUserId, loc.userId)) {
          fill(100, 100, 100);
        } else if (loc.userId === myUserId || isSelected) {
          fill("#39ff14");
        } else {
          fill("#ff3131");
        }
        circle(x, y, diameter);

        // Blink effect: a growing, fading halo when a character lands on this user
        let blinkEnd = blinkingUsers[loc.userId];
        if (blinkEnd) {
          if (Date.now() < blinkEnd) {
            let progress = (blinkEnd - Date.now()) / 280; // fades 1→0
            let isGreen = loc.userId === myUserId || isSelected;
            push();
            noStroke();
            fill(isGreen ? color(57, 255, 20, progress * 230) : color(255, 49, 49, progress * 230));
            circle(x, y, diameter * (1 + progress * 1.5));
            pop();
          } else {
            delete blinkingUsers[loc.userId];
          }
        }

        textAlign(CENTER);
        text(loc.username ?? "", x, y + diameter / 2 + 12);
      }
    }

    // --- "X joined" announcement banners (fade out after 3 seconds) ---
    const announceDuration = 3000;
    let yOffset = 40;
    // Iterate backwards so splice() doesn't shift unvisited indices
    for (let i = newUserComing.length - 1; i >= 0; i--) {
      let ann = newUserComing[i];
      let elapsed = Date.now() - ann.startTime;
      if (elapsed > announceDuration) {
        newUserComing.splice(i, 1);
        continue;
      }
      let alpha = constrain(map(elapsed, announceDuration * 0.6, announceDuration, 255, 0), 0, 255);
      push();
      noStroke();
      fill(111, 92, 100, alpha);
      textAlign(CENTER);
      textSize(16);
      text(ann.username + " joined", width / 2, yOffset);
      pop();
      yOffset += 24;
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function syncLocationButton() {
  const btn = document.getElementById("changeLocationButton");
  if (btn.style.display === "none") return; // hidden while in change-location mode
  btn.textContent = findLocByUserId(myUserId) ? "change location" : "add location";
}

// GPS callback: fired by requestGPS.js whenever a new position is available
function handleNewPosition(pos) {
  me.accuracy = pos.coords.accuracy;

  if (!changingLocation) {
    document.getElementById("changeLocationButton").style.display = "block";
    syncLocationButton();
  }

  // Convert WGS-84 (raw GPS) to GCJ-02 (Gaode/AutoNavi map projection)
  // fixForChineseMap() is defined in requestGPS.js
  let lonlat = fixForChineseMap(pos);
  currentLongitude = lonlat[0];
  currentLatitude = lonlat[1];

  if (mapInit) updateMapContent();
}

// Update MyPoint's goal position from the latest GPS coordinates.
// MyPoint lerps toward it each frame for smooth movement.
function updateMapContent() {
  let myPosOnCanvas = myMap.latLngToPixel(currentLatitude, currentLongitude);
  me.goalX = myPosOnCanvas.x;
  me.goalY = myPosOnCanvas.y;
}

// Convert a real-world meter distance to pixels at the current map zoom level
function metersToPixel(meters, lat) {
  const z = myMap.zoom();
  // Standard Web Mercator formula: meters per pixel at this zoom and latitude
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
  return meters / mpp;
}


/* Fake Keyboard */
// Mobile browsers resize the page when the system keyboard opens,
// which disrupts map interactions. We use a fixed-position custom keyboard instead.
let kbShift = false;
let kbMode = "en";     // "en" = English | "zh" = Chinese pinyin
let pinyinBuffer = ""; // accumulated pinyin letters, cleared after character selection

// prettier-ignore
const pinyinDict = {
  a: ["啊", "阿", "😧"],
  ai: ["爱", "哎", "哀", "艾", "碍", "癌", "挨", "唉"],
  an: ["安", "暗", "岸", "案", "按", "暗", "俺", "氨", "鞍", "胺", "谙", "埯"],
  ang: ["昂", "肮", "盎"],
  ao: ["奥", "澳", "傲", "熬", "凹"],
  ba: ["把", "吧", "爸", "八", "拔", "罢", "霸", "芭", "坝", "靶"],
  bai: ["白", "百", "拜", "败", "摆", "柏", "佰"],
  ban: ["半", "班", "搬", "板", "版", "办", "伴", "颁", "扳"],
  bang: ["帮", "棒", "傍", "绑", "榜", "磅", "谤"],
  bao: ["包", "保", "宝", "报", "抱", "爆", "薄", "剥", "饱", "堡", "豹"],
  bei: ["北", "被", "杯", "背", "悲", "倍", "备", "贝", "辈", "碑", "卑"],
  ben: ["本", "奔", "笨"],
  bi: ["比", "必", "笔", "闭", "壁", "鼻", "币", "避", "碧", "毕", "辟", "逼"],
  bian: ["变", "边", "便", "遍", "辩", "编", "鞭", "扁"],
  biao: ["标", "表", "彪", "镖"],
  bie: ["别", "憋", "瘪"],
  bin: ["宾", "滨", "殡", "缤"],
  bing: ["病", "冰", "并", "兵", "饼", "丙", "秉", "屏"],
  bo: ["波", "博", "播", "拨", "伯", "脖", "泊", "勃", "薄", "驳"],
  bu: ["不", "布", "步", "部", "补", "捕", "哺", "簿"],
  ca: ["擦", "嚓"],
  cai: ["才", "菜", "彩", "猜", "财", "采", "踩", "裁", "睬"],
  can: ["参", "惨", "残", "蚕", "灿", "惭"],
  cao: ["操", "草", "槽"],
  ce: ["侧", "测", "策", "厕"],
  ceng: ["曾", "层", "蹭"],
  cha: ["查", "差", "茶", "插", "察", "叉", "岔", "拆"],
  chan: ["产", "缠", "颤", "铲", "阐"],
  chang: ["长", "常", "唱", "厂", "场", "尝", "肠", "畅", "倡", "昌"],
  chao: ["超", "朝", "炒", "吵", "潮", "巢", "抄", "嘲"],
  che: ["车", "彻", "扯", "撤"],
  chen: ["陈", "趁", "尘", "沉", "衬", "晨", "臣", "忱", "辰"],
  cheng: ["成", "城", "程", "称", "诚", "乘", "撑", "惩", "澄"],
  chi: ["吃", "迟", "持", "齿", "翅", "尺", "叱", "斥", "耻", "驰"],
  chong: ["重", "冲", "宠", "崇"],
  chou: ["愁", "丑", "抽", "仇", "臭", "稠"],
  chu: ["出", "初", "处", "除", "厨", "触", "储", "畜"],
  chuan: ["传", "穿", "船", "串", "喘"],
  chuang: ["创", "窗", "床", "闯", "疮"],
  chui: ["吹", "垂", "锤", "槌"],
  chun: ["春", "纯", "唇", "蠢", "淳", "醇", "椿", "蝽", "鹑", "莼"],
  chuo: ["戳", "绰", "啜"],
  ci: ["此", "词", "次", "磁", "刺", "瓷", "辞"],
  cong: ["从", "匆", "聪", "丛"],
  cu: ["粗", "促", "醋"],
  cui: ["催", "脆", "翠", "粹", "萃"],
  cun: ["村", "存", "寸", "忖"],
  cuo: ["错", "措", "搓", "挫"],
  da: ["大", "打", "达", "答", "搭"],
  dai: ["带", "代", "待", "戴", "呆", "袋", "怠", "歹", "殆"],
  dan: ["但", "单", "担", "蛋", "淡", "弹", "胆", "旦", "诞", "耽"],
  dang: ["当", "党", "挡", "荡", "档"],
  dao: ["到", "道", "倒", "岛", "导", "刀", "悼", "盗"],
  de: ["的", "地", "得", "德"],
  deng: ["等", "灯", "登", "凳", "邓"],
  di: ["地", "底", "弟", "低", "敌", "帝", "滴", "抵", "递", "堤"],
  dian: ["电", "点", "店", "典", "甜", "殿", "颠", "垫", "惦"],
  diao: ["掉", "调", "雕", "吊", "钓"],
  die: ["跌", "蝶", "爹", "碟", "迭"],
  ding: ["定", "顶", "钉", "订", "丁", "盯"],
  diu: ["丢"],
  dong: ["动", "东", "懂", "冻", "洞", "栋"],
  dou: ["都", "豆", "抖", "斗", "兜", "陡"],
  du: ["度", "读", "独", "堵", "肚", "毒", "渡", "督", "赌"],
  duan: ["断", "短", "段", "端", "缎"],
  dui: ["对", "队", "堆", "兑"],
  dun: ["顿", "盾", "吨", "蹲"],
  duo: ["多", "夺", "朵", "躲", "舵", "堕"],
  e: ["饿", "恶", "鹅", "额", "扼", "遏"],
  en: ["恩"],
  er: ["二", "而", "耳", "儿", "尔"],
  fa: ["发", "法", "乏", "罚", "筏"],
  fan: ["反", "饭", "范", "烦", "翻", "凡", "犯", "贩", "帆", "繁"],
  fang: ["方", "放", "房", "防", "访", "仿", "芳", "妨"],
  fei: ["飞", "非", "费", "肥", "废", "沸", "匪", "菲"],
  fen: ["分", "份", "粉", "奋", "愤", "纷", "焚", "坟"],
  feng: ["风", "封", "锋", "丰", "逢", "疯", "枫", "峰"],
  fo: ["佛"],
  fou: ["否", "缶"],
  fu: [ "父","服","福","副","付","府","负","夫","复","浮","赴","辅","妇",],
  gai: ["该", "改", "盖", "概", "钙"],
  gan: ["干", "感", "赶", "敢", "甘", "杆", "肝", "尴"],
  gang: ["刚", "钢", "港", "缸"],
  gao: ["高", "告", "搞", "糕", "稿"],
  ge: ["个", "各", "哥", "歌", "格", "隔", "割", "搁"],
  gei: ["给"],
  gen: ["根", "跟", "亘"],
  geng: ["更", "耕", "梗"],
  gong: ["工", "公", "共", "功", "供", "攻", "宫", "巩", "贡"],
  gou: ["够", "狗", "勾", "构", "沟", "购"],
  gu: ["古", "故", "骨", "鼓", "顾", "固", "估", "股", "雇", "孤"],
  gua: ["刮", "挂", "瓜", "寡"],
  guai: ["怪", "乖", "拐"],
  guan: ["关", "观", "管", "官", "惯", "冠", "灌"],
  guang: ["广", "光", "逛"],
  gui: ["贵", "规", "归", "鬼", "柜", "轨", "跪"],
  gun: ["滚", "棍"],
  guo: ["过", "国", "果", "锅", "裹"],
  ha: ["哈", "蛤"],
  hai: ["还", "海", "害", "孩", "骸"],
  han: ["汉", "寒", "喊", "汗", "含", "憾", "撼", "焊", "旱"],
  hang: ["航", "行", "杭"],
  hao: ["好", "号", "毫", "豪", "浩", "耗", "壕"],
  he: ["和", "合", "河", "喝", "核", "何", "荷", "贺", "盒", "鹤"],
  hei: ["黑"],
  hen: ["很", "恨", "狠"],
  heng: ["横", "恒", "哼"],
  hong: ["红", "洪", "宏", "哄", "烘"],
  hou: ["后", "厚", "猴", "候", "吼", "喉"],
  hu: ["虎", "湖", "互", "护", "胡", "呼", "弧", "壶", "糊"],
  hua: ["话", "花", "化", "画", "华", "滑", "哗", "划"],
  huai: ["坏", "怀", "槐"],
  huan: ["换", "环", "欢", "幻", "缓", "唤", "患", "焕"],
  huang: ["黄", "荒", "皇", "慌", "谎", "晃", "恍"],
  hui: ["会", "回", "灰", "汇", "惠", "悔", "挥", "辉", "慧"],
  hun: ["婚", "混", "魂", "浑", "昏"],
  huo: ["活", "火", "或", "货", "获", "祸", "霍", "豁"],
  ji: ["机","记","几","集","计","级","技","基","极","际","继","积","击","激","寂","迹","籍","辑","棘",],
  jia: ["家", "加", "价", "假", "甲", "嫁", "架", "夹", "佳", "嘉"],
  jian: [ "见", "间", "建", "简", "坚", "件", "健", "尖", "检", "煎", "减", "荐", "监", "兼", "剑", "践",],
  jiang: ["将", "讲", "江", "强", "奖", "降", "僵", "浆", "姜"],
  jiao: ["叫", "教", "脚", "交", "角", "觉", "饺", "轿", "娇", "骄", "矫"],
  jie: ["解", "接", "节", "结", "街", "姐", "界", "届", "借", "捷", "截", "揭"],
  jin: ["进", "金", "近", "今", "紧", "尽", "禁", "劲", "晋", "浸"],
  jing: ["经", "京", "精", "竟", "静", "净", "警", "敬", "镜", "景", "径", "竞", "惊", "晶", "茎",],
  jiu: ["就", "九", "酒", "救", "旧", "究", "久", "揪"],
  ju: ["居", "剧", "举", "具", "据", "句", "聚", "拘", "局", "菊", "矩"],
  juan: ["卷", "捐", "倦"],
  jue: ["觉", "绝", "决", "掘", "崛"],
  jun: ["军", "均", "俊", "菌", "君"],
  kai: ["开", "凯", "慨"],
  kan: ["看", "砍", "刊", "堪", "勘"],
  kang: ["抗", "康", "慷"],
  kao: ["靠", "考", "烤", "铐"],
  ke: ["可", "科", "课", "刻", "客", "克", "渴", "咳", "棵", "颗"],
  ken: ["肯", "垦"],
  kong: ["空", "控", "恐"],
  kou: ["口", "扣", "抠"],
  ku: ["哭", "苦", "库", "裤", "酷", "枯", "窟"],
  kua: ["跨", "夸", "垮"],
  kuai: ["快", "块", "筷", "脍"],
  kuan: ["宽", "款"],
  kun: ["困", "捆", "昆"],
  kuo: ["括", "阔", "扩"],
  la: ["拉", "啦", "垃", "辣", "蜡", "腊"],
  lai: ["来", "赖", "睐"],
  lan: ["蓝", "烂", "拦", "懒", "缆", "篮", "栏"],
  lang: ["浪", "郎", "朗", "廊", "狼"],
  lao: ["老", "劳", "涝", "捞", "唠"],
  le: ["了", "乐", "勒"],
  lei: ["累", "泪", "雷", "垒", "肋"],
  li: ["里","力","利","立","例","离","历","礼","理","丽","李","厘","励","粒","栗","莉", ],
  lian: ["连", "脸", "联", "练", "恋", "莲", "廉", "镰", "炼"],
  liang: ["两", "量", "亮", "凉", "良", "粮", "晾", "谅"],
  liao: ["聊", "料", "疗", "撩", "僚"],
  lie: ["列", "烈", "裂", "猎", "咧"],
  lin: ["林", "邻", "临", "淋", "吝", "鳞"],
  ling: ["零", "令", "灵", "领", "另", "铃", "陵", "凌", "岭"],
  liu: ["留", "六", "流", "刘", "柳", "溜"],
  long: ["龙", "隆", "弄", "笼", "聋"],
  lou: ["楼", "漏", "露", "搂", "陋"],
  lu: ["路", "录", "炉", "鹿", "陆", "虏", "卤", "鲁"],
  luan: ["乱", "卵", "峦"],
  lun: ["论", "轮", "伦", "仑"],
  luo: ["落", "罗", "逻", "骡", "螺"],
  lv: ["旅", "律", "虑", "吕", "绿", "滤", "屡", "率", "氯"],
  ma: ["马", "妈", "吗", "嘛", "麻", "骂", "玛"],
  mai: ["买", "卖", "麦", "埋", "迈"],
  man: ["满", "慢", "漫", "蔓", "曼"],
  mang: ["忙", "茫", "盲", "芒"],
  mao: ["毛", "猫", "帽", "冒", "贸", "矛", "锚", "茂"],
  mei: ["没", "美", "每", "妹", "眉", "煤", "霉", "梅", "媒"],
  men: ["们", "门", "闷"],
  meng: ["梦", "猛", "盟", "蒙", "朦"],
  mi: ["米", "秘", "密", "迷", "蜜", "弥", "靡"],
  mian: ["面", "棉", "免", "眠", "勉", "绵", "缅"],
  miao: ["妙", "苗", "秒", "庙", "瞄"],
  min: ["民", "敏", "泯"],
  ming: ["明", "名", "命", "鸣", "冥"],
  mo: ["模", "末", "摸", "磨", "陌", "默", "墨", "沫", "漠", "膜"],
  mou: ["某", "谋"],
  mu: ["木", "目", "母", "幕", "墓", "牧", "亩", "募", "暮"],
  na: ["那", "拿", "哪", "纳", "呐"],
  nai: ["奶", "耐", "乃"],
  nan: ["南", "难", "男", "楠"],
  nao: ["脑", "闹", "恼", "挠"],
  ne: ["呢"],
  nei: ["内"],
  neng: ["能"],
  ni: ["你", "泥", "拟", "逆", "尼", "倪"],
  nian: ["年", "念", "粘"],
  niang: ["娘", "酿"],
  niao: ["鸟", "尿", "袅"],
  nie: ["捏", "聂", "孽", "啮"],
  nin: ["您"],
  ning: ["宁", "凝", "柠"],
  niu: ["牛", "纽", "扭"],
  nong: ["农", "弄", "浓", "脓"],
  nu: ["努", "奴", "怒"],
  nuan: ["暖"],
  nuo: ["诺", "挪"],
  nv: ["女", "虐"],
  o: ["哦", "噢"],
  ou: ["欧", "偶", "呕", "藕", "殴"],
  pa: ["怕", "爬", "啪", "趴"],
  pai: ["拍", "排", "派", "徘"],
  pan: ["判", "盘", "盼", "攀", "叛"],
  pang: ["旁", "胖", "磅"],
  pao: ["跑", "炮", "泡", "抛", "袍"],
  pei: ["配", "培", "陪", "赔", "佩"],
  pen: ["喷", "盆"],
  peng: ["朋", "碰", "棚", "捧", "蓬"],
  pi: ["批", "皮", "脾", "屁", "疲", "匹", "劈", "披", "譬"],
  pian: ["片", "偏", "骗", "篇"],
  piao: ["票", "飘", "漂"],
  pin: ["品", "贫", "拼", "聘", "频"],
  ping: ["平", "评", "瓶", "屏", "苹", "萍"],
  po: ["破", "迫", "婆", "颇", "魄"],
  pu: ["普", "铺", "扑", "朴", "葡", "蒲", "瀑"],
  qi: ["琪","起","其","七","气","期","器","奇","企","弃","旗","妻","骑","欺","漆","棋","祈",],
  qian: ["前", "千", "钱", "签", "欠", "牵", "浅", "潜", "遣", "谴"],
  qiang: ["强", "枪", "墙", "抢", "腔"],
  qiao: ["桥", "敲", "巧", "瞧", "悄"],
  qie: ["切", "且", "窃"],
  qin: ["亲", "勤", "琴", "寝", "侵"],
  qing: ["情", "清", "请", "轻", "青", "庆", "倾", "氢", "晴"],
  qiu: ["球", "秋", "求", "丘", "囚"],
  qu: ["去", "取", "趣", "曲", "区", "渠", "驱", "屈", "躯"],
  quan: ["全", "权", "劝", "圈", "拳", "泉", "券"],
  que: ["确", "缺", "却", "鹊"],
  qun: ["群", "裙"],
  ran: ["然", "染", "燃", "冉"],
  rang: ["让", "嚷"],
  rao: ["绕", "扰", "饶"],
  re: ["热", "惹"],
  ren: ["人", "认", "任", "忍", "仁", "韧", "刃"],
  reng: ["仍", "扔"],
  ri: ["日"],
  rong: ["容", "荣", "融", "溶", "熔"],
  rou: ["肉", "柔", "揉"],
  ru: ["如", "入", "儒", "乳", "辱"],
  ruan: ["软", "阮"],
  rui: ["瑞", "锐", "蕊", "睿", "芮"],
  run: ["润", "闰"],
  ruo: ["若", "弱"],
  sa: ["撒", "洒", "萨"],
  sai: ["赛", "塞", "腮"],
  san: ["三", "散", "伞", "叁"],
  se: ["色", "涩", "瑟"],
  sha: ["沙", "杀", "啥", "傻", "纱", "刹"],
  shai: ["晒", "筛"],
  shan: ["山", "闪", "善", "珊", "扇", "删"],
  shang: ["上", "商", "伤", "赏", "尚", "晌"],
  shao: ["少", "烧", "绍", "梢"],
  she: ["社", "蛇", "舍", "设", "摄", "射"],
  shen: ["什", "身", "深", "神", "甚", "沈", "慎", "伸"],
  sheng: ["生", "声", "省", "胜", "升", "绳", "圣"],
  shi: ["是","时", "事", "市", "实", "使", "世", "式", "始", "诗", "视", "石", "识", "适", "湿", "史",],
  shou: ["手", "受", "收", "首", "守", "寿", "兽"],
  shu: ["书", "数", "树", "输", "熟", "舒", "鼠", "束", "述", "竖"],
  shua: ["刷", "耍"],
  shuan: ["拴", "涮"],
  shuai: ["帅", "摔", "衰"],
  shuang: ["双", "爽"],
  shui: ["水", "谁", "睡"],
  shun: ["顺", "瞬"],
  shuo: ["说", "硕"],
  si: ["四", "死", "思", "私", "司", "丝", "撕"],
  song: ["送", "松", "宋", "诵", "颂"],
  su: ["素", "速", "苏", "俗", "塑", "宿"],
  suan: ["算", "酸"],
  sui: ["随", "虽", "岁", "碎", "遂", "穗"],
  sun: ["孙", "损", "笋"],
  suo: ["所", "锁", "索", "梭"],
  ta: ["他", "她", "它", "踏", "塌"],
  tai: ["太", "台", "态", "泰", "抬", "胎"],
  tan: ["谈", "探", "弹", "坦", "叹", "炭", "贪", "摊", "瘫"],
  tang: ["堂", "糖", "躺", "烫", "唐", "趟", "汤"],
  tao: ["套", "逃", "讨", "桃", "陶", "淘"],
  te: ["特"],
  ti: ["题", "体", "提", "踢", "替", "剃", "惕"],
  tian: ["天", "田", "甜", "填", "添"],
  tiao: ["条", "跳", "挑", "调", "迢"],
  tie: ["铁", "贴", "帖"],
  ting: ["听", "停", "廷", "厅", "挺", "庭", "艇", "婷"],
  tong: ["同", "通", "痛", "统", "铜", "童", "桶"],
  tou: ["头", "偷", "透", "投"],
  tu: ["图", "土", "吐", "兔", "途", "突", "涂", "徒"],
  tuan: ["团"],
  tui: ["推", "退", "腿", "颓"],
  tun: ["吞", "屯"],
  tuo: ["拖", "脱", "妥", "拓", "托", "驼"],
  wa: ["挖", "哇", "蛙", "娃", "瓦"],
  wai: ["外", "歪"],
  wan: ["万", "完", "晚", "玩", "弯", "湾", "碗", "腕", "挽"],
  wang: ["王", "网", "望", "往", "忘", "旺", "枉"],
  wei: ["为","位","味","威","委","维","围","未","喂","伟","微","尾","伪","违"],
  wen: ["文", "问", "闻", "温", "稳", "纹"],
  weng: ["翁", "嗡", "瓮"],
  wo: ["我", "窝", "握", "卧", "涡"],
  wu: ["无", "物", "五", "午", "误", "务", "雾", "武", "舞", "污", "屋"],
  xi: ["系","西","习","希","喜","细","席","洗","吸","戏","惜","析","昔","锡","膝"],
  xia: ["下", "夏", "虾", "峡", "吓", "瞎", "侠"],
  xian: ["现","先","线","限","显","险","县","鲜","闲","献","纤","咸","衔",],
  xiang: ["想","向","像","相","响","香","乡","详","象","项","厢","箱","镶",],
  xiao: ["小", "笑", "消", "效", "校", "晓", "宵", "销"],
  xie: ["些", "谢", "写", "鞋", "解", "斜", "协", "卸", "蟹"],
  xin: ["新", "心", "信", "欣", "辛", "锌"],
  xing: ["行", "性", "星", "形", "姓", "醒", "幸", "兴", "腥", "猩"],
  xiong: ["雄", "胸", "熊", "汹"],
  xiu: ["修", "休", "秀", "锈", "朽"],
  xu: ["需", "许", "续", "虚", "叙", "序", "絮", "婿"],
  xuan: ["选", "宣", "旋", "悬", "玄", "炫"],
  xue: ["学", "血", "雪", "靴"],
  xun: ["训", "寻", "迅", "询", "熏", "巡", "驯"],
  ya: ["压", "牙", "亚", "呀", "雅", "鸭", "崖", "涯"],
  yan: ["眼","言","颜","燕","演","盐","严","验","烟","研","延","掩","艳","殷","宴"],
  yang: ["样", "阳", "养", "羊", "杨", "洋", "仰", "扬", "痒"],
  yao: ["要", "药", "腰", "摇", "遥", "咬", "邀", "谣"],
  ye: ["也", "夜", "野", "叶", "爷", "业", "液", "页"],
  yi: ["一","以","意","易","已","义","艺","医","依","移","宜","疑","异","益","亿","忆","役","抑","毅"],
  yin: ["因", "印", "音", "银", "阴", "饮", "引", "隐", "吟", "寅"],
  ying: ["应", "英", "影", "映", "赢", "硬", "营", "迎", "萤", "婴"],
  yo: ["哟"],
  yong: ["用", "永", "勇", "拥", "涌", "雍", "庸"],
  you: ["有", "又", "友", "由", "右", "游", "油", "优", "尤", "幽", "悠"],
  yu: ["于","语","育","鱼","预","欲","遇","雨","域","愉","余","与","玉","宇","愚","渔","狱"],
  yuan: ["原", "元", "远", "园", "怨", "圆", "愿", "院", "缘", "源", "猿"],
  yue: ["月", "越", "约", "悦", "岳", "跃"],
  yun: ["运", "云", "允", "孕", "晕", "韵"],
  za: ["杂", "砸", "咋"],
  zai: ["在", "再", "载", "灾", "栽"],
  zan: ["咱", "赞", "暂", "攒"],
  zao: ["早", "造", "遭", "糟", "枣", "皂"],
  ze: ["则", "责", "泽", "择"],
  zen: ["怎"],
  zeng: ["增", "曾"],
  zha: ["炸", "扎", "渣", "榨", "眨", "闸"],
  zhai: ["摘", "窄", "债", "宅", "斋"],
  zhan: ["战", "站", "展", "占", "沾", "崭", "斩"],
  zhang: ["张", "长", "章", "掌", "账", "涨", "障", "仗"],
  zhao: ["找", "照", "招", "着", "兆", "召"],
  zhe: ["这", "者", "着", "折", "哲", "遮"],
  zhen: ["真", "针", "阵", "珍", "镇", "震", "振", "枕", "斟"],
  zheng: ["正", "政", "整", "证", "争", "征", "蒸", "郑"],
  zhi: ["知","之","至","只","直","指","职","质","制","志","治","置","值","纸","织","枝","汁","执"],
  zhong: ["中", "种", "重", "众", "终", "忠", "钟", "肿"],
  zhou: ["周", "洲", "州", "轴", "粥", "肘", "皱"],
  zhu: ["主", "住", "注", "助", "著", "猪", "祝", "珠", "竹", "柱", "煮"],
  zhua: ["抓", "爪"],
  zhuan: ["转", "专", "赚", "砖"],
  zhuang: ["装", "庄", "撞", "壮", "幢"],
  zhui: ["追", "坠"],
  zhun: ["准"],
  zhuo: ["桌", "捉", "拙", "琢"],
  zi: ["子", "自", "字", "紫", "资", "姿", "滋", "梓"],
  zong: ["总", "综", "宗", "纵", "棕"],
  zou: ["走", "奏", "邹"],
  zu: ["组", "足", "阻", "族", "祖"],
  zui: ["最", "嘴", "罪", "醉"],
  zun: ["尊", "遵"],
  zuo: ["做", "作", "坐", "左", "座", "昨"],
};

// Convenience accessor for the message input element
function kbInput() {
  return document.getElementById("kb-input");
}

// Return candidate characters for the current pinyin buffer, or [] if empty
function kbGetCandidates() {
  return pinyinBuffer ? pinyinDict[pinyinBuffer] || [] : [];
}

// Render candidate characters as clickable buttons above the keyboard
function kbShowCandidates() {
  const candidates = kbGetCandidates();
  const row = document.getElementById("kb-candidates");
  if (candidates.length === 0) {
    row.style.display = "none";
    row.innerHTML = "";
    return;
  }
  row.style.display = "flex";
  row.innerHTML = "";
  candidates.forEach(function (char) {
    const btn = document.createElement("button");
    btn.className = "kb-key kb-candidate";
    btn.textContent = char;
    btn.addEventListener("click", function () {
      kbInput().value += char;
      pinyinBuffer = "";
      kbRefresh(); // update candidates + display in one call
    });
    row.appendChild(btn);
  });
}

// Update the message preview above the keyboard.
// In Chinese mode, pending pinyin is shown in grey to distinguish it from confirmed text.
function kbUpdateDisplay() {
  const displayEl = document.getElementById("kb-display-text");
  if (kbMode === "zh" && pinyinBuffer) {
    displayEl.innerHTML = "";
    const msgSpan = document.createElement("span");
    msgSpan.textContent = kbInput().value;
    const pinyinSpan = document.createElement("span");
    pinyinSpan.className = "kb-pinyin-pending";
    pinyinSpan.textContent = pinyinBuffer;
    displayEl.appendChild(msgSpan);
    displayEl.appendChild(pinyinSpan);
  } else {
    displayEl.textContent = kbInput().value;
  }
}

// Combined helper: refresh candidates row AND display text (always called together)
function kbRefresh() {
  kbShowCandidates();
  kbUpdateDisplay();
}

// Prevent an element's touches from bubbling to the map (avoids false gestures)
function preventTouchBubble(id) {
  const el = document.getElementById(id);
  const stop = e => e.stopPropagation();
  el.addEventListener("touchstart", stop, { passive: false });
  el.addEventListener("touchend",   stop, { passive: false });
}
preventTouchBubble("fake-keyboard");

// Letter/number keys: append to pinyin buffer (Chinese mode) or directly to message (English mode)
document.querySelectorAll(".kb-key[data-char]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    if (kbMode === "zh") {
      pinyinBuffer += btn.dataset.char.toLowerCase();
      kbRefresh();
      return;
    }
    // English mode: honour Shift for capitalisation, then auto-release Shift
    const char = kbShift ? btn.dataset.char.toUpperCase() : btn.dataset.char.toLowerCase();
    kbInput().value += char;
    if (kbShift) {
      kbShift = false;
      document.getElementById("kb-shift-btn").classList.remove("active");
    }
    kbUpdateDisplay();
  });
});

// Shift key: toggle capitalisation mode
document.getElementById("kb-shift-btn").addEventListener("click", function () {
  kbShift = !kbShift;
  this.classList.toggle("active", kbShift);
});

// Backspace: delete from pinyin buffer first (Chinese), then from the message text
document.getElementById("kb-backspace-btn").addEventListener("click", function () {
  if (kbMode === "zh" && pinyinBuffer) {
    pinyinBuffer = pinyinBuffer.slice(0, -1);
    kbRefresh();
    return;
  }
  kbInput().value = kbInput().value.slice(0, -1);
  kbUpdateDisplay();
});

// Space: auto-select the first candidate (Chinese mode); insert a space (English mode)
document.getElementById("kb-space-btn").addEventListener("click", function () {
  if (kbMode === "zh" && pinyinBuffer) {
    const candidates = kbGetCandidates();
    if (candidates.length > 0) {
      kbInput().value += candidates[0];
      pinyinBuffer = "";
      kbRefresh();
    }
    return;
  }
  kbInput().value += " ";
  kbUpdateDisplay();
});

// Language toggle (中 / EN): switch between English and Chinese pinyin input
document.getElementById("kb-lang-btn").addEventListener("click", function () {
  kbMode = kbMode === "en" ? "zh" : "en";
  this.textContent = kbMode === "zh" ? "EN" : "中"; // shows the language to switch TO
  this.classList.toggle("active", kbMode === "zh");
  pinyinBuffer = "";
  kbRefresh();
});

// Enter/Send key:
// - Chinese mode with pending pinyin: discard buffer (no partial send)
// - User selected: send a point-to-point message (triggers flying animation)
// - No selection: broadcast to all (chat-message)
// After sending, the display text disappears character by character (flies away visually)
document.getElementById("kb-enter-btn").addEventListener("click", function () {
  if (kbMode === "zh" && pinyinBuffer) {
    pinyinBuffer = "";
    kbRefresh();
    return;
  }
  const inputEl = kbInput();
  const text = inputEl.value.trim();
  if (!text) return;

  if (selectedUserId) {
    if (isLineBroken(myUserId, selectedUserId)) return; // broken connection, cannot send
    socket.emit("message-travel", { toUserId: selectedUserId, text });
    if (historyViewUserId) exitHistoryView();
  } else {
    socket.emit("chat-message", { text });
  }

  inputEl.value = "";

  // Animate the display text flying away one character at a time
  const charDelay = 200;
  const displayEl = document.getElementById("kb-display-text");
  for (let i = 0; i <= text.length; i++) {
    setTimeout(() => { displayEl.textContent = text.slice(i); }, i * charDelay);
  }
});
// ---- end Fake Keyboard ----


/* MyPoint: "me" on the map */
class MyPoint {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.goalX = 0;  // target position, updated by updateMapContent()
    this.goalY = 0;
    this.size = 14;
    this.col = "#39ff14";
    this.accuracy = 0; // GPS accuracy in meters
  }

  update() {
    // Lerp 20% toward goal each frame for smooth movement
    this.x = lerp(this.x, this.goalX, 0.2);
    this.y = lerp(this.y, this.goalY, 0.2);
  }

  display() {
    push();
    translate(this.x, this.y);

    // Accuracy circle: radius corresponds to real meters, so the user can see position uncertainty
    noFill();
    stroke("red");
    let diameter = 2 * metersToPixel(this.accuracy, currentLatitude);
    circle(0, 0, diameter);
    line(0, 0, diameter / 2, 0); // radial line to indicate direction
    fill("red");
    noStroke();
    if (mapInit) {
      textSize(map(myMap.zoom(), 9, 18, 0, 12)); // fade text at low zoom levels
    }
    text("accuracy:" + this.accuracy, diameter / 2 + 1, 0);

    // Main dot with a subtle breathing pulse (sin wave on frameCount)
    fill(this.col);
    stroke("#39ff14");
    strokeWeight(3);
    let dia = this.size + sin(frameCount * 0.1);
    circle(0, 0, dia);

    pop();
  }
}

/* Tutorial Pop Up Windows */
const tutorialSlides = [
  { gesture: "○",  title: "single tap",        desc: "tap on someone\nto connect with them" },
  { gesture: "○○", title: "double tap",         desc: "double tap the map\nto drop your pin" },
  { gesture: "○○", title: "double tap a person",desc: "double tap a contact\nto reveal their chat web" },
  { gesture: "◉",  title: "long press",         desc: "long press on someone\nto view your message history" },
  { gesture: '<div class="tear-wrap"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" class="tear-anim"><path d="M14 1 C22 12 24 20 24 24 A10 10 0 0 1 4 24 C4 20 6 12 14 1Z" fill="#39ff14"/></svg></div>', title: "", desc: "Reply to the one you care about\nbefore it's TOO LATE" },
];

let tutorialStep = 0;

function tutorialShow(step) {
  tutorialStep = step;
  const slide = tutorialSlides[step];
  document.getElementById("tutorial-gesture").innerHTML = slide.gesture;
  document.getElementById("tutorial-title").textContent = slide.title;
  document.getElementById("tutorial-desc").textContent = slide.desc;

  const nextBtn = document.getElementById("tutorial-next-btn");
  nextBtn.textContent = step < tutorialSlides.length - 1 ? "next →" : "got it ✓";

  document.querySelectorAll(".t-dot").forEach(function (dot, i) {
    dot.classList.toggle("active", i === step);
  });

  document.getElementById("tutorial-overlay").classList.remove("hidden");
  document.getElementById("tutorial-help-btn").style.display = "none";
}

function tutorialClose() {
  document.getElementById("tutorial-overlay").classList.add("hidden");
  const helpBtn = document.getElementById("tutorial-help-btn");
  helpBtn.style.display = "block";
  helpBtn.style.bottom = (document.getElementById("fake-keyboard").offsetHeight + 12) + "px";
}

document.getElementById("tutorial-next-btn").addEventListener("click", function () {
  if (tutorialStep < tutorialSlides.length - 1) {
    tutorialShow(tutorialStep + 1);
  } else {
    tutorialClose();
  }
});

document.getElementById("tutorial-help-btn").addEventListener("click", function () {
  tutorialShow(0);
});

preventTouchBubble("tutorial-overlay");

// Show tutorial on first load
tutorialShow(0);
