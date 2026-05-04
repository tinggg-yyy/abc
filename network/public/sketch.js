let mappa = new Mappa("Leaflet");
let myMap;
let canvas;  
let currentLongitude = 0;
let currentLatitude = 0;
let mapInit = false;
let me; 

// user identity
let username = localStorage.getItem("user-nameTEST");

// Day system: 2 real-world minutes = 1 virtual day; 2 days since last message => broken relationship
// Uses wall-clock time (Date.now()) — no tab-visibility tracking needed.
// Both users independently compute the same day number, so broken-connection state is identical.
const MS_PER_DAY = 2 * 60 * 1000;

// Record the first time this user opens the app; never overwritten
const firstUseTime = (() => {
  let t = localStorage.getItem("network-first-use-time");
  if (!t) { t = String(Date.now()); localStorage.setItem("network-first-use-time", t); }
  return parseInt(t);
})();

function getOnlineTime() { return Date.now(); }

// Per-pair wall-clock timestamps of last message (recomputed from server on each connect)
let lastMsgTimes = {};
// Permanently broken pairs — populated from server on connect, no longer stored in localStorage
let brokenConnPairs = new Set();
let currentInAppDay = Math.floor((Date.now() - firstUseTime) / MS_PER_DAY) + 1;
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
const socket =
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
    ? io({ path: "/ting/port-4280/socket.io", auth: myInfo })
    : io({ auth: myInfo });

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

// Lookup structures — maintained incrementally by socket handlers, not rebuilt each frame.
let locMap = {};           // userId → location object
let connSet = new Set();   // "fromId-toId" directional connection strings
let chattedPairs = new Map(); // "A|B" sorted pair key → total message count
let msgDirections = new Set(); // "fromId-toId" directional keys that have messages
let myMsgCountTo = {};     // toUserId → count of messages I sent

function rebuildMsgStructures() {
  chattedPairs = new Map();
  msgDirections = new Set();
  myMsgCountTo = {};
  for (let msg of clientMessages) {
    if (!msg.fromUserId || !msg.toUserId) continue;
    msgDirections.add(msg.fromUserId + "-" + msg.toUserId);
    if (msg.fromUserId === myUserId)
      myMsgCountTo[msg.toUserId] = (myMsgCountTo[msg.toUserId] || 0) + 1;
    const k = [msg.fromUserId, msg.toUserId].sort().join("|");
    chattedPairs.set(k, (chattedPairs.get(k) || 0) + 1);
  }
}

// Touch-event state
let changingLocation = false;
let locationMenuOpen = false; // 📍 menu is visible but user hasn't entered changingLocation yet
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
          if (inspectedUserId === tappedUserId) {
            inspectedUserId = null;
          } else {
            inspectedUserId = tappedUserId;
          }
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

/* LOCATION MODE BUTTONS */
// Change Location button
document.getElementById("changeLocationButton").addEventListener("click", function () {
  changingLocation = true;
  locationMenuOpen = false;
  this.style.display = "none";
  document.getElementById("locationHint").style.display = "block";
});

function exitLocationMode() {
  pendingLocation = null;
  changingLocation = false;
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

/* Location Data */
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
  locMap[data.userId] = data;
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

// Connection list: both historical snapshot and live updates use the same assignment
function applyConnections(conns) {
  connections = conns;
  connSet = new Set(conns.map(c => c.fromUserId + "-" + c.toUserId));
}
socket.on("historical-connections", applyConnections);
socket.on("connections-from-server", applyConnections);

// Broken connections are authoritative on the server; both clients see the same state.
socket.on("historical-broken-connections", function (keys) {
  brokenConnPairs = new Set(keys);
});
socket.on("broken-connection-from-server", function (data) {
  brokenConnPairs.add(data.key);
});

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

  rebuildMsgStructures();
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
  if (clientMessages.length > 500) {
    clientMessages = clientMessages.slice(-400);
    rebuildMsgStructures(); // full rebuild after trim to keep counts accurate
  } else {
    // Incremental update — much cheaper than full rebuild
    msgDirections.add(data.fromUserId + "-" + data.toUserId);
    if (data.fromUserId === myUserId)
      myMsgCountTo[data.toUserId] = (myMsgCountTo[data.toUserId] || 0) + 1;
    const pairKey = [data.fromUserId, data.toUserId].sort().join("|");
    chattedPairs.set(pairKey, (chattedPairs.get(pairKey) || 0) + 1);
  }

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

/* MAP */
let mappa_options = {
  lat: 0,
  lng: 0,
  zoom: 16,  // street-level zoom
  style: "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}",
};


// Time-system utilities
function getInAppDay() { return Math.floor((getOnlineTime() - firstUseTime) / MS_PER_DAY) + 1; }
function mkPKey(a, b) { return [a, b].sort().join("|"); }
function markMsgTime(uid1, uid2, t) {
  lastMsgTimes[mkPKey(uid1, uid2)] = t !== undefined ? t : Date.now();
}
function isLineBroken(uid1, uid2) { return brokenConnPairs.has(mkPKey(uid1, uid2)); }
function doBreakLine(uid1, uid2) {
  let k = mkPKey(uid1, uid2);
  if (!brokenConnPairs.has(k)) {
    brokenConnPairs.add(k);
    socket.emit("break-connection", { userId1: uid1, userId2: uid2 });
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
  let n = min(exchanges, 7);
  let dx = x2 - x1, dy = y2 - y1;
  let len = Math.sqrt(dx * dx + dy * dy) || 1;
  let perpX = -dy / len, perpY = dx / len;
  // Amplitude grows with message count so heavy conversations spread wide
  let maxAmplitude = 6 + min(exchanges, 35) * 1.4;
  noFill();
  strokeWeight(1);
  for (let s = 0; s < n; s++) {
    // Each line gets a different number of bumps so they look distinct
    let freq = s + 1;
    let layerAmp = maxAmplitude * ((s + 1) / n);
    let alpha = lineColor ? null : map(s, 0, n - 1, 220, 100);
    if (lineColor) stroke(lineColor);
    else stroke(57, 255, 20, alpha);
    beginShape();
    for (let t = 0; t <= 1; t += 0.01) {
      let envelope = sin(t * PI);
      let offset = sin(t * TWO_PI * freq) * layerAmp * envelope;
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

    /* Draw Lines between users*/
    // Mutually selected → bright green; otherwise → dim green
    // Line thickness grows with message count: 1px base, up to 5px
    for (let [pairKey, msgCount] of chattedPairs) {
      let [uid1, uid2] = pairKey.split("|");
      let loc1 = locMap[uid1];
      let loc2 = locMap[uid2];
      if (!loc1 || !loc2) continue;
      let pos1 = myMap.latLngToPixel(loc1.lat, loc1.lng);
      let pos2 = myMap.latLngToPixel(loc2.lat, loc2.lng);
      let isMutuallySelected = connSet.has(uid1 + "-" + uid2) && connSet.has(uid2 + "-" + uid1);
      // thickness: 1 at 1 msg, caps at 5 around 40+ msgs
      let w = min(1 + Math.sqrt(msgCount - 1) * 0.6, 5);
      if (isLineBroken(uid1, uid2)) {
        stroke(100, 100, 100, 110);
      } else {
        stroke(isMutuallySelected ? color(57, 255, 20) : color(57, 255, 20, 110));
      }
      strokeWeight(w);
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
      if (isMutual) {
        stroke("#39ff14");
      } else {
        stroke("#ff3131");
      }
      strokeWeight(1);
      line(fromPos.x, fromPos.y, toPos.x, toPos.y);
    }

    // Guard: clean up stale __history__ data if history mode was exited
    if (!historyViewUserId && loopingMessages["__history__"]) {
      delete loopingMessages["__history__"];
    }

    /* History playback mode */
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

   /*LOOPING MESSAGE ANIMATION*/
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
      let canonicalFromPos, canonicalToPos;
      if (msg.fromUserId < msg.toUserId) {
        canonicalFromPos = fromPos;
        canonicalToPos = toPos;
      } else {
        canonicalFromPos = toPos;
        canonicalToPos = fromPos;
      }
      let cdx = canonicalToPos.x - canonicalFromPos.x;
      let cdy = canonicalToPos.y - canonicalFromPos.y;
      let clen = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
      let perpX = -cdy / clen;
      let perpY = cdx / clen;

      // Smaller userId → positive side; larger → negative side
      let side;
      if (msg.fromUserId < msg.toUserId) {
        side = 1;
      } else {
        side = -1;
      }
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
        if (key === "__history__") {
          msgFillColor = getMsgColor(count, 110);
        } else {
          msgFillColor = getMsgColor(count);
        }
      } else {
        if (key === "__history__") {
          msgFillColor = color(57, 255, 20, 110);
        } else {
          msgFillColor = color(57, 255, 20);
        }
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

        let displayChar;
        if (isMyConversation) {
          displayChar = msg.text[i];
        } else {
          displayChar = GARBLE_CHARS[Math.abs(Math.floor(Math.sin(garbleSeed + i * 97) * GARBLE_CHARS.length)) % GARBLE_CHARS.length];
        }

        push();
        translate(x, y);
        rotate(angle);
        if (fromPos.x > toPos.x) rotate(PI); // flip text when line goes right-to-left
        text(displayChar, 0, 0);
        pop();
      }
    }

    /* Chat-web inspection view (double-tapping a connected user) */
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

    /* Draw user dots and usernames */
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
            if (isGreen) {
              fill(color(57, 255, 20, progress * 230));
            } else {
              fill(color(255, 49, 49, progress * 230));
            }
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

  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// Time system: check for broken connections and update day counter every 5 seconds.
// Runs outside draw() so it doesn't execute 60 times per second.
setInterval(function () {
  currentInAppDay = getInAppDay();
  if (currentInAppDay > prevInAppDay) prevInAppDay = currentInAppDay;
  document.getElementById("day-counter").textContent = "Day " + currentInAppDay;

  const absoluteDay = Math.floor(Date.now() / MS_PER_DAY);
  for (let k in lastMsgTimes) {
    if (brokenConnPairs.has(k)) continue;
    let parts = k.split("|");
    if (absoluteDay - Math.floor(lastMsgTimes[k] / MS_PER_DAY) >= 2) {
      doBreakLine(parts[0], parts[1]);
      if (selectedUserId === parts[0] || selectedUserId === parts[1]) {
        if (parts[0] === myUserId || parts[1] === myUserId) {
          selectedUserId = null;
          socket.emit("connection-from-client", { toUserId: null });
        }
      }
    }
  }
}, 5000);

function syncLocationButton() {
  if (changingLocation || locationMenuOpen) return;
  const btn = document.getElementById("changeLocationButton");
  if (findLocByUserId(myUserId)) {
    // Already has a location: hide the button — 📍 toggle controls it
    btn.textContent = "change location";
    btn.style.display = "none";
  } else {
    // No location yet: always show "add location"
    btn.textContent = "add location";
    btn.style.display = "block";
  }
}

// GPS callback: fired by requestGPS.js whenever a new position is available
function handleNewPosition(pos) {
  me.accuracy = pos.coords.accuracy;

  if (!changingLocation) {
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

// pinyinDict is loaded from pinyinDict.js


// Convenience accessor for the message input element
function kbInput() {
  return document.getElementById("kb-input");
}

// Return candidate characters for the current pinyin buffer, or [] if empty
function kbGetCandidates() {
  if (pinyinBuffer) {
    return pinyinDict[pinyinBuffer] || [];
  } else {
    return [];
  }
}

// Render candidate characters as clickable buttons above the keyboard
function kbShowCandidates() {
  const candidates = kbGetCandidates();
  const row = document.getElementById("kb-candidates");
  if (candidates.length === 0) {
    row.style.display = "none";
    row.innerHTML = "";
    updateSideButtonPositions();
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
  updateSideButtonPositions();
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
    let char;
    if (kbShift) {
      char = btn.dataset.char.toUpperCase();
    } else {
      char = btn.dataset.char.toLowerCase();
    }
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
  if (kbMode === "en") {
    kbMode = "zh";
  } else {
    kbMode = "en";
  }
  if (kbMode === "zh") {
    this.textContent = "EN";
  } else {
    this.textContent = "中";
  } // shows the language to switch TO
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
/*end Fake Keyboard */


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
  { gesture: "○",  title: "SINGLE TAP",        desc: "Tap on someone\nto connect with them" },
  { gesture: "○○", title: "DOUBLE TAP",         desc: "Double tap the map\nto drop your pin" },
  { gesture: "○○", title: "DOUBLE TAP SOMEONE",desc: "Double tap a contact\nto reveal their chat web" },
  { gesture: "◉",  title: "LONG PRESS",         desc: "Long press on someone\nto view your message history" },
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
  if (step < tutorialSlides.length - 1) {
    nextBtn.textContent = "next →";
  } else {
    nextBtn.textContent = "got it ✓";
  }

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
  updateSideButtonPositions();
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

// Map-pin button: reveals "change location" for users who already have a location
document.getElementById("locationMenuBtn").addEventListener("click", function () {
  if (changingLocation) return;
  const btn = document.getElementById("changeLocationButton");
  if (findLocByUserId(myUserId)) {
    btn.textContent = "change location";
    locationMenuOpen = btn.style.display === "none"; // toggling on → true, off → false
    btn.style.display = locationMenuOpen ? "block" : "none";
  }
});
preventTouchBubble("locationMenuBtn");

// Keep both side buttons above the keyboard
function updateSideButtonPositions() {
  const kbHeight = document.getElementById("fake-keyboard").offsetHeight;
  const bottom = (kbHeight + 12) + "px";
  document.getElementById("locationMenuBtn").style.bottom = bottom;
  const helpBtn = document.getElementById("tutorial-help-btn");
  if (helpBtn) helpBtn.style.bottom = bottom;
}
window.addEventListener("load", updateSideButtonPositions);

// Show tutorial on first load
tutorialShow(0);
