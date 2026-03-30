// GPS HAIR PROJECT — sketch.js

const HEAD_CX = 0.2;
const HEAD_CY = -0.38;
const ELLIPSE_RX = 0.17;
const ELLIPSE_RY = 0.11;
const TILT = 0.5;
const INIT_SIZE = 300;
const INIT_ZOOM = 16;

let mappa = new Mappa("Leaflet");
let myMap;
let canvas;
let mapInit = false;

let currentLat = 0;
let currentLon = 0;
let mapRotation = 0;
let myHeading = 0;
let rotateStartAngle = null;
let rotateStartMapRotation = 0;
let myOriginLat = null;
let myOriginLon = null;

let heroImg;
let heroMarker;
let globalOriginLat = null;
let globalOriginLon = null;

let traces = {};
let myTraceID = null;
let mySocketID = null;

// onlinePlayers[socketID] = { traceID, dot: PersonDot }
let onlinePlayers = {};

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
  zoom: INIT_ZOOM,
  style:
    "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
};

// -------------------------------------------------------------
//  p5 LIFECYCLE
// -------------------------------------------------------------
function preload() {
  heroImg = loadImage("assets/JingWu01.png");
}

function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  textAlign(CENTER, CENTER);
  textSize(11);
  setupRotationGesture();
}

function draw() {
  clear();

  // Initialize map on first valid GPS fix
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
  fill(0, 150);
  rect(0, 0, width, height);

  if (mapInit) {
    push();
    translate(width / 2, height / 2);
    rotate(radians(mapRotation));
    translate(-width / 2, -height / 2);
    if (heroMarker) {
      heroMarker.recalculate();
      heroMarker.display();
    }
    for (let id in traces) displayTrace(traces[id]);
    for (let sid in onlinePlayers) {
      if (onlinePlayers[sid].dot) onlinePlayers[sid].dot.display();
    }
    drawPointers();
    pop();
  }

  drawUI();
  if (GPS_GRANTED) drawCompass();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (mapInit) onMapChange();
}

// -------------------------------------------------------------
//  TWO-FINGER MAP ROTATION
// -------------------------------------------------------------
function setupRotationGesture() {
  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        rotateStartAngle = fingerAngle(e.touches);
        rotateStartMapRotation = mapRotation;
      }
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 2 || rotateStartAngle === null) return;
      let delta = fingerAngle(e.touches) - rotateStartAngle;
      mapRotation = rotateStartMapRotation + delta;
      applyMapRotation();
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    (e) => {
      if (e.touches.length < 2) rotateStartAngle = null;
    },
    { passive: true },
  );
}

function fingerAngle(touches) {
  return (
    (Math.atan2(
      touches[1].clientY - touches[0].clientY,
      touches[1].clientX - touches[0].clientX,
    ) *
      180) /
    Math.PI
  );
}

function applyMapRotation() {
  if (!mapInit || !myMap?.map) return;
  const tilePane = myMap.map.getPanes().tilePane;
  const mapPane = myMap.map.getPanes().mapPane;
  const r = mapPane.getBoundingClientRect();
  const ox = width / 2 - r.left;
  const oy = height / 2 - r.top;
  tilePane.style.transformOrigin = `${ox}px ${oy}px`;
  tilePane.style.transform = `rotate(${mapRotation}deg)`;
}

// -------------------------------------------------------------
//  GPS
// -------------------------------------------------------------
function handleNewPosition(pos) {
  let lonlat = fixForChineseMap(pos);
  currentLon = lonlat[0];
  currentLat = lonlat[1];
  if (pos.coords.heading != null) myHeading = pos.coords.heading;

  // First fix: register origin for this user's trace
  if (myOriginLat === null) {
    myOriginLat = currentLat;
    myOriginLon = currentLon;

    socket.emit("registerOrigin", {
      originLat: myOriginLat,
      originLon: myOriginLon,
    });

    if (myTraceID && traces[myTraceID]) {
      traces[myTraceID].originLat = myOriginLat;
      traces[myTraceID].originLon = myOriginLon;
      if (mapInit) recalcTrace(traces[myTraceID]);
    }
  }

  if (myTraceID && traces[myTraceID]) {
    addPointToTrace(traces[myTraceID], currentLat, currentLon);
  }

  if (mySocketID && onlinePlayers[mySocketID]?.dot) {
    let dot = onlinePlayers[mySocketID].dot;
    dot.currentLat = currentLat;
    dot.currentLon = currentLon;
    if (mapInit) dot.recalculate();
  }

  socket.emit("locationFromClient", { lat: currentLat, lon: currentLon });
  if (mapInit) onMapChange();
}

// -------------------------------------------------------------
//  MAP CHANGE CALLBACK — recalculate all pixel positions
// -------------------------------------------------------------
function onMapChange() {
  if (!myMap || !myMap.map) return;
  if (heroMarker) heroMarker.recalculate();
  for (let id in traces) recalcTrace(traces[id]);
  for (let sid in onlinePlayers) {
    if (onlinePlayers[sid].dot) onlinePlayers[sid].dot.recalculate();
  }
  applyMapRotation();
}

// Create heroMarker at the shared global head GPS position
function initHeroMarker() {
  if (heroMarker || globalOriginLat === null) return;
  heroMarker = new ImageMarker(globalOriginLat, globalOriginLon, heroImg);
  if (mapInit) heroMarker.recalculate();
}

// -------------------------------------------------------------
//  COORDINATE TRANSFORM
//
//  Screen position = GPS pixel of the point + headOffset * scale
//  headOffset anchors the hair root to the scalp ellipse.
//  Movement displaces pointPx from originPx, growing the hair.
//  Simplifies to: { x: pointPx.x + hx, y: pointPx.y + hy }
// -------------------------------------------------------------
function gpsToScreen(traceData, lat, lon) {
  if (!mapInit || !myMap || !myMap.map || !traceData.originLat) return null;

  let scale = Math.pow(2, myMap.map.getZoom() - INIT_ZOOM);
  let hx = traceData.headOffsetX * scale;
  let hy = traceData.headOffsetY * scale;
  let originPx = myMap.latLngToPixel(traceData.originLat, traceData.originLon);
  let pointPx = myMap.latLngToPixel(lat, lon);

  return {
    x: originPx.x + hx + (pointPx.x - originPx.x),
    y: originPx.y + hy + (pointPx.y - originPx.y),
  };
}

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

function recalcTrace(traceData) {
  if (!mapInit || !traceData.originLat) return;
  traceData.pxPoints = traceData.points
    .map((p) => gpsToScreen(traceData, p.lat, p.lon))
    .filter(Boolean);
}

// -------------------------------------------------------------
//  SOCKET EVENTS
// -------------------------------------------------------------
socket.on("welcome", function (data) {
  mySocketID = data.socketID;
  myTraceID = data.traceID;

  traces[myTraceID] = {
    headOffsetX: data.headOffsetX,
    headOffsetY: data.headOffsetY,
    color: data.color,
    originLat: null,
    originLon: null,
    points: [],
    pxPoints: [],
  };

  onlinePlayers[mySocketID] = {
    traceID: myTraceID,
    dot: new PersonDot(data.color, myTraceID, true),
  };
});

socket.on("initData", function (data) {
  if (data.globalOriginLat !== null && data.globalOriginLat !== undefined) {
    globalOriginLat = data.globalOriginLat;
    globalOriginLon = data.globalOriginLon;
    initHeroMarker();
  }

  // 初始化 traces（历史轨迹，包括离线玩家的）
  for (let id in data.traces) {
    if (id === myTraceID) continue;
    let td = data.traces[id];
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

  // 初始化当前所有在线玩家（修复：之前这里缺失，导致各端 onlinePlayers 数量不一致）
  for (let sid in data.onlinePlayers) {
    if (sid === mySocketID) continue; // 自己已由 welcome 事件处理
    let op = data.onlinePlayers[sid];
    if (!onlinePlayers[sid]) {
      onlinePlayers[sid] = {
        traceID: op.traceID,
        dot: new PersonDot(op.color, op.traceID, false),
      };
      onlinePlayers[sid].dot.currentLat = op.currentLat;
      onlinePlayers[sid].dot.currentLon = op.currentLon;
      if (mapInit) onlinePlayers[sid].dot.recalculate();
    }
  }

  if (mapInit) onMapChange();
});

socket.on("playerJoined", function (data) {
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
    dot: new PersonDot(data.color, data.traceID, false),
  };
});

socket.on("traceOrigin", function (data) {
  if (!traces[data.traceID]) return;
  traces[data.traceID].originLat = data.originLat;
  traces[data.traceID].originLon = data.originLon;
  if (mapInit) recalcTrace(traces[data.traceID]);
});

socket.on("globalOrigin", function (data) {
  globalOriginLat = data.lat;
  globalOriginLon = data.lon;
  initHeroMarker();
  if (mapInit) onMapChange();
});

socket.on("locationFromServer", function (data) {
  let td = traces[data.traceID];
  if (!td) return;
  addPointToTrace(td, data.lat, data.lon);

  let op = onlinePlayers[data.socketID];
  if (op?.dot) {
    op.dot.currentLat = data.lat;
    op.dot.currentLon = data.lon;
    if (mapInit) op.dot.recalculate();
  }
});

socket.on("deletePerson", function (data) {
  delete onlinePlayers[data.socketID];
});

// -------------------------------------------------------------
//  DISPLAY
// -------------------------------------------------------------
function displayTrace(td) {
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
  // Root dot at trace origin
  let root = td.pxPoints[0];
  noStroke();
  fill(td.color);
  circle(root.x, root.y, 8);
  pop();
}

// -------------------------------------------------------------
//  CLASSES
// -------------------------------------------------------------
class ImageMarker {
  constructor(lat, lon, img) {
    this.lat = lat;
    this.lon = lon;
    this.img = img;
    this.x = 0;
    this.y = 0;
    this.w = INIT_SIZE;
    this.h = INIT_SIZE * (img.height / img.width);
  }

  recalculate() {
    if (!mapInit || !myMap || !myMap.map) return;
    let pos = myMap.latLngToPixel(this.lat, this.lon);
    let scale = Math.pow(2, myMap.map.getZoom() - INIT_ZOOM);
    this.x = pos.x;
    this.y = pos.y;
    this.w = INIT_SIZE * scale;
    this.h = INIT_SIZE * (this.img.height / this.img.width) * scale;
  }

  display() {
    push();
    imageMode(CENTER);
    image(this.img, this.x, this.y, this.w, this.h);
    // Scalp ellipse overlay
    let cx = this.x + HEAD_CX * this.w;
    let cy = this.y + HEAD_CY * this.h;
    push();
    translate(cx, cy);
    rotate(TILT);
    noFill();
    stroke("red");
    strokeWeight(2);
    ellipse(0, 0, ELLIPSE_RX * 2 * this.w, ELLIPSE_RY * 2 * this.h);
    pop();
    pop();
  }
}

class PersonDot {
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
    let td = traces[this.traceID];
    if (!td?.originLat) return;
    let px = gpsToScreen(td, this.currentLat, this.currentLon);
    if (px) {
      this.goalX = px.x;
      this.goalY = px.y;
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

// -------------------------------------------------------------
//  OFF-SCREEN POINTERS — arrows for players outside the viewport
// -------------------------------------------------------------
function drawPointers() {
  for (let sid in onlinePlayers) {
    let dot = onlinePlayers[sid].dot;
    if (!dot || dot.x === null) continue;
    if (dot.x > 10 && dot.x < width - 10 && dot.y > 10 && dot.y < height - 10)
      continue;
    let ang = Math.atan2(dot.y - height / 2, dot.x - width / 2);
    let pos = pointOnRectEdge(10, width - 10, 10, height - 10, ang);
    push();
    translate(pos.x, pos.y);
    rotate(ang - PI / 2);
    scale(1.4);
    fill(dot.col);
    stroke("white");
    strokeWeight(2);
    triangle(-4, -4, 0, 5, 4, -4);
    pop();
  }
}

function pointOnRectEdge(x1, x2, y1, y2, angle) {
  const cx = (x1 + x2) / 2,
    cy = (y1 + y2) / 2;
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  const EPS = 1e-12;
  const sdx = Math.abs(dx) < EPS ? 0 : dx;
  const sdy = Math.abs(dy) < EPS ? 0 : dy;
  let tx = Infinity,
    ty = Infinity;
  if (sdx !== 0) tx = dx > 0 ? (x2 - cx) / dx : (x1 - cx) / dx;
  if (sdy !== 0) ty = dy > 0 ? (y2 - cy) / dy : (y1 - cy) / dy;
  return { x: cx + Math.min(tx, ty) * dx, y: cy + Math.min(tx, ty) * dy };
}

// -------------------------------------------------------------
//  COMPASS — top-right corner, reflects map rotation only
// -------------------------------------------------------------
function drawCompass() {
  const r = 38;
  const cx = width - r - 14;
  const cy = r + 14;

  push();
  translate(cx, cy);

  noStroke();
  fill(0, 170);
  circle(0, 0, r * 2);
  stroke(255, 60);
  strokeWeight(1);
  noFill();
  circle(0, 0, r * 2);

  rotate(radians(mapRotation));

  noStroke();
  textAlign(CENTER, CENTER);
  textSize(10);
  fill(255, 80, 80);
  text("N", 0, -(r - 11));
  fill(200);
  text("S", 0, r - 11);
  text("E", r - 11, 0);
  text("W", -(r - 11), 0);

  noStroke();
  fill(220, 60, 60);
  triangle(0, -(r - 6), -4, 2, 4, 2);
  fill(160);
  triangle(0, r - 6, -4, 2, 4, 2);

  fill(255);
  circle(0, 0, 5);

  pop();
}

// -------------------------------------------------------------
//  UI — bottom-right counters
// -------------------------------------------------------------
function drawUI() {
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

function touchStarted() {
  if (mapInit)
    console.log("TOUCHED", myMap.pixelToLatLng(touches[0].x, touches[0].y));
}
function touchMoved() {}
function touchEnded() {}
