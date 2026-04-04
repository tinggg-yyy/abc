const size = 300;
const zoom = 16;

let mappa = new Mappa("Leaflet");
let myMap;
let canvas;
let mapInit = false;

let currentLat = 0;
let currentLon = 0;
let myHeading = 0;
let myOriginLat = null;
let myOriginLon = null;

let heroImg;
let heroData;

let traces = {};
let myTraceID = null;
let mySocketID = null;

let onlinePlayers = {};

let homeBtn;

let socket;
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/ting/port-4280/socket.io" });
} else {
  socket = io();
}

let mappa_options = {
  lat: 0,
  lng: 0,
  zoom: zoom,
  style:
    "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
};

function preload() {
  if (HERO_KEY === "schwarzenegger") {
    heroImg = loadImage("assets/schwarzenegger.png");
  } else {
    heroImg = loadImage("assets/JingWu01.png");
  }
}

function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  textAlign(CENTER, CENTER);
  textSize(11);

  // Request GPS and orientation permissions
  let gpsBtn = select("#requestOrientationButton");
  if (gpsBtn) {
    gpsBtn.mousePressed(() => {
      requestGPS();
      requestOrientation();
      gpsBtn.hide();
    });
  }

  // Home button to reset map view to my origin
  homeBtn = createButton("🌍");
  homeBtn.position(width - 48, 12);
  homeBtn.size(36, 36);
  homeBtn.style("position", "fixed");
  homeBtn.style("z-index", "9999");
  homeBtn.style("pointer-events", "auto");
  homeBtn.style("cursor", "pointer");
  homeBtn.style("font-size", "20px");
  homeBtn.style("background", "transparent");
  homeBtn.style("border", "none");
  homeBtn.style("outline", "none");
  homeBtn.style("padding", "0");
  homeBtn.mousePressed(calibration);

  // Register hero selection with the server
  socket.emit("selectHero", { hero: HERO_KEY });
}

function draw() {
  clear();

  // Initialize the map once we have GPS permission and a valid location
  if (!mapInit && GPS_GRANTED && currentLon !== 0) {
    mappa_options.lat = currentLat;
    mappa_options.lng = currentLon;
    myMap = mappa.tileMap(mappa_options);
    myMap.overlay(canvas);
    myMap.onChange(onMapChange);
    mapInit = true;
    onMapChange();
  }

  noStroke();

  // Draw traces and player dots
  if (mapInit) {
    if (heroData) heroData.display();
    for (let id in traces) playerTrace(traces[id]);
    for (let sid in onlinePlayers) {
      if (onlinePlayers[sid].dot) onlinePlayers[sid].dot.display();
    }
  }
  drawLabels();
}

// Re-center the map on my origin location
function calibration() {
  if (!mapInit || !myMap || !myMap.map) return;
  if (myOriginLat === null || myOriginLon === null) return;
  myMap.map.setView([myOriginLat, myOriginLon], zoom, { animate: false });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (mapInit) onMapChange();
}

// Handle new GPS position updates
function handleNewPosition(pos) {
  let lonlat = fixForChineseMap(pos);
  currentLon = lonlat[0];
  currentLat = lonlat[1];
  if (pos.coords.heading != null) myHeading = pos.coords.heading;

  if (myOriginLat === null) {
    myOriginLat = currentLat;
    myOriginLon = currentLon;
    heroData = new ImageData(myOriginLat, myOriginLon, heroImg);

    // Register my trace origin with the server
    socket.emit("registerOrigin", {
      originLat: myOriginLat,
      originLon: myOriginLon,
    });

    // Update my trace origin locally
    if (myTraceID && traces[myTraceID]) {
      traces[myTraceID].originLat = myOriginLat;
      traces[myTraceID].originLon = myOriginLon;
      if (mapInit) recalcTrace(traces[myTraceID]);
    }
  }

  // Add the new position to my trace
  if (myTraceID && traces[myTraceID]) {
    addPointToTrace(traces[myTraceID], currentLat, currentLon);
  }

  // Update player dot position for myself
  if (
    mySocketID &&
    onlinePlayers[mySocketID] &&
    onlinePlayers[mySocketID].dot
  ) {
    let dot = onlinePlayers[mySocketID].dot;
    dot.currentLat = currentLat;
    dot.currentLon = currentLon;
    if (mapInit) dot.recalculate();
  }

  // Send my new location to the server
  socket.emit("locationFromClient", { lat: currentLat, lon: currentLon });
  if (mapInit) onMapChange();
}

// Recalculate Image & Traces when map view changes (e.g. zoom, pan)
function onMapChange() {
  if (!myMap || !myMap.map) return;
  if (heroData) heroData.recalculate();
  for (let id in traces) recalcTrace(traces[id]);
  for (let sid in onlinePlayers) {
    if (onlinePlayers[sid].dot) onlinePlayers[sid].dot.recalculate();
  }
}

// Convert GPS lat/lon to screen pixel coordinates
function gpsToScreen(traceData, lat, lon) {
  if (!mapInit || !myMap || !myMap.map || !traceData.originLat) return null;

  // Calculate all traces based on their origin relative to my origin point & HeadOffset
  let scale = Math.pow(2, myMap.map.getZoom() - zoom);
  let pointPx = myMap.latLngToPixel(lat, lon);
  let theirOriginPx = myMap.latLngToPixel(
    traceData.originLat,
    traceData.originLon,
  );
  let dx = pointPx.x - theirOriginPx.x;
  let dy = pointPx.y - theirOriginPx.y;
  let myTd = myTraceID ? traces[myTraceID] : null;
  if (myTd && myTd.originLat) {
    let myOriginPx = myMap.latLngToPixel(myTd.originLat, myTd.originLon);
    // myOriginPx - myHeadOffset = my image center
    // + their headOffset = their slot on my image
    // + dx,dy = their movement
    return {
      x:
        myOriginPx.x -
        myTd.headOffsetX * scale +
        traceData.headOffsetX * scale +
        dx,
      y:
        myOriginPx.y -
        myTd.headOffsetY * scale +
        traceData.headOffsetY * scale +
        dy,
    };
  }

  return { x: pointPx.x, y: pointPx.y };
}

// Create trace points
function addPointToTrace(traceData, lat, lon) {
  let last = traceData.points[traceData.points.length - 1];
  if (
    last &&
    Math.abs(last.lat - lat) < 1e-7 &&
    Math.abs(last.lon - lon) < 1e-7
  )
    return;
  traceData.points.push({ lat, lon });
  if (mapInit && traceData.originLat) {
    let px = gpsToScreen(traceData, lat, lon);
    if (px) traceData.pxPoints.push(px);
  }
}

// recalculate all screen pixel points for a trace (e.g. when map zoom/pan changes)
function recalcTrace(traceData) {
  if (!mapInit || !traceData.originLat) return;
  traceData.pxPoints = traceData.points
    .map((p) => gpsToScreen(traceData, p.lat, p.lon))
    .filter(Boolean);
}

// Draw Traces
function playerTrace(td) {
  if (td.pxPoints.length === 0) return;
  push();
  if (td.pxPoints.length >= 2) {
    noFill();
    stroke(td.color);
    strokeWeight(4);
    strokeCap(ROUND);
    strokeJoin(ROUND);
    beginShape();
    for (let i = 0; i < td.pxPoints.length; i++) {
      let p = td.pxPoints[i];
      if (i === 0) curveVertex(p.x, p.y);
      curveVertex(p.x, p.y);
      if (i === td.pxPoints.length - 1) curveVertex(p.x, p.y);
    }
    endShape();
  }
  let root = td.pxPoints[0];
  noStroke();
  fill(td.color);
  circle(root.x, root.y, 8);
  pop();
}

// Image Data for Hero Images
class ImageData {
  constructor(lat, lon, img) {
    this.lat = lat;
    this.lon = lon;
    this.img = img;
    this.x = 0;
    this.y = 0;
    this.w = size;
    this.h = size * (img.height / img.width);
  }

  // Recalculate image position and size based on map zoom and trace head offset
  recalculate() {
    if (!mapInit || !myMap || !myMap.map) return;
    let scale = Math.pow(2, myMap.map.getZoom() - zoom);
    let pos = myMap.latLngToPixel(this.lat, this.lon);
    let hx = 0,
      hy = 0;
    if (myTraceID && traces[myTraceID]) {
      hx = traces[myTraceID].headOffsetX * scale;
      hy = traces[myTraceID].headOffsetY * scale;
    }
    // image center = arrow position - headOffset
    // so that image head (center + headOffset) aligns with arrow
    this.x = pos.x - hx;
    this.y = pos.y - hy;
    this.w = size * scale;
    this.h = size * (this.img.height / this.img.width) * scale;
  }

  display() {
    push();
    imageMode(CENTER);
    image(this.img, this.x, this.y, this.w, this.h);
    pop();
  }
}

// Traces
class playerDot {
  constructor(col, traceID, isMe) {
    this.col = col;
    this.traceID = traceID;
    this.isMe = isMe;
    this.currentLat = 0;
    this.currentLon = 0;
    this.x = null;
    this.y = null;
    this.goalX = null;
    this.goalY = null;
  }

  recalculate() {
    if (!mapInit || this.currentLat === 0) return;
    if (this.isMe) {
      // arrow always at raw GPS pixel, no offset
      let pos = myMap.latLngToPixel(this.currentLat, this.currentLon);
      this.goalX = pos.x;
      this.goalY = pos.y;
    } else {
      let td = traces[this.traceID];
      if (!td || td.originLat === undefined) return;
      let px = gpsToScreen(td, this.currentLat, this.currentLon);
      if (px) {
        this.goalX = px.x;
        this.goalY = px.y;
      }
    }
  }

  display() {
    if (this.goalX === null) return;
    if (this.x === null) {
      this.x = this.goalX;
      this.y = this.goalY;
    }
    this.x = lerp(this.x, this.goalX, 0.2);
    this.y = lerp(this.y, this.goalY, 0.2);
    push();
    if (this.isMe) {
      translate(this.x, this.y);
      rotate(radians(myHeading));
      stroke(255);
      strokeWeight(2);
      fill(this.col);
      triangle(0, -16, -8, 9, 8, 9);
      noStroke();
      fill(255);
      circle(0, 3, 5);
    } else {
      noStroke();
      fill(0);
      circle(this.x, this.y, 8);
    }
    pop();
  }
}

// Draw labels showing number of traces and online players
function drawLabels() {
  if (!mapInit) return;
  let labels = [
    "Hairs: " + Object.keys(traces).length,
    "Tonies: " + Object.keys(onlinePlayers).length,
  ];
  let pad = 8;
  let boxH = 24;
  let gap = 6;
  push();
  textSize(11);
  for (let i = 0; i < labels.length; i++) {
    let boxW = textWidth(labels[i]) + pad * 2;
    let bx = width - boxW - pad;
    let by = height - (boxH + gap) * (labels.length - i) - pad;
    noStroke();
    fill(255);
    rect(bx, by, boxW, boxH);
    fill(0);
    textAlign(LEFT, CENTER);
    text(labels[i], bx + pad, by + boxH / 2);
  }
  pop();
}

// Socket Events

// When first connected, receive my socket ID, trace ID, and all existing traces & online players
socket.on("connected", function (data) {
  mySocketID = data.socketID;
  myTraceID = data.traceID;
  for (let id in data.traces) {
    let td = data.traces[id];
    if (td.heroKey !== HERO_KEY) continue;
    traces[id] = {
      headOffsetX: td.headOffsetX,
      headOffsetY: td.headOffsetY,
      color: td.color,
      originLat: td.originLat || null,
      originLon: td.originLon || null,
      points: td.points || [],
      pxPoints: [],
    };
  }
  onlinePlayers[mySocketID] = {
    traceID: myTraceID,
    dot: new playerDot(data.color, myTraceID, true),
  };

  // Set initial position
  for (let sid in data.onlinePlayers) {
    if (sid === mySocketID) continue;
    let op = data.onlinePlayers[sid];
    if (op.heroKey !== HERO_KEY) continue;
    onlinePlayers[sid] = {
      traceID: op.traceID,
      dot: new playerDot(op.color, op.traceID, false),
    };
    onlinePlayers[sid].dot.currentLat = op.currentLat;
    onlinePlayers[sid].dot.currentLon = op.currentLon;
    if (mapInit) onlinePlayers[sid].dot.recalculate();
  }

  if (mapInit) onMapChange();
});

// When a new player joins, add them to the online players list
socket.on("newPlayer", function (data) {
  if (data.heroKey !== HERO_KEY) return;
  if (!traces[data.traceID]) {
    traces[data.traceID] = {
      headOffsetX: data.headOffsetX,
      headOffsetY: data.headOffsetY,
      color: data.color,
      originLat: null,
      originLon: null,
      points: [],
      pxPoints: [],
    };
  }
  onlinePlayers[data.socketID] = {
    traceID: data.traceID,
    dot: new playerDot(data.color, data.traceID, false),
  };
});

// Update others' trace origin
socket.on("traceOrigin", function (data) {
  if (!traces[data.traceID]) return;
  traces[data.traceID].originLat = data.originLat;
  traces[data.traceID].originLon = data.originLon;
  if (mapInit) recalcTrace(traces[data.traceID]);
});

// Update others' location
socket.on("locationFromServer", function (data) {
  let td = traces[data.traceID];
  if (!td) return;
  addPointToTrace(td, data.lat, data.lon);

  let op = onlinePlayers[data.socketID];
  if (op && op.dot) {
    op.dot.currentLat = data.lat;
    op.dot.currentLon = data.lon;
    if (mapInit) op.dot.recalculate();
  }
});
// When a player disconnects, remove them from the online players list
socket.on("deletePlayer", function (data) {
  delete onlinePlayers[data.socketID];
});
